/**
 * QRM Record Embedding Edge Function
 *
 * Generates text summaries of QRM records (contacts, companies, deals,
 * equipment, voice captures, activities), embeds them via OpenAI, and
 * upserts into the crm_embeddings table for semantic search.
 *
 * Auth: admin/manager/owner JWT (workspace-scoped) or service_role (ops/cron).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace_id is ignored. Service-role may pass workspace_id or
 * x-workspace-id to target one shop, or run unscoped for shop-wide cron.
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { handleEmbedCrm } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleEmbedCrm(req);
  } catch (error) {
    captureEdgeException(error, { fn: "embed-crm", req });
    console.error("[embed-crm] error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
