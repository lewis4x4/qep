/**
 * Parts Predictive Failure — Phase 3.3 Moonshot.
 *
 * For each customer machine we track, projects which parts will likely be
 * needed in the next 90 days, and tells the sales rep to pre-position them.
 *
 * Auth: admin / manager / owner JWT (workspace-scoped) or service_role (cron).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace / body.workspace_id is ignored. Service-role may pass
 * workspace hints or run unscoped for shop-wide cron.
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { handlePartsPredictiveFailure } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handlePartsPredictiveFailure(req);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-predictive-failure", req });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
