/**
 * Meta Social Posting Edge Function
 *
 * Publishes equipment listings and marketing content to Facebook/Instagram.
 * Uses Meta Graph API for Facebook Marketplace auto-posting.
 *
 * POST /post: Create a social media post
 * POST /schedule: Schedule a post for future publishing
 * GET /accounts: List configured social accounts
 *
 * Auth: admin/owner (manual) or service_role (marketing-engine cron)
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { handleMetaSocial } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleMetaSocial(req);
  } catch (err) {
    captureEdgeException(err, { fn: "meta-social", req });
    console.error("meta-social error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
