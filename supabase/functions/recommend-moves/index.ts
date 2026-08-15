/**
 * Recommend-Moves Edge Function (Slice 2)
 *
 * Pulls unprocessed signals → runs the deterministic rule-based recommender
 * → inserts deduped moves for the Today surface.
 *
 * Callable by:
 *   1. pg_cron every N minutes via x-internal-service-secret (bulk sweep).
 *   2. Elevated users (admin/manager/owner) from the Today surface via a
 *      normal JWT — typically after they ingest a batch of signals.
 *
 * Workspace scoping and auth are enforced in handler.ts.
 */
import { handleRecommendMoves } from "./handler.ts";

Deno.serve((req) => handleRecommendMoves(req));
