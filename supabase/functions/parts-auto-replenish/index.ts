/**
 * Parts Auto-Replenish — autonomous inventory replenishment engine.
 *
 * Cron: service_role, runs after parts-reorder-compute (daily or on-demand).
 * JWT: admin/manager/owner scoped to profile.active_workspace_id.
 *
 * For each (workspace, branch, part_number) where qty_on_hand <= reorder_point:
 *   1. Check replenishment rules (enabled, cooldown, excluded parts)
 *   2. Score available vendors (composite: lead time, fill rate, price, responsiveness)
 *   3. Create auto_replenish_queue entry (pending or auto_approved if below threshold)
 *   4. Update vendor composite scores
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { safeJsonError } from "../_shared/safe-cors.ts";
import { handlePartsAutoReplenish } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handlePartsAutoReplenish(req);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-auto-replenish", req });
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
