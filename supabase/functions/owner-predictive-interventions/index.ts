/**
 * Owner Predictive Interventions — Slice E of the Owner Dashboard moonshot.
 *
 * Claude Sonnet 4.6 looks at the current business state and projects 3-4
 * forward-looking scenarios ("what happens if"), each with:
 *   - title
 *   - projection (1 sentence: the trajectory)
 *   - rationale (1 sentence: why, grounded in numbers)
 *   - impact_usd (estimated dollar impact if unmanaged)
 *   - horizon_days
 *   - severity (high/medium/low)
 *   - action { label, route }  — click-through into the right deep page
 *
 * Read sources: owner_dashboard_summary, compute_ownership_health_score,
 * v_branch_stack_ranking, predicted_parts_plays (open), qrm_deals (stalled).
 *
 * Auth: admin/manager/owner JWT (workspace-scoped) or service_role.
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace is ignored. Service-role may pass x-workspace-id or
 * body.workspace for an explicit shop target.
 *
 * Cached for 30 min in a lightweight Postgres table.
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { safeJsonError } from "../_shared/safe-cors.ts";
import { handleOwnerPredictiveInterventions } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleOwnerPredictiveInterventions(req);
  } catch (err) {
    captureEdgeException(err, { fn: "owner-predictive-interventions" });
    return safeJsonError((err as Error).message, 500, req.headers.get("Origin"));
  }
});
