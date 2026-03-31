import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type RateLimitRpcParams = {
  userId: string;
  endpoint: string;
  maxRequests: number;
  windowSeconds: number;
};

/**
 * Enforces per-user rolling limits via `check_rate_limit` RPC.
 * If the RPC errors (permissions, schema drift, PostgREST issues), falls back to
 * counting/inserting `rate_limit_log` with the service-role client — same pattern
 * as voice-capture. Prevents false "chat unavailable" 503s when only the RPC path breaks.
 */
export async function enforceRateLimitWithFallback(
  admin: SupabaseClient,
  p: RateLimitRpcParams,
): Promise<boolean> {
  const rpcResult = await admin.rpc("check_rate_limit", {
    p_user_id: p.userId,
    p_endpoint: p.endpoint,
    p_max_requests: p.maxRequests,
    p_window_seconds: p.windowSeconds,
  });

  // Match voice-capture: only explicit `false` denies. `null`/undefined from PostgREST
  // must not lock everyone out as "rate limited".
  if (!rpcResult.error) {
    return rpcResult.data !== false;
  }

  console.warn(
    `[rate-limit] check_rate_limit RPC failed endpoint=${p.endpoint}`,
    rpcResult.error,
  );

  const windowMs = p.windowSeconds * 1000;
  const windowStartIso = new Date(Date.now() - windowMs).toISOString();

  const countResult = await admin
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", p.userId)
    .eq("endpoint", p.endpoint)
    .gte("created_at", windowStartIso);

  if (countResult.error) {
    console.error(`[rate-limit] fallback count failed endpoint=${p.endpoint}`, countResult.error);
    return true;
  }

  if ((countResult.count ?? 0) >= p.maxRequests) {
    return false;
  }

  const insertResult = await admin
    .from("rate_limit_log")
    .insert({ user_id: p.userId, endpoint: p.endpoint });

  if (insertResult.error) {
    console.error(`[rate-limit] fallback insert failed endpoint=${p.endpoint}`, insertResult.error);
  }

  return true;
}
