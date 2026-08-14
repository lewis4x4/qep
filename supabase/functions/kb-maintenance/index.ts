/**
 * KB Maintenance Edge Function
 *
 * Re-embeds published documents, service notes, and CRM embeddings, and
 * validates embedding dimensions for Iron/search quality.
 *
 * Auth: admin/manager/owner JWT (workspace-scoped) or service_role (ops/cron).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace_id is ignored. Service-role may pass workspace_id or
 * x-workspace-id to target one shop, or run unscoped for shop-wide cron.
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { handleKbMaintenance } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleKbMaintenance(req);
  } catch (error) {
    captureEdgeException(error, { fn: "kb-maintenance", req });
    console.error("[kb-maintenance] error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
