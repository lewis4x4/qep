/**
 * Canonical JWT auth for edge functions.
 *
 * ────────────────────────────────────────────────────────────────────────
 * HOW TO USE (every frontend-called edge function should do this):
 * ────────────────────────────────────────────────────────────────────────
 *
 *   import { requireServiceUser } from "../_shared/service-auth.ts";
 *   import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
 *
 *   Deno.serve(async (req) => {
 *     const origin = req.headers.get("origin");
 *     if (req.method === "OPTIONS") return optionsResponse(origin);
 *
 *     const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
 *     if (!auth.ok) return auth.response;
 *     // auth.supabase  → user-scoped client (RLS sees caller identity)
 *     // auth.userId    → string
 *     // auth.role      → "rep" | "admin" | "manager" | "owner"
 *
 *     // ...your business logic...
 *   });
 *
 * AND register the function in supabase/config.toml with verify_jwt=false
 * (gateway verifier rejects ES256; this helper does the auth internally).
 *
 * The `scripts/check-edge-function-auth.mjs` audit (run in `bun run build`)
 * enforces BOTH — frontend-called functions that aren't registered or that
 * use argless `auth.getUser()` fail the build.
 *
 * ────────────────────────────────────────────────────────────────────────
 * TWO BUGS THIS HELPER SOLVES, BOTH RELATED TO auth.getUser()
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
 *
 * Canonical live examples:
 *   - supabase/functions/equipment-vision/index.ts
 *   - supabase/functions/trade-book-value-range/index.ts
 *   - supabase/functions/trade-valuation/index.ts
 *   - supabase/functions/parts-bulk-import/index.ts
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

export type AuthenticatedUserResult =
  | {
    ok: true;
    supabase: SupabaseClient;
    userId: string;
  }
  | { ok: false; response: Response };

async function validateUserJwt(
  authHeader: string | null,
  origin: string | null,
): Promise<
  | { ok: true; supabase: SupabaseClient; userId: string }
  | { ok: false; response: Response }
> {
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

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, response: safeJsonError("Missing bearer token", 401, origin) };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

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
    return { ok: true, supabase, userId: userBody.id };
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
}

export async function requireAuthenticatedUser(
  authHeader: string | null,
  origin: string | null,
): Promise<AuthenticatedUserResult> {
  return validateUserJwt(authHeader, origin);
}

/**
 * Rejects service_role key; requires valid user JWT + allowed profile role.
 */
export async function requireServiceUser(
  authHeader: string | null,
  origin: string | null,
): Promise<ServiceAuthResult> {
  const auth = await validateUserJwt(authHeader, origin);
  if (!auth.ok) return auth;
  const { supabase, userId } = auth;

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role, active_workspace_id")
    .eq("id", userId)
    .single();

  if (profErr || !profile) {
    return { ok: false, response: safeJsonError("Profile not found", 403, origin) };
  }

  const role = profile.role as string;
  if (!(SERVICE_ALLOWED_ROLES as readonly string[]).includes(role)) {
    return { ok: false, response: safeJsonError("Forbidden", 403, origin) };
  }

  const workspaceId = (profile.active_workspace_id as string | null) ?? "default";
  return { ok: true, supabase, userId, role, workspaceId };
}
