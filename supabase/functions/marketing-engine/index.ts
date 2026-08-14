/**
 * Marketing Engine Edge Function (Cron + Manual)
 *
 * Autonomous marketing automation:
 * - Process inventory event triggers → create campaigns
 * - Generate AI content for campaign recipients
 * - Auto-post to social media platforms
 * - Track engagement and attribution
 *
 * POST (cron): Process pending triggers and scheduled campaigns
 * POST (manual): { action: "create_campaign" | "generate_content" | "send_campaign" }
 *
 * Auth: service_role (cron) or admin/manager/owner (manual).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace_id is ignored. Service-role may pass workspace_id or
 * x-workspace-id to target one shop, or run unscoped for shop-wide cron.
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { handleMarketingEngine } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleMarketingEngine(req);
  } catch (err) {
    captureEdgeException(err, { fn: "marketing-engine", req });
    console.error("marketing-engine error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
