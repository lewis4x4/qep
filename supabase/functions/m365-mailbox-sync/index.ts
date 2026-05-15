/**
 * M365 mailbox sync.
 *
 * Reads recent Microsoft Graph inbox messages for connected advisors
 * and feeds them into the existing provider-neutral inbound_email signal path.
 * Zero-blocking: rows with missing/expired/under-scoped tokens are skipped and
 * recorded on mailbox-specific health fields.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { decryptOneDriveToken } from "../_shared/integration-crypto.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { ingestSignalDetailed } from "../_shared/qrm-signals.ts";
import type { RouterCtx } from "../_shared/crm-router-service.ts";

const GRAPH_MESSAGES_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages";

type AdminClient = any;

type SyncState = {
  id: string;
  user_id: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  m365_mail_last_synced_at: string | null;
  m365_mail_sync_fail_count: number | null;
  profiles: {
    active_workspace_id: string | null;
    email: string | null;
  } | null;
};

type GraphMessage = {
  id?: string;
  internetMessageId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { address?: string | null; name?: string | null } | null } | null;
  toRecipients?: Array<{ emailAddress?: { address?: string | null } | null }> | null;
};

type RowOutcome = {
  syncStateId: string;
  userId: string | null;
  workspaceId: string | null;
  scanned: number;
  created: number;
  deduped: number;
  skippedReason?: string;
  error?: string;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("POST only", 405, origin);

  try {
    const serviceCaller = isServiceRoleCaller(req);
    if (!serviceCaller) {
      const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError("Forbidden", 403, origin);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return safeJsonError("Server misconfiguration", 500, origin);

    const body = await req.json().catch(() => ({})) as { limit?: number; perMailboxLimit?: number };
    const rowLimit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);
    const perMailboxLimit = Math.min(Math.max(Number(body.perMailboxLimit ?? 10), 1), 25);
    const supabase: AdminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("onedrive_sync_state")
      .select("id, user_id, access_token, token_expires_at, m365_mail_last_synced_at, m365_mail_sync_fail_count, profiles!user_id(active_workspace_id, email)")
      .not("access_token", "is", null)
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(rowLimit);

    if (error) return safeJsonError(`Failed to load M365 sync state: ${error.message}`, 500, origin);

    const outcomes: RowOutcome[] = [];
    for (const row of (data ?? []) as SyncState[]) {
      outcomes.push(await syncMailbox(supabase, row, perMailboxLimit));
    }

    return safeJsonOk({
      ok: true,
      mode: serviceCaller ? "cron" : "manual",
      scannedMailboxes: outcomes.length,
      scannedMessages: outcomes.reduce((sum, outcome) => sum + outcome.scanned, 0),
      created: outcomes.reduce((sum, outcome) => sum + outcome.created, 0),
      deduped: outcomes.reduce((sum, outcome) => sum + outcome.deduped, 0),
      failed: outcomes.filter((outcome) => outcome.error).length,
      skipped: outcomes.filter((outcome) => outcome.skippedReason).length,
      outcomes,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "m365-mailbox-sync", req });
    return safeJsonError("Internal error syncing M365 mailbox", 500, origin);
  }
});

async function syncMailbox(supabase: AdminClient, row: SyncState, perMailboxLimit: number): Promise<RowOutcome> {
  const workspaceId = row.profiles?.active_workspace_id ?? null;
  const base: RowOutcome = {
    syncStateId: row.id,
    userId: row.user_id,
    workspaceId,
    scanned: 0,
    created: 0,
    deduped: 0,
  };

  if (!row.user_id || !workspaceId) return { ...base, skippedReason: "missing_user_or_workspace" };
  if (!row.access_token) return { ...base, skippedReason: "missing_access_token" };
  if (row.token_expires_at && Date.parse(row.token_expires_at) <= Date.now()) {
    await recordSyncError(supabase, row.id, "M365 mailbox token expired; refresh job must run before mailbox sync");
    return { ...base, skippedReason: "token_expired" };
  }

  try {
    const accessToken = await decryptOneDriveToken(row.access_token);
    const messages = await fetchRecentMessages(accessToken, perMailboxLimit, row.m365_mail_last_synced_at);
    const ctx = signalCtx(supabase, workspaceId);
    let created = 0;
    let deduped = 0;

    for (const message of messages) {
      const messageId = message.internetMessageId || message.id;
      if (!messageId) continue;
      const fromEmail = message.from?.emailAddress?.address?.trim() || "unknown@microsoft.graph";
      const fromName = message.from?.emailAddress?.name?.trim() || null;
      const subject = message.subject?.trim() || "(no subject)";
      const toEmail = message.toRecipients?.[0]?.emailAddress?.address ?? row.profiles?.email ?? null;
      const matchedContactId = await resolveContactId(supabase, workspaceId, fromEmail);
      const ingest = await ingestSignalDetailed(ctx, {
        workspaceId,
        kind: "inbound_email",
        severity: "medium",
        source: "m365_graph",
        title: `Email from ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}: ${subject.slice(0, 140)}`,
        description: message.bodyPreview?.slice(0, 500) ?? null,
        entityType: matchedContactId ? "contact" : null,
        entityId: matchedContactId,
        assignedRepId: row.user_id,
        dedupeKey: `m365:${row.user_id}:${messageId}`,
        occurredAt: message.receivedDateTime ?? new Date().toISOString(),
        payload: {
          message_id: messageId,
          graph_message_id: message.id ?? null,
          from_email: fromEmail,
          from_name: fromName,
          to_email: toEmail,
          subject,
          body_preview: message.bodyPreview ?? null,
        },
      });
      if (ingest.deduped) deduped += 1;
      else created += 1;
    }

    await supabase
      .from("onedrive_sync_state")
      .update({
        m365_mail_last_synced_at: new Date().toISOString(),
        m365_mail_sync_error: null,
        m365_mail_sync_fail_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return { ...base, scanned: messages.length, created, deduped };
  } catch (error) {
    const message = error instanceof Error ? error.message : "mailbox sync failed";
    await recordSyncError(supabase, row.id, message);
    return { ...base, error: message };
  }
}

async function fetchRecentMessages(accessToken: string, limit: number, lastSyncedAt: string | null): Promise<GraphMessage[]> {
  const url = new URL(GRAPH_MESSAGES_URL);
  url.searchParams.set("$top", String(limit));
  if (lastSyncedAt && Number.isFinite(Date.parse(lastSyncedAt))) {
    url.searchParams.set("$filter", `receivedDateTime gt ${new Date(Date.parse(lastSyncedAt) - 60_000).toISOString()}`);
  }
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set("$select", "id,internetMessageId,subject,bodyPreview,receivedDateTime,from,toRecipients");
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Microsoft Graph mailbox read failed (${response.status}): ${String(payload.error?.message ?? "unknown error").slice(0, 500)}`);
  }
  return Array.isArray(payload.value) ? payload.value as GraphMessage[] : [];
}

async function resolveContactId(
  supabase: AdminClient,
  workspaceId: string,
  fromEmail: string,
): Promise<string | null> {
  if (!fromEmail || fromEmail === "unknown@microsoft.graph") return null;
  const { data } = await supabase
    .from("crm_contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("email", fromEmail)
    .limit(1)
    .maybeSingle();
  return typeof data?.id === "string" ? data.id : null;
}

async function recordSyncError(supabase: AdminClient, syncStateId: string, message: string): Promise<void> {
  const { data } = await supabase
    .from("onedrive_sync_state")
    .select("m365_mail_sync_fail_count")
    .eq("id", syncStateId)
    .maybeSingle();
  const failCount = Number(data?.m365_mail_sync_fail_count ?? 0);
  await supabase
    .from("onedrive_sync_state")
    .update({
      m365_mail_sync_error: message.slice(0, 1000),
      m365_mail_sync_fail_count: Number.isFinite(failCount) ? failCount + 1 : 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", syncStateId);
}

function signalCtx(admin: AdminClient, workspaceId: string): RouterCtx {
  return {
    admin,
    callerDb: admin,
    caller: {
      authHeader: null,
      userId: null,
      role: null,
      isServiceRole: true,
      workspaceId,
    },
    workspaceId,
    requestId: crypto.randomUUID(),
    route: "/m365-mailbox-sync",
    method: "POST",
    ipInet: null,
    userAgent: null,
  } as unknown as RouterCtx;
}
