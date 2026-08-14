/**
 * Parts Embedding Backfill — Slice 3.1 (Natural-Language Parts Search).
 *
 * Reads v_parts_embedding_backlog in batches, composes semantic text per part,
 * calls OpenAI text-embedding-3-small, writes vectors back to parts_catalog.
 *
 * Auth: admin/manager/owner JWT (workspace-scoped) or service_role (ops/cron).
 * JWT callers are always bound to profile.active_workspace_id; forged body.workspace
 * is ignored. Service-role may pass workspace or x-workspace-id to target one shop,
 * or run unscoped for shop-wide cron.
 */
import { captureEdgeException } from "../_shared/sentry.ts";
import { handlePartsEmbedBackfill } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handlePartsEmbedBackfill(req);
  } catch (error) {
    captureEdgeException(error, { fn: "parts-embed-backfill", req });
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
