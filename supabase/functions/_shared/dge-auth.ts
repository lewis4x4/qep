/**
 * DGE/QRM auth helpers.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ES256 note (same issue as _shared/service-auth.ts)
 * ────────────────────────────────────────────────────────────────────────
 * This project signs JWTs with ES256. supabase-js v2's built-in verifier
 * rejects ES256 ("Unsupported JWT algorithm ES256"), so
 * `callerClient.auth.getUser()` / `.getUser(token)` both 401 every legit
 * user session in production.
 *
 * Fix: validate tokens against GoTrue's /auth/v1/user endpoint directly.
 * GoTrue knows the project's signing key and handles any algorithm the
 * project is on (HS256, ES256, RS256). One extra HTTP round-trip, <50ms.
 *
 * `validateUserToken()` below is the canonical path. `resolveCallerContext`
 * and direct callers (qrm-command-center, qrm-prediction-trace) use it
 * instead of supabase-js's local verifier.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "./cron-auth.ts";

export type UserRole = "rep" | "admin" | "manager" | "owner";
export type AppRole = UserRole;

interface ProfileRow {
  id: string;
  role: string | null;
  active_workspace_id: string | null;
}

export interface CallerContext {
  authHeader: string | null;
  userId: string | null;
  role: UserRole | null;
  isServiceRole: boolean;
  workspaceId: string | null;
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSupabaseUrl(): string {
  return getRequiredEnv("SUPABASE_URL");
}

function getSupabaseAnonKey(): string {
  return getRequiredEnv("SUPABASE_ANON_KEY");
}

function getSupabaseServiceRoleKey(): string {
  return getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/** True when `SUPABASE_URL` targets local CLI (`127.0.0.1` / `localhost`). Used by vendor inbound and other edge gates. */
export function isLocalSupabaseUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

export function shouldUseLocalClaimFallback(
  userId: string | null,
  hasAuthError: boolean,
): boolean {
  let isLocal = false;
  try {
    isLocal = isLocalSupabaseUrl(getSupabaseUrl());
  } catch {
    isLocal = false;
  }
  return isLocal && hasAuthError && Boolean(userId);
}

export function createAdminClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createCallerClient(authHeader: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

interface JwtClaims {
  sub?: unknown;
}

function normalizeRole(role: string | null | undefined): UserRole | null {
  if (
    role === "rep" || role === "admin" || role === "manager" || role === "owner"
  ) {
    return role;
  }
  return null;
}

function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readExplicitWorkspaceId(req: Request): string | null {
  return normalizeWorkspaceId(req.headers.get("x-workspace-id"));
}

function normalizeUserId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function decodeJwtClaims(token: string): JwtClaims | null {
  const segments = token.split(".");
  if (segments.length < 2) return null;

  try {
    const base64 = segments[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(segments[1].length / 4) * 4, "=");
    const decoded = JSON.parse(atob(base64)) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return null;
    }
    return decoded as JwtClaims;
  } catch {
    return null;
  }
}

function readUserIdClaim(claims: JwtClaims | null): string | null {
  if (!claims) return null;
  return normalizeUserId(claims.sub);
}

/**
 * Validate a user JWT against GoTrue's /auth/v1/user endpoint.
 *
 * This is the canonical ES256-safe path — side-steps supabase-js v2's
 * local verifier (which rejects ES256). Returns `{ ok: true, userId, email }`
 * on success, or `{ ok: false, reason }` with an explanatory code.
 *
 * `authHeader` is required because GoTrue expects it as-is on the
 * Authorization header alongside the anon key in the apikey header.
 */
export async function validateUserToken(
  authHeader: string | null,
): Promise<
  | { ok: true; userId: string; email: string | null }
  | {
    ok: false;
    reason: "missing_header" | "malformed" | "unauthorized" | "network";
  }
> {
  if (!authHeader) return { ok: false, reason: "missing_header" };
  const token = parseBearerToken(authHeader);
  if (!token) return { ok: false, reason: "malformed" };

  try {
    const supabaseUrl = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });
    if (!res.ok) return { ok: false, reason: "unauthorized" };
    const body = await res.json();
    if (!body || typeof body.id !== "string") {
      return { ok: false, reason: "unauthorized" };
    }
    const email = typeof body.email === "string" ? body.email : null;
    return { ok: true, userId: body.id, email };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function resolveCallerContext(
  req: Request,
  adminClient: SupabaseClient,
): Promise<CallerContext> {
  const authHeader = req.headers.get("Authorization");
  const token = parseBearerToken(authHeader);
  const claims = token ? decodeJwtClaims(token) : null;
  // Reuse the canonical service-caller contract so modern `sb_secret_`
  // service keys work through Authorization or apikey, while the internal
  // scheduler secret remains supported without duplicating comparisons.
  const serviceRole = isServiceRoleCaller(req);
  if (serviceRole) {
    return {
      authHeader,
      userId: null,
      role: null,
      isServiceRole: true,
      // Service credentials authorize the caller but never choose a tenant.
      // Only the explicit header is trusted here; bearer payloads are not
      // user-authenticated claims and must not steer workspace selection.
      workspaceId: readExplicitWorkspaceId(req),
    };
  }

  if (!authHeader) {
    return {
      authHeader: null,
      userId: null,
      role: null,
      isServiceRole: false,
      workspaceId: null,
    };
  }

  // ES256-safe token validation via GoTrue. supabase-js's local verifier
  // rejects the project's ES256-signed tokens, so we validate server-side.
  const validated = await validateUserToken(authHeader);
  const authError = validated.ok ? null : new Error(validated.reason);
  const userId = validated.ok ? validated.userId : readUserIdClaim(claims);
  const useLocalClaimFallback = shouldUseLocalClaimFallback(
    userId,
    Boolean(authError),
  );
  if ((!useLocalClaimFallback && authError) || !userId) {
    return {
      authHeader,
      userId: null,
      role: null,
      isServiceRole: false,
      workspaceId: null,
    };
  }

  // Authorization always comes from current database truth. Supabase
  // `user_metadata` is user-editable and must never select a role or tenant;
  // even signed JWT claims can be stale after a role/workspace reassignment.
  // The validated token supplies identity only, then the admin client resolves
  // that identity's current profile row.
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, active_workspace_id")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  const role = profileError ? null : normalizeRole(profile?.role);
  const workspaceId = profileError
    ? null
    : normalizeWorkspaceId(profile?.active_workspace_id);

  return {
    authHeader,
    userId,
    role,
    isServiceRole: false,
    workspaceId,
  };
}
