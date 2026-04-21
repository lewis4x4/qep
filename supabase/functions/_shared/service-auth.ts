/**
 * Service engine edge functions: JWT-only auth (no service_role impersonation).
 * Aligns with RLS — callers use anon key + user JWT.
 *
 * ────────────────────────────────────────────────────────────────────────
 * TWO BUGS THIS HELPER HAS HAD, BOTH RELATED TO auth.getUser()
 * ────────────────────────────────────────────────────────────────────────
 *
 * 1. Argless variant silently 401s on JSR/Deno supabase-js builds
 *    (the implicit path requires a stored session or
 *    `hasCustomAuthorizationHeader`; neither applies in edge runtime).
 *    FIX: always pass the token explicitly.
 *
 * 2. **ES256 JWT support (current project)** — Supabase JWT Signing Keys
 *    is live on this project; the JWKS endpoint confirms
 *    `alg: ES256`. The supabase-js v2 built-in JWT verifier rejects
 *    ES256 with "Unsupported JWT algorithm ES256", so
 *    `auth.getUser(token)` 401s every legit user token.
 *    FIX: skip the library's local verifier. Call GoTrue's /user
 *    endpoint directly with the token in Authorization + the anon
 *    key in apikey header. GoTrue validates against the project's
 *    actual signing key (it knows ES256 because it minted the
 *    token). Works for HS256 tokens too — this path is algorithm-
 *    agnostic.
 *
 * Trade-off: one extra HTTP round-trip to GoTrue vs. library-local
 * verification. Acceptable — GoTrue is co-located with the edge
 * function runtime, so the round-trip is <50ms typically, and it's
 * strictly more correct (server validates what server minted).
 * ────────────────────────────────────────────────────────────────────────
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError } from "./safe-cors.ts";

export const SERVICE_ALLOWED_ROLES = ["rep", "admin", "manager", "owner"] as const;

export type ServiceAuthResult =
  | {
    ok: true;
    supabase: SupabaseClient;
    userId: string;
    role: string;
    /**
     * Caller's active workspace. Required by admin endpoints that need
     * to gate cross-workspace access even for admin users (e.g. price-
     * sheet watchdog manual trigger). Falls back to `"default"` when the
     * profile row has no active_workspace_id set.
     */
    workspaceId: string;
  }
  | { ok: false; response: Response };

/**
 * Rejects service_role key; requires valid user JWT + allowed profile role.
 */
export async function requireServiceUser(
  authHeader: string | null,
  origin: string | null,
): Promise<ServiceAuthResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      response: safeJsonError("Server misconfiguration", 500, origin),
    };
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

  // Extract the raw JWT — used to both call GoTrue for validation and
  // as the Authorization header on the supabase-js client so RLS sees
  // the user identity on subsequent queries.
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, response: safeJsonError("Missing bearer token", 401, origin) };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Validate the token by asking GoTrue directly — /auth/v1/user has
  // the project's actual signing key and handles whatever algorithm
  // the project is currently on (HS256, ES256, RS256). Side-steps the
  // supabase-js local verifier which rejects ES256.
  let user: { id: string } | null = null;
  try {
    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });
    if (!userResp.ok) {
      const body = await userResp.json().catch(() => ({}));
      const message =
        (body as { msg?: string; message?: string }).msg
        ?? (body as { message?: string }).message
        ?? `HTTP ${userResp.status}`;
      return {
        ok: false,
        response: safeJsonError(`Unauthorized: ${message}`, 401, origin),
      };
    }
    const userBody = await userResp.json();
    if (!userBody || typeof userBody.id !== "string") {
      return { ok: false, response: safeJsonError("Unauthorized: malformed user", 401, origin) };
    }
    user = { id: userBody.id };
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

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role, active_workspace_id")
    .eq("id", user.id)
    .single();

  if (profErr || !profile) {
    return { ok: false, response: safeJsonError("Profile not found", 403, origin) };
  }

  const role = profile.role as string;
  if (!(SERVICE_ALLOWED_ROLES as readonly string[]).includes(role)) {
    return { ok: false, response: safeJsonError("Forbidden", 403, origin) };
  }

  const workspaceId = (profile.active_workspace_id as string | null) ?? "default";
  return { ok: true, supabase, userId: user.id, role, workspaceId };
}
