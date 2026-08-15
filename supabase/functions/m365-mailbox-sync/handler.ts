/**
 * M365 mailbox sync handler — workspace-bound JWT + service-role/cron paths.
 *
 * JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace / body.workspace_id cannot retarget scope.
 * Missing active workspace fails closed (403) with zero token-table reads.
 *
 * Service role (cron / internal): unscoped when no explicit workspace hint;
 * honors x-workspace-id header and/or body workspace / workspace_id to narrow
 * to one tenant.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { decryptOneDriveToken } from "../_shared/integration-crypto.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { ingestSignalDetailed } from "../_shared/qrm-signals.ts";
import type { RouterCtx } from "../_shared/crm-router-service.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

export const GRAPH_MESSAGES_URL =
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages";

export type AdminClient = SupabaseClient;

export type SyncState = {
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

export type GraphMessage = {
  id?: string;
  internetMessageId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { address?: string | null; name?: string | null } | null } | null;
  toRecipients?: Array<{ emailAddress?: { address?: string | null } | null }> | null;
};

export type RowOutcome = {
  syncStateId: string;
  userId: string | null;
  workspaceId: string | null;
  scanned: number;
  created: number;
  deduped: number;
  skippedReason?: string;
  error?: string;
};

export interface M365MailboxSyncBody {
  limit?: unknown;
  perMailboxLimit?: unknown;
  workspace?: unknown;
  workspace_id?: unknown;
}

export type M365MailboxSyncWorkspaceSelection =
  | { ok: true; mode: "single"; workspaceId: string }
  | { ok: true; mode: "service_unscoped" }
  | { ok: false; status: 401 | 403; message: string };

export function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveM365MailboxSyncWorkspaceSelection(params: {
  caller: CallerContext;
  requestedWorkspaceId: string | null;
}): M365MailboxSyncWorkspaceSelection {
  if (!params.caller.isServiceRole) {
    if (!params.caller.userId || !params.caller.role) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
    if (!["admin", "manager", "owner"].includes(params.caller.role)) {
      return {
        ok: false,
        status: 403,
        message: "M365 mailbox sync requires manager, owner, or admin role",
      };
    }
    if (!params.caller.workspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    // Body workspace hints are ignored for JWT callers so a forged target
    // cannot retarget the sync; active_workspace_id is authoritative.
    return {
      ok: true,
      mode: "single",
      workspaceId: params.caller.workspaceId,
    };
  }

  const headerWorkspaceId = cleanString(params.caller.workspaceId);
  const requestedWorkspaceId = cleanString(params.requestedWorkspaceId);
  if (
    headerWorkspaceId && requestedWorkspaceId &&
    headerWorkspaceId !== requestedWorkspaceId
  ) {
    return {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    };
  }

  const workspaceId = headerWorkspaceId ?? requestedWorkspaceId;
  if (workspaceId) {
    return { ok: true, mode: "single", workspaceId };
  }
  return { ok: true, mode: "service_unscoped" };
}

async function readBody(req: Request): Promise<M365MailboxSyncBody> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as M365MailboxSyncBody;
}

export async function fetchRecentMessages(
  accessToken: string,
  limit: number,
  lastSyncedAt: string | null,
): Promise<GraphMessage[]> {
  const url = new URL(GRAPH_MESSAGES_URL);
  url.searchParams.set("$top", String(limit));
  if (lastSyncedAt && Number.isFinite(Date.parse(lastSyncedAt))) {
    url.searchParams.set(
      "$filter",
      `receivedDateTime gt ${new Date(Date.parse(lastSyncedAt) - 60_000).toISOString()}`,
    );
  }
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set(
    "$select",
    "id,internetMessageId,subject,bodyPreview,receivedDateTime,from,toRecipients",
  );
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Microsoft Graph mailbox read failed (${response.status}): ${
        String(payload.error?.message ?? "unknown error").slice(0, 500)
      }`,
    );
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

async function recordSyncError(
  supabase: AdminClient,
  syncStateId: string,
  message: string,
): Promise<void> {
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

export async function syncMailbox(
  supabase: AdminClient,
  row: SyncState,
  perMailboxLimit: number,
  dependencies: Pick<M365MailboxSyncDependencies, "decryptOneDriveToken" | "fetchRecentMessages" | "ingestSignalDetailed">,
): Promise<RowOutcome> {
  const workspaceId = row.profiles?.active_workspace_id ?? null;
  const base: RowOutcome = {
    syncStateId: row.id,
    userId: row.user_id,
    workspaceId,
    scanned: 0,
    created: 0,
    deduped: 0,
  };

  if (!row.user_id || !workspaceId) {
    return { ...base, skippedReason: "missing_user_or_workspace" };
  }
  if (!row.access_token) return { ...base, skippedReason: "missing_access_token" };
  if (row.token_expires_at && Date.parse(row.token_expires_at) <= Date.now()) {
    await recordSyncError(
      supabase,
      row.id,
      "M365 mailbox token expired; refresh job must run before mailbox sync",
    );
    return { ...base, skippedReason: "token_expired" };
  }

  try {
    const accessToken = await dependencies.decryptOneDriveToken(row.access_token);
    const messages = await dependencies.fetchRecentMessages(
      accessToken,
      perMailboxLimit,
      row.m365_mail_last_synced_at,
    );
    const ctx = signalCtx(supabase, workspaceId);
    let created = 0;
    let deduped = 0;

    for (const message of messages) {
      const messageId = message.internetMessageId || message.id;
      if (!messageId) continue;
      const fromEmail = message.from?.emailAddress?.address?.trim() ||
        "unknown@microsoft.graph";
      const fromName = message.from?.emailAddress?.name?.trim() || null;
      const subject = message.subject?.trim() || "(no subject)";
      const toEmail = message.toRecipients?.[0]?.emailAddress?.address ??
        row.profiles?.email ?? null;
      const matchedContactId = await resolveContactId(supabase, workspaceId, fromEmail);
      const ingest = await dependencies.ingestSignalDetailed(ctx, {
        workspaceId,
        kind: "inbound_email",
        severity: "medium",
        source: "m365_graph",
        title: `Email from ${
          fromName ? `${fromName} <${fromEmail}>` : fromEmail
        }: ${subject.slice(0, 140)}`,
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

export interface M365MailboxSyncDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  decryptOneDriveToken: typeof decryptOneDriveToken;
  fetchRecentMessages: typeof fetchRecentMessages;
  ingestSignalDetailed: typeof ingestSignalDetailed;
}

const defaultDependencies: M365MailboxSyncDependencies = {
  createAdminClient,
  resolveCallerContext,
  decryptOneDriveToken,
  fetchRecentMessages,
  ingestSignalDetailed,
};

export async function handleM365MailboxSync(
  req: Request,
  overrides: Partial<M365MailboxSyncDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("POST only", 405, origin);

  try {
    const admin = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, admin);
    const body = await readBody(req);
    const requestedWorkspaceId = cleanString(body.workspace) ??
      cleanString(body.workspace_id);

    const workspaceSelection = resolveM365MailboxSyncWorkspaceSelection({
      caller,
      requestedWorkspaceId,
    });
    if (!workspaceSelection.ok) {
      return safeJsonError(
        workspaceSelection.message,
        workspaceSelection.status,
        origin,
      );
    }

    const rowLimit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);
    const perMailboxLimit = Math.min(
      Math.max(Number(body.perMailboxLimit ?? 10), 1),
      25,
    );

    let query = admin
      .from("onedrive_sync_state")
      .select(
        "id, user_id, access_token, token_expires_at, m365_mail_last_synced_at, m365_mail_sync_fail_count, profiles!user_id(active_workspace_id, email)",
      )
      .not("access_token", "is", null)
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(rowLimit);

    if (workspaceSelection.mode === "single") {
      query = query.eq(
        "profiles.active_workspace_id",
        workspaceSelection.workspaceId,
      );
    }

    const { data, error } = await query;
    if (error) {
      return safeJsonError(`Failed to load M365 sync state: ${error.message}`, 500, origin);
    }

    const outcomes: RowOutcome[] = [];
    const startedMs = Date.now();
    for (const row of (data ?? []) as unknown as SyncState[]) {
      outcomes.push(
        await syncMailbox(admin, row, perMailboxLimit, dependencies),
      );
    }

    const scannedMailboxes = outcomes.length;
    const scannedMessages = outcomes.reduce((sum, outcome) => sum + outcome.scanned, 0);
    const createdTotal = outcomes.reduce((sum, outcome) => sum + outcome.created, 0);
    const dedupedTotal = outcomes.reduce((sum, outcome) => sum + outcome.deduped, 0);
    const failed = outcomes.filter((outcome) => outcome.error).length;
    const skipped = outcomes.filter((outcome) => outcome.skippedReason).length;

    console.log(JSON.stringify({
      event: "m365_mailbox_sync_complete",
      mode: caller.isServiceRole ? "cron" : "manual",
      workspace_scope: workspaceSelection.mode === "single"
        ? workspaceSelection.workspaceId
        : "all",
      row_limit: rowLimit,
      per_mailbox_limit: perMailboxLimit,
      scanned_mailboxes: scannedMailboxes,
      scanned_messages: scannedMessages,
      created: createdTotal,
      deduped: dedupedTotal,
      failed,
      skipped,
      duration_ms: Date.now() - startedMs,
    }));

    return safeJsonOk({
      ok: true,
      mode: caller.isServiceRole ? "cron" : "manual",
      workspaceScope: workspaceSelection.mode === "single"
        ? workspaceSelection.workspaceId
        : "all",
      scannedMailboxes,
      scannedMessages,
      created: createdTotal,
      deduped: dedupedTotal,
      failed,
      skipped,
      outcomes,
    }, origin);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(error, { fn: "m365-mailbox-sync", req });
    return safeJsonError("Internal error syncing M365 mailbox", 500, origin);
  }
}
