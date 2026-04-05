/**
 * Service engine edge functions: JWT-only auth (no service_role impersonation).
 * Aligns with RLS — callers use anon key + user JWT.
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

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, response: safeJsonError("Unauthorized", 401, origin) };
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profErr || !profile) {
    return { ok: false, response: safeJsonError("Profile not found", 403, origin) };
  }

  const role = profile.role as string;
  if (!(SERVICE_ALLOWED_ROLES as readonly string[]).includes(role)) {
    return { ok: false, response: safeJsonError("Forbidden", 403, origin) };
  }

  return { ok: true, supabase, userId: user.id, role };
}
