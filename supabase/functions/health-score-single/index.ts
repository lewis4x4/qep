/**
 * Health Score Single — On-demand per-customer refresh (Slice 3.3)
 *
 * Recomputes the health score for a single customer profile and returns
 * the updated score + delta. Used by inline "refresh" buttons on company
 * cards and deal pages when the user wants up-to-the-minute data.
 *
 * POST { customer_profile_id: string }
 *   → { score, components, delta_7d, delta_30d, delta_90d }
 *
 * Auth: any authenticated user (RLS controls visibility)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (req.method !== "POST") {
      return safeJsonError("Method not allowed", 405, origin);
    }

    // Canonical JWT auth — ES256-safe, gates rep/admin/manager/owner.
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    // Service-role admin client for compute_customer_health_score +
    // get_health_score_with_deltas RPCs (they span workspaces).
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const profileId = body.customer_profile_id;
    if (!profileId) {
      return safeJsonError("customer_profile_id required", 400, origin);
    }

    // Recompute health score via RPC
    const { error: computeErr } = await adminClient.rpc("compute_customer_health_score", {
      p_customer_profile_id: profileId,
    });

    if (computeErr) {
      console.error("[health-score-single] compute failed:", computeErr.message);
      return safeJsonError("Score computation failed", 500, origin);
    }

    // Fetch updated score + deltas
    const { data: deltas, error: deltaErr } = await adminClient.rpc("get_health_score_with_deltas", {
      p_customer_profile_id: profileId,
    });

    if (deltaErr) {
      console.error("[health-score-single] delta fetch failed:", deltaErr.message);
      return safeJsonError("Delta fetch failed", 500, origin);
    }

    return safeJsonOk({
      score: deltas?.current_score ?? null,
      components: deltas?.components ?? {},
      delta_7d: deltas?.delta_7d ?? null,
      delta_30d: deltas?.delta_30d ?? null,
      delta_90d: deltas?.delta_90d ?? null,
      refreshed_at: new Date().toISOString(),
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "health-score-single", req });
    console.error("[health-score-single] error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
});
