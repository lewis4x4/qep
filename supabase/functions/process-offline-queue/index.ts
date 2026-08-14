/**
 * Process Offline Queue — Sales Companion
 *
 * Accepts an array of queued actions captured while the rep was offline.
 * Processes them in causal order, returns per-action success/failure.
 */
import { handleProcessOfflineQueue } from "./handler.ts";

Deno.serve((req) => handleProcessOfflineQueue(req));
