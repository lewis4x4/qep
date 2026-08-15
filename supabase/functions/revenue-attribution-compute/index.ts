/**
 * Revenue Attribution Compute Edge Function (Phase D)
 *
 * Walks the touch chain back from a closed-won deal — qrm_activities,
 * voice_captures, marketing_engine events (best-effort), in-app
 * notifications — and persists a row per attribution_model into
 * revenue_attribution.
 *
 * Implements four standard models:
 *   - first_touch  → 100% to the earliest touch
 *   - last_touch   → 100% to the latest touch
 *   - linear       → equal split across all touches
 *   - time_decay   → 7-day half-life weight
 *
 * Modes:
 *   POST /compute            { deal_id }    — recompute one deal
 *   POST /batch              { deal_ids[] } — recompute many (max 50)
 *   POST /scan-recent-wins                  — scan all closed-won deals
 *                                              from the last 30 days
 *
 * Auth: rep/admin/manager/owner (workspace-scoped via profile.active_workspace_id)
 *       OR service_role / cron (unscoped or x-workspace-id / body.workspace hint).
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { safeJsonError } from "../_shared/safe-cors.ts";
import { handleRevenueAttributionCompute } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleRevenueAttributionCompute(req);
  } catch (err) {
    captureEdgeException(err, { fn: "revenue-attribution-compute", req });
    console.error("revenue-attribution-compute error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
