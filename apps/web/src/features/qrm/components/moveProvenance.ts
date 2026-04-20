/**
 * moveProvenance — classify *why* a move is on the operator's Today.
 *
 * Slice 7 of the 4-surface collapse. Moves can arrive from three places:
 *
 *   1. "iron"        — queued by Ask Iron's propose_move tool (Slice 6).
 *                      The server stamps `recommender = "ask_iron"`.
 *   2. "recommender" — written by the deterministic rule engine (Slice 2+).
 *                      Any other non-null `recommender` slug.
 *   3. "manual"      — created directly by an operator (CreateMove route, or
 *                      an admin script). `recommender` is null.
 *
 * Why this matters: the operator trusts recommender output differently than
 * Iron output. Without provenance, Today is a flat list — "why is THIS on my
 * list?" becomes a guessing game. With provenance, the rep can filter
 * ("show me what Iron queued this morning") and managers can audit
 * ("how many of today's completions came from Iron?").
 *
 * This module is intentionally React-free so Bun tests can exercise the
 * classifier without happy-dom.
 */

import type { QrmMove } from "../lib/moves-types";

export type MoveProvenance = "iron" | "recommender" | "manual";

/** The slug stamped by Ask Iron's propose_move tool (qrm-ask-iron.ts). */
export const ASK_IRON_RECOMMENDER_SLUG = "ask_iron";

export function classifyMoveProvenance(
  move: Pick<QrmMove, "recommender">,
): MoveProvenance {
  const r = move.recommender;
  if (!r || r.length === 0) return "manual";
  if (r === ASK_IRON_RECOMMENDER_SLUG) return "iron";
  return "recommender";
}

export const PROVENANCE_LABEL: Record<MoveProvenance, string> = {
  iron: "Ask Iron",
  recommender: "Recommender",
  manual: "Manual",
};

/**
 * Short 1-sentence description shown in a tooltip/title attribute. Operator
 * reads this to decide "do I trust this card blindly, or do I want to read
 * the rationale first?".
 */
export const PROVENANCE_EXPLAINER: Record<MoveProvenance, string> = {
  iron: "Queued by Ask Iron on your request",
  recommender: "Surfaced by the QRM recommender from your signals",
  manual: "Created manually",
};

/**
 * Predicate used by the Today filter pills. `"all"` is the universal pass-
 * through — kept as its own sentinel so the callsite doesn't need to branch
 * on Array.includes when no filter is active.
 */
export type ProvenanceFilter = "all" | MoveProvenance;

export function moveMatchesProvenanceFilter(
  move: Pick<QrmMove, "recommender">,
  filter: ProvenanceFilter,
): boolean {
  if (filter === "all") return true;
  return classifyMoveProvenance(move) === filter;
}

/**
 * Sum provenance counts across a move list. Used by the filter bar to render
 * the count badges ("Ask Iron · 3") so operators see distribution at a
 * glance without flipping filters.
 */
export function countMovesByProvenance(
  moves: ReadonlyArray<Pick<QrmMove, "recommender">>,
): Record<MoveProvenance, number> {
  const counts: Record<MoveProvenance, number> = {
    iron: 0,
    recommender: 0,
    manual: 0,
  };
  for (const m of moves) counts[classifyMoveProvenance(m)] += 1;
  return counts;
}
