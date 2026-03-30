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
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function createAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createCallerClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

function normalizeRole(role: string | null | undefined): UserRole | null {
  if (
    role === "rep" || role === "admin" || role === "manager" || role === "owner"
  ) {
    return role;
  }
  return null;
}

function isServiceRoleRequest(authHeader: string | null): boolean {
  if (!authHeader) return false;
  return authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
}

export async function resolveCallerContext(
  req: Request,
  adminClient: SupabaseClient,
): Promise<CallerContext> {
  const authHeader = req.headers.get("Authorization");
  const serviceRole = isServiceRoleRequest(authHeader);
  if (!authHeader) {
    return {
      authHeader: null,
      userId: null,
      role: null,
      isServiceRole: serviceRole,
    };
  }

  if (serviceRole) {
    return {
      authHeader,
      userId: null,
      role: null,
      isServiceRole: true,
    };
  }

  const callerClient = createCallerClient(authHeader);
  const { data: authData, error: authError } = await callerClient.auth
    .getUser();
  const userId = authData.user?.id ?? null;
  if (authError || !userId) {
    return {
      authHeader,
      userId: null,
      role: null,
      isServiceRole: false,
    };
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .single<ProfileRow>();

  return {
    authHeader,
    userId,
    role: normalizeRole(profile?.role),
    isServiceRole: false,
  };
}
