import { createClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { decryptOneDriveToken, encryptOneDriveToken } from "../_shared/integration-crypto.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const FUNCTION_NAME = "m365-token-refresh";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const DEFAULT_REFRESH_WINDOW_MINUTES = 30;

type SyncStateRow = {
  id: string;
  user_id: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  token_refresh_fail_count: number | null;
};

function expiresWithinWindow(iso: string | null, windowMinutes: number): boolean {
  if (!iso) return true;
  const expiresAtMs = Date.parse(iso);
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs <= Date.now() + (windowMinutes * 60 * 1000);
}

function parseJsonSafe(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed != null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (!isServiceRoleCaller(req)) {
      return safeJsonError("Unauthorized — service role required", 401, origin);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const clientId = Deno.env.get("MSGRAPH_CLIENT_ID");
    const clientSecret = Deno.env.get("MSGRAPH_CLIENT_SECRET");
    const refreshScope = Deno.env.get("MSGRAPH_REFRESH_SCOPE")
      ?? "offline_access Files.ReadWrite Mail.Read Mail.Send User.Read";
    const rawWindow = Number(Deno.env.get("MSGRAPH_REFRESH_WINDOW_MINUTES") ?? DEFAULT_REFRESH_WINDOW_MINUTES);
    const refreshWindowMinutes = Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : DEFAULT_REFRESH_WINDOW_MINUTES;

    if (!serviceRoleKey || !supabaseUrl || !clientId || !clientSecret) {
      return safeJsonError(
        "Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MSGRAPH_CLIENT_ID, MSGRAPH_CLIENT_SECRET",
        500,
        origin,
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: rows, error: rowsErr } = await admin
      .from("onedrive_sync_state")
      .select("id, user_id, refresh_token, token_expires_at, token_refresh_fail_count")
      .not("refresh_token", "is", null);

    if (rowsErr) {
      return safeJsonError(`Failed to load onedrive_sync_state: ${rowsErr.message}`, 500, origin);
    }

    const candidates = ((rows ?? []) as SyncStateRow[]).filter((row) =>
      expiresWithinWindow(row.token_expires_at, refreshWindowMinutes)
    );

    let refreshed = 0;
    let failed = 0;
    const details: Array<Record<string, unknown>> = [];

    for (const row of candidates) {
      if (!row.refresh_token) continue;
      try {
        const refreshToken = await decryptOneDriveToken(row.refresh_token);
        const tokenRes = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            scope: refreshScope,
          }),
        });

        const tokenText = await tokenRes.text();
        const tokenJson = parseJsonSafe(tokenText);

        if (!tokenRes.ok) {
          failed++;
          const errorMessage = String(tokenJson.error_description ?? tokenJson.error ?? tokenText.slice(0, 240) ?? "Refresh failed");
          const nextFailCount = (Number(row.token_refresh_fail_count ?? 0) || 0) + 1;
          await admin
            .from("onedrive_sync_state")
            .update({
              token_refresh_error: errorMessage.slice(0, 1000),
              token_refresh_fail_count: nextFailCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          details.push({ id: row.id, status: "failed", error: errorMessage });
          continue;
        }

        const accessToken = typeof tokenJson.access_token === "string" ? tokenJson.access_token : "";
        const maybeRefreshToken = typeof tokenJson.refresh_token === "string" ? tokenJson.refresh_token : null;
        const expiresIn = Number(tokenJson.expires_in ?? 3600);
        if (!accessToken || !Number.isFinite(expiresIn)) {
          failed++;
          const nextFailCount = (Number(row.token_refresh_fail_count ?? 0) || 0) + 1;
          await admin
            .from("onedrive_sync_state")
            .update({
              token_refresh_error: "Refresh response missing access_token/expires_in",
              token_refresh_fail_count: nextFailCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          details.push({ id: row.id, status: "failed", error: "Invalid refresh response" });
          continue;
        }

        const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        const encryptedAccess = await encryptOneDriveToken(accessToken);
        const encryptedRefresh = maybeRefreshToken
          ? await encryptOneDriveToken(maybeRefreshToken)
          : row.refresh_token;

        const { error: updateErr } = await admin
          .from("onedrive_sync_state")
          .update({
            access_token: encryptedAccess,
            refresh_token: encryptedRefresh,
            token_expires_at: tokenExpiresAt,
            token_last_refreshed_at: new Date().toISOString(),
            token_refresh_error: null,
            token_refresh_fail_count: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (updateErr) {
          failed++;
          details.push({ id: row.id, status: "failed", error: updateErr.message });
          continue;
        }

        refreshed++;
        details.push({ id: row.id, status: "ok", token_expires_at: tokenExpiresAt });
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : "Unknown refresh error";
        const nextFailCount = (Number(row.token_refresh_fail_count ?? 0) || 0) + 1;
        await admin
          .from("onedrive_sync_state")
          .update({
            token_refresh_error: message.slice(0, 1000),
            token_refresh_fail_count: nextFailCount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        details.push({ id: row.id, status: "failed", error: message });
      }
    }

    return safeJsonOk({
      ok: true,
      function: FUNCTION_NAME,
      refresh_window_minutes: refreshWindowMinutes,
      scanned: (rows ?? []).length,
      candidates: candidates.length,
      refreshed,
      failed,
      details,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: FUNCTION_NAME, req });
    return safeJsonError(
      error instanceof Error ? error.message : "Unexpected m365-token-refresh error",
      500,
      origin,
    );
  }
});
