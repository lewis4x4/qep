/**
 * Handoff Trust Scorer — nightly edge function (Phase 3 Slice 3.1)
 *
 * Scores unscored handoff_events and computes rolling role-seam aggregates.
 * Workspace scoping and JWT tenant isolation are enforced in handler.ts.
 */
import { handleHandoffTrustScorer } from "./handler.ts";

Deno.serve((req) => handleHandoffTrustScorer(req));
