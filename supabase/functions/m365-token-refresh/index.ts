/**
 * M365 / Microsoft Graph token refresh.
 *
 * Cron path: x-internal-service-secret or service_role credentials.
 * Manual path: owner/admin/manager JWT may run a health refresh check.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { decryptOneDriveToken, encryptOneDriveToken } from "../_shared/integration-crypto.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_DRIVE_PROBE_URL = "https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType";
const GRAPH_MAIL_PROBE_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id,displayName";
const REFRESH_WINDOW_MS = 30 * 60 * 1000;

type SyncState = {
  id: string;
  user_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  token_refresh_fail_count: number | null;
};

type RefreshOutcome = {
  id: string;
  userId: string | null;
  attempted: boolean;
  refreshed: boolean;
  graphReachable: boolean;
  reason?: string;
  error?: string;
  tokenExpiresAt?: string | null;
};

type AdminClient = any;

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

    const body = await req.json().catch(() => ({})) as { force?: boolean; limit?: number };
    const force = body.force === true;
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);
    const supabase: AdminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = supabase
      .from("onedrive_sync_state")
      .select("id, user_id, access_token, refresh_token, token_expires_at, token_refresh_fail_count")
      .not("refresh_token", "is", null)
      .order("token_expires_at", { ascending: true, nullsFirst: true })
      .limit(limit);

    if (!force) {
      query = query.or(`token_expires_at.is.null,token_expires_at.lte.${new Date(Date.now() + REFRESH_WINDOW_MS).toISOString()}`);
    }

    const { data, error } = await query;
    if (error) return safeJsonError(`Failed to load M365 token state: ${error.message}`, 500, origin);

    const rows = (data ?? []) as SyncState[];
    const outcomes: RefreshOutcome[] = [];
    const startedMs = Date.now();
    for (const row of rows) {
      outcomes.push(await refreshRow(supabase, row));
    }

    const refreshed = outcomes.filter((outcome) => outcome.refreshed).length;
    const failed = outcomes.filter((outcome) => outcome.error).length;
    const graphOk = outcomes.filter((outcome) => outcome.graphReachable).length;

    console.log(JSON.stringify({
      event: "m365_token_refresh_complete",
      mode: serviceCaller ? "cron" : "manual",
      force,
      limit,
      scanned: rows.length,
      refreshed,
      failed,
      graph_probe_ok: graphOk,
      duration_ms: Date.now() - startedMs,
    }));

    return safeJsonOk({
      ok: true,
      mode: serviceCaller ? "cron" : "manual",
      force,
      scanned: rows.length,
      refreshed,
      failed,
      outcomes,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "m365-token-refresh", req });
    return safeJsonError("Internal error refreshing M365 tokens", 500, origin);
  }
});

async function refreshRow(supabase: AdminClient, row: SyncState): Promise<RefreshOutcome> {
  if (!row.refresh_token) {
    return { id: row.id, userId: row.user_id, attempted: false, refreshed: false, graphReachable: false, reason: "missing_refresh_token" };
  }

  try {
    const refreshToken = await decryptOneDriveToken(row.refresh_token);
    const tokens = await requestRefresh(refreshToken);
    const accessToken = String(tokens.access_token ?? "");
    if (!accessToken) throw new Error("Microsoft refresh response missing access_token");

    const nextRefreshToken = typeof tokens.refresh_token === "string" && tokens.refresh_token.length > 0
      ? tokens.refresh_token
      : refreshToken;
    const expiresIn = Number(tokens.expires_in ?? 3600);
    const tokenExpiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString();
    const graphReachable = await probeGraph(accessToken);

    await supabase
      .from("onedrive_sync_state")
      .update({
        access_token: await encryptOneDriveToken(accessToken),
        refresh_token: await encryptOneDriveToken(nextRefreshToken),
        token_expires_at: tokenExpiresAt,
        token_last_refreshed_at: new Date().toISOString(),
        token_refresh_error: graphReachable ? null : "Microsoft Graph probe failed after token refresh",
        token_refresh_fail_count: graphReachable ? 0 : (row.token_refresh_fail_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return {
      id: row.id,
      userId: row.user_id,
      attempted: true,
      refreshed: true,
      graphReachable,
      tokenExpiresAt,
      reason: graphReachable ? undefined : "graph_probe_failed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "refresh failed";
    await supabase
      .from("onedrive_sync_state")
      .update({
        token_refresh_error: message.slice(0, 1000),
        token_refresh_fail_count: (row.token_refresh_fail_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return {
      id: row.id,
      userId: row.user_id,
      attempted: true,
      refreshed: false,
      graphReachable: false,
      error: message,
    };
  }
}

async function requestRefresh(refreshToken: string): Promise<Record<string, unknown>> {
  const clientId = Deno.env.get("MSGRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("MSGRAPH_CLIENT_SECRET");
  const redirectUri = Deno.env.get("MSGRAPH_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing MSGRAPH_CLIENT_ID, MSGRAPH_CLIENT_SECRET, or MSGRAPH_REDIRECT_URI");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorText = typeof payload.error_description === "string"
      ? payload.error_description
      : `Microsoft token refresh failed (${response.status})`;
    throw new Error(errorText);
  }
  return payload as Record<string, unknown>;
}

async function probeGraph(accessToken: string): Promise<boolean> {
  const [driveResponse, mailResponse] = await Promise.all([
    fetch(GRAPH_DRIVE_PROBE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null),
    fetch(GRAPH_MAIL_PROBE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null),
  ]);
  return driveResponse?.ok === true && mailResponse?.ok === true;
}
