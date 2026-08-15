/**
 * Parts Predictive AI — Slice 3.3b (Claude-Augmented Plays).
 *
 * Auth: service_role (cron) OR admin/manager/owner (manual UI trigger).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace cannot widen or retarget fleet scope.
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { safeJsonError } from "../_shared/safe-cors.ts";
import { handlePartsPredictiveAi } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handlePartsPredictiveAi(req);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-predictive-ai" });
    return safeJsonError((err as Error).message, 500, req.headers.get("Origin"));
  }
});
