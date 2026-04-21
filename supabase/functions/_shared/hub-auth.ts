/**
 * Stakeholder Build Hub auth.
 *
 * Mirrors `requireServiceUser` but widens the allowlist to include
 * `client_stakeholder` (external QEP USA build observers) and returns the
 * caller's `audience` + `stakeholder_subrole` so hub endpoints can tailor
 * behavior without a second DB round-trip.
 *
 * Auth path is identical (GoTrue /auth/v1/user to sidestep supabase-js
 * local verifier; see service-auth.ts for the ES256 bug history). Only
 * the role/audience checks differ.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError } from "./safe-cors.ts";

export const HUB_ALLOWED_ROLES = [
  "client_stakeholder",
  "rep",
  "admin",
  "manager",
  "owner",
] as const;

export type HubAudience = "internal" | "stakeholder";
export type HubSubrole = "owner" | "primary_contact" | "technical" | "admin";

export type HubAuthResult =
  | {
      ok: true;
      supabase: SupabaseClient;
      userId: string;
      role: string;
      audience: HubAudience;
      subrole: HubSubrole | null;
      workspaceId: string;
    }
  | { ok: false; response: Response };

export async function requireHubUser(
  authHeader: string | null,
  origin: string | null,
): Promise<HubAuthResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey) {
    return { ok: false, response: safeJsonError("Server misconfiguration", 500, origin) };
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: safeJsonError("Missing authorization", 401, origin) };
  }
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) {
    return {
      ok: false,
      response: safeJsonError(
        "Service role not accepted on this endpoint — use user session",
        403,
        origin,
      ),
    };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, response: safeJsonError("Missing bearer token", 401, origin) };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  let userId: string | null = null;
  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      const message =
        (body as { msg?: string; message?: string }).msg
        ?? (body as { message?: string }).message
        ?? `HTTP ${resp.status}`;
      return { ok: false, response: safeJsonError(`Unauthorized: ${message}`, 401, origin) };
    }
    const userBody = await resp.json();
    if (!userBody || typeof userBody.id !== "string") {
      return { ok: false, response: safeJsonError("Unauthorized: malformed user", 401, origin) };
    }
    userId = userBody.id;
  } catch (e) {
    return {
      ok: false,
      response: safeJsonError(
        `Unauthorized: ${e instanceof Error ? e.message : "token verification failed"}`,
        401,
        origin,
      ),
    };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, audience, stakeholder_subrole, active_workspace_id")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    return { ok: false, response: safeJsonError("Profile not found", 403, origin) };
  }

  const role = String(profile.role ?? "");
  if (!(HUB_ALLOWED_ROLES as readonly string[]).includes(role)) {
    return { ok: false, response: safeJsonError("Forbidden", 403, origin) };
  }

  // Audience column was added in migration 310. Legacy rows (NULL) are
  // treated as internal — matches the column comment in 310.
  const rawAudience = (profile.audience as string | null) ?? "internal";
  const audience: HubAudience = rawAudience === "stakeholder" ? "stakeholder" : "internal";

  const rawSub = profile.stakeholder_subrole as string | null;
  const subrole: HubSubrole | null =
    rawSub === "owner" || rawSub === "primary_contact" || rawSub === "technical" || rawSub === "admin"
      ? rawSub
      : null;

  const workspaceId = (profile.active_workspace_id as string | null) ?? "default";

  return {
    ok: true,
    supabase,
    userId: userId!,
    role,
    audience,
    subrole,
    workspaceId,
  };
}
