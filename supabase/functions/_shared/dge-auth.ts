import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type UserRole = "rep" | "admin" | "manager" | "owner";
export type AppRole = UserRole;

interface ProfileRow {
  id: string;
  role: string | null;
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

function getDgeInternalServiceSecret(): string | null {
  return Deno.env.get("DGE_INTERNAL_SERVICE_SECRET") ?? null;
}

function isLocalSupabaseUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

export function shouldUseLocalClaimFallback(userId: string | null, hasAuthError: boolean): boolean {
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
  workspace_id?: unknown;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
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
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeUserId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function readWorkspaceClaim(claims: JwtClaims | null): string | null {
  if (!claims) return null;

  return normalizeWorkspaceId(claims.workspace_id) ??
    normalizeWorkspaceId(claims.app_metadata?.workspace_id) ??
    normalizeWorkspaceId(claims.user_metadata?.workspace_id);
}

function readRoleClaim(claims: JwtClaims | null): UserRole | null {
  if (!claims) return null;

  return normalizeRole(
    typeof claims.app_metadata?.role === "string"
      ? claims.app_metadata.role
      : typeof claims.user_metadata?.role === "string"
      ? claims.user_metadata.role
      : null,
  );
}

function readUserIdClaim(claims: JwtClaims | null): string | null {
  if (!claims) return null;
  return normalizeUserId(claims.sub);
}

async function resolveServiceWorkspaceId(authHeader: string | null): Promise<string | null> {
  const token = parseBearerToken(authHeader);
  const workspaceId = readWorkspaceClaim(token ? decodeJwtClaims(token) : null);
  if (!workspaceId || !authHeader) {
    return null;
  }

  const callerClient = createCallerClient(authHeader);
  const { data, error } = await callerClient.rpc("get_my_workspace");
  if (error || typeof data !== "string") {
    return null;
  }

  return data.trim() === workspaceId ? workspaceId : null;
}

function isServiceRoleRequest(req: Request): boolean {
  const internalServiceSecret = getDgeInternalServiceSecret();
  if (!internalServiceSecret) return false;
  const internalSecret = req.headers.get("x-internal-service-secret");
  if (!internalSecret) return false;
  return internalSecret === internalServiceSecret;
}

export async function resolveCallerContext(
  req: Request,
  adminClient: SupabaseClient,
): Promise<CallerContext> {
  const authHeader = req.headers.get("Authorization");
  const token = parseBearerToken(authHeader);
  const claims = token ? decodeJwtClaims(token) : null;
  const serviceRole = isServiceRoleRequest(req);
  if (serviceRole) {
    return {
      authHeader,
      userId: null,
      role: null,
      isServiceRole: true,
      workspaceId: readWorkspaceClaim(claims) ?? await resolveServiceWorkspaceId(authHeader),
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

  const callerClient = createCallerClient(authHeader);
  const { data: authData, error: authError } = await callerClient.auth
    .getUser();
  const userId = authData.user?.id ?? readUserIdClaim(claims);
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

  const roleFromClaims = readRoleClaim(claims);
  let role = roleFromClaims;
  if (!role) {
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .single<ProfileRow>();
    role = normalizeRole(profile?.role);
  }

  const workspaceFromClaims = readWorkspaceClaim(claims);
  let workspaceId = workspaceFromClaims;
  if (!workspaceId) {
    const { data: workspaceData } = await callerClient.rpc("get_my_workspace");
    workspaceId = typeof workspaceData === "string" && workspaceData.trim().length > 0
      ? workspaceData.trim()
      : null;
  }

  return {
    authHeader,
    userId,
    role,
    isServiceRole: false,
    workspaceId,
  };
}
