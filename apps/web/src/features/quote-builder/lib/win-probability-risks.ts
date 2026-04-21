/**
 * Win-Probability Risk Analysis — Slice 20n.
 *
 * The counterweight to `computeWinProbabilityLifts` (from the main
 * scorer module). Lifts answer "what could the rep do to move the
 * score UP?" — upside the deal hasn't claimed yet. Risks answer the
 * mirror question: "what is this deal currently RESTING ON? If this
 * assumption fell through, how far would the score drop?"
 *
 * Concrete case the rep faces: score reads 78 (strong), and the rep
 * reads that as a safe deal. But the 78 is propped up by +25 from
 * "Warm customer" and +10 from "Trade in hand". If the customer goes
 * cool OR the trade photo turns out misvalued, the score would crash
 * to 43 (mixed). The rep needs to SEE that brittleness before sending
 * the quote, so they can either lock in those assumptions (get a
 * deposit, confirm trade appraisal) or price accordingly.
 *
 * Mechanics: for every factor with positive weight, simulate removing
 * it from the rawScore and recompute the clamped score. The delta
 * tells us how many points that factor contributes in practice —
 * which can differ from the raw weight when the rawScore is near a
 * clamp boundary. At rawScore=105 (clamped to 95), removing a +10
 * factor leaves rawScore=95, clamped=95 — zero real impact. We
 * filter those out so the "resting on" list only shows factors whose
 * removal would actually dent the visible score.
 *
 * No new UI copy per factor kind; label + delta is enough to convey
 * the risk. Action-hint copy (how to protect each factor) is deferred
 * — pressure-testing that we can cheaply surface the top risks is
 * slice scope; per-factor protection flows can layer in later.
 */

import type {
  WinProbabilityFactor,
  WinProbabilityResult,
} from "./win-probability-scorer";

/** Maximum risks surfaced (keep UI uncluttered, mirrors MAX_LIFTS). */
export const MAX_RISKS = 3;

/**
 * Minimum absolute point delta for a factor to show up as a risk.
 * Below this we treat the factor as "cosmetic support" — its removal
 * wouldn't meaningfully reshape the rep's read on the deal. Mirrors
 * `MIN_LIFT_DELTA` so the upside and downside surfaces use the same
 * noise floor.
 */
export const MIN_RISK_DELTA = 3;

export interface WinProbabilityRisk {
  /** Factor label as the scorer emitted it — stable for the rep's
   *  mental model ("Warm customer", "Trade in hand"). */
  label: string;
  /** Factor kind — carries through for UI coloring so the risks row
   *  matches the factors row visually. */
  kind: WinProbabilityFactor["kind"];
  /**
   * Positive points the *clamped* score would drop if this factor
   * disappeared. Always > 0 by construction; a factor whose removal
   * wouldn't move the clamped score is filtered out before this
   * shape is built.
   */
  deltaPts: number;
  /**
   * One-liner the rep reads on hover / in the expanded panel.
   * Stays factual — "Warm customer is holding up X of the Y points."
   * We resist pushing scare copy; the point count is the signal.
   */
  rationale: string;
}

/**
 * Clamp identical to the scorer's own clamp logic. Duplicated here
 * (cheap, two lines) rather than imported to keep this module pure
 * and independent of the scorer's internals — if the scorer ever
 * swaps its clamp range, the test suite will catch the drift via
 * a ceiling/floor-edge case test.
 */
function clamp(score: number): number {
  return Math.max(5, Math.min(95, Math.round(score)));
}

/**
 * Compute the top "resting on" risks for a scored deal.
 *
 * Only factors with positive weight are candidates — negative
 * factors are already dragging the score, so their removal would
 * *help*, not hurt. Zero-weight factors are noise by definition.
 *
 * Truncated to `MAX_RISKS`, sorted by `deltaPts` descending, and
 * filtered below `MIN_RISK_DELTA`. When the score sits at the clamp
 * ceiling, the clamp absorbs part of every factor's weight — a +10
 * factor might only account for +4 of the visible score. We honor
 * the visible delta, not the raw weight, because the rep experiences
 * the visible number.
 */
export function computeWinProbabilityRisks(
  result: WinProbabilityResult,
): WinProbabilityRisk[] {
  const risks: WinProbabilityRisk[] = [];
  const baselineScore = result.score;

  for (const f of result.factors) {
    if (f.weight <= 0) continue;
    const scoreWithout = clamp(result.rawScore - f.weight);
    const deltaPts = baselineScore - scoreWithout;
    if (deltaPts < MIN_RISK_DELTA) continue;
    risks.push({
      label: f.label,
      kind: f.kind,
      deltaPts,
      rationale: `${f.label} contributes ${deltaPts} of the ${baselineScore} points — the deal is leaning on this assumption.`,
    });
  }

  risks.sort((a, b) => b.deltaPts - a.deltaPts);
  return risks.slice(0, MAX_RISKS);
}

/**
 * Headline for the risks row. Returns null when there's nothing to
 * say (no qualifying risks) so the UI can skip rendering entirely.
 * When we DO have risks, the headline is scoped to the combined
 * exposure: "If these 3 hold, the floor is X pts lower."
 *
 * The "combined exposure" number is a SERIAL sum, not a parallel
 * simulation — removing two factors together can hit a clamp harder
 * than the sum of individual removals suggests. We don't model that
 * interaction here; the rep reading "if trade and warmth both fall
 * through, floor is ~35 pts lower" already gets the directional
 * truth, and modeling joint removals adds a combinatorial mess of
 * copy for negligible signal gain.
 */
export function describeRisksHeadline(risks: WinProbabilityRisk[]): string | null {
  if (risks.length === 0) return null;
  const totalDelta = risks.reduce((a, r) => a + r.deltaPts, 0);
  if (risks.length === 1) {
    return `Resting on ${risks[0].label.toLowerCase()} — if it slips, floor is ${risks[0].deltaPts} pts lower.`;
  }
  return `Resting on ${risks.length} assumptions worth ~${totalDelta} pts of the score.`;
}
