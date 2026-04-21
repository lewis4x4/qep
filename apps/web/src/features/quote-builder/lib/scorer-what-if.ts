/**
 * Scorer What-If Preview — Slice 20p.
 *
 * 20m hands the manager a proposed scorer evolution: "flip these 2
 * factors, weaken this one, drop that one, keep the rest." What it
 * doesn't tell them is the thing they actually want to know before
 * they hit the ticket button:
 *
 *   "If I apply this proposal, does the scorer get MORE accurate
 *    against the deals we've already closed, or less?"
 *
 * This module answers that. It takes the proposal plus the stored
 * closed-deal audits (20h rows — each carries the full factor list
 * captured at save time) and simulates what the scorer WOULD HAVE
 * said had the proposal already been in effect. It then compares
 * current vs. simulated Brier score and hit-rate.
 *
 * Why this matters for Move 2: without this preview, "evolve the
 * scorer" is a leap-of-faith change. With it, every proposal is
 * defensible — "Brier went from 0.21 to 0.17 on our last 40 deals"
 * is a sentence a manager can put in a PR description and a VP can
 * challenge. The rule-based scorer becomes measurably self-improving,
 * which is the baseline a future ML model has to beat.
 *
 * Pure functions — no I/O. The component wires proposal + audits
 * through here and renders the result.
 *
 * Limitations we accept:
 *   • `row.score` is the already-clamped stored score, not the raw.
 *     For deals whose raw blew past the ceiling (95) or floor (5),
 *     removing a factor won't move the simulated score until the
 *     headroom is exhausted. Over a realistic sample this understates
 *     the proposal's effect slightly, but always in the conservative
 *     direction — we'd rather not over-claim improvement.
 *   • The audit row carries `{label, weight}` per factor but not the
 *     factor's underlying rule. We therefore can't simulate brand-new
 *     factors being ADDED; only existing ones modified. Adding factors
 *     is out of scope for a PREVIEW — it's a design change, not a
 *     tuning.
 */

import type { ScorerAction, ScorerProposal } from "./scorer-proposal";
import type { ClosedDealAuditRow } from "./closed-deals-audit";

/**
 * How an action translates to a per-deal weight adjustment.
 *
 *   • `keep`       : no change
 *   • `strengthen` : factor delivers +50% more contribution
 *   • `weaken`     : factor delivers 50% less contribution
 *   • `flip`       : contribution inverts (sign flips, magnitude kept)
 *   • `drop`       : contribution removed entirely
 *
 * These are multipliers on the STORED weight; the simulated score is
 * `current + (multiplier - 1) * storedWeight`. We keep them centralized
 * (rather than inlined in the loop) so the test matrix can pin them
 * down as part of the module's contract.
 */
export const ACTION_MULTIPLIERS: Record<ScorerAction, number> = {
  keep: 1,
  strengthen: 1.5,
  weaken: 0.5,
  flip: -1,
  drop: 0,
};

/**
 * Minimum closed-deal audits required to trust a simulated metric.
 * Chosen at 5 (below 20f's 10-row `lowConfidence` threshold) because a
 * what-if comparison cares about DIRECTION more than magnitude — even
 * 5 deals can tell us "Brier went up vs. down" with a straight face —
 * but we still want to refuse to quote a single-digit Brier number
 * when the sample is 0-4. Callers can read `lowConfidence` and decide
 * whether to show the number or a "gathering more evidence" stub.
 */
export const MIN_SIMULATION_SAMPLE = 5;

/** The same score band the scorer + 20f calibration use. */
function scoreToBand(score: number): "strong" | "healthy" | "mixed" | "at_risk" {
  if (score >= 70) return "strong";
  if (score >= 55) return "healthy";
  if (score >= 35) return "mixed";
  return "at_risk";
}

/** Treat strong/healthy as "scorer predicted win", matching 20f. */
function predictedWin(score: number): boolean {
  const band = scoreToBand(score);
  return band === "strong" || band === "healthy";
}

/** Same clamp the scorer applies — [5, 95] integer. */
function clamp(score: number): number {
  if (!Number.isFinite(score)) return 50;
  return Math.max(5, Math.min(95, Math.round(score)));
}

/**
 * One simulated deal — same shape the UI can use for a per-row
 * breakdown if it wants to surface the audits that changed the most.
 */
export interface SimulatedDeal {
  packageId: string;
  outcome: "won" | "lost" | "expired";
  predicted: number;
  simulated: number;
  /** simulated - predicted. Positive = proposal raised the score. */
  delta: number;
}

export interface ScorerWhatIfResult {
  /** Number of audits the simulation used. */
  dealsSimulated: number;
  /** Brier on stored scores (lower = better). Null when no deals. */
  currentBrier: number | null;
  /** Brier under the proposal. Null when no deals. */
  simulatedBrier: number | null;
  /** simulatedBrier - currentBrier. Negative = proposal improves accuracy. */
  brierDelta: number | null;
  /** Hit-rate = (predicted win == actually won) on stored scores. Null when no deals. */
  currentHitRate: number | null;
  /** Hit-rate under the proposal. Null when no deals. */
  simulatedHitRate: number | null;
  /** simulatedHitRate - currentHitRate. Positive = proposal improves. */
  hitRateDelta: number | null;
  /** Per-deal breakdown (sorted by |delta| desc). Empty when no deals. */
  perDeal: SimulatedDeal[];
  /** True when sample < MIN_SIMULATION_SAMPLE — directional only. */
  lowConfidence: boolean;
  /**
   * True when the proposal has zero actionable changes (all `keep`).
   * In that case Brier/hit-rate deltas are guaranteed 0 and the UI
   * should hide the preview rather than show "0.00 → 0.00".
   */
  noActionableChanges: boolean;
}

/**
 * Simulate the proposal against historical closed-deal audits.
 *
 * Returns an empty shape with `dealsSimulated=0` when either input
 * is empty or null. The caller is expected to have already fetched
 * both; this function does not short-circuit on `lowConfidence` from
 * the underlying proposal — a manager may want to preview even a
 * tentative proposal.
 */
export function simulateProposalCalibration(
  proposal: ScorerProposal | null,
  audits: ClosedDealAuditRow[] | null,
): ScorerWhatIfResult {
  const actionsByLabel = new Map<string, ScorerAction>();
  if (proposal && proposal.changes.length > 0) {
    for (const c of proposal.changes) {
      actionsByLabel.set(c.label, c.action);
    }
  }

  const actionable =
    proposal?.changes.filter((c) => c.action !== "keep").length ?? 0;
  const noActionableChanges = actionable === 0;

  const rows = (audits ?? []).filter(
    (r) =>
      r != null &&
      typeof r.packageId === "string" &&
      r.packageId.length > 0 &&
      Number.isFinite(r.score) &&
      (r.outcome === "won" || r.outcome === "lost" || r.outcome === "expired") &&
      Array.isArray(r.factors),
  );

  if (rows.length === 0) {
    return {
      dealsSimulated: 0,
      currentBrier: null,
      simulatedBrier: null,
      brierDelta: null,
      currentHitRate: null,
      simulatedHitRate: null,
      hitRateDelta: null,
      perDeal: [],
      lowConfidence: false,
      noActionableChanges,
    };
  }

  const perDeal: SimulatedDeal[] = [];
  let currentBrierSum = 0;
  let simulatedBrierSum = 0;
  let currentHits = 0;
  let simulatedHits = 0;

  for (const row of rows) {
    const predicted = clamp(row.score);

    // Sum up the per-factor adjustments the proposal implies for this
    // specific deal's stored weights.
    let deltaSum = 0;
    for (const f of row.factors) {
      if (!f || typeof f.label !== "string" || !Number.isFinite(f.weight)) continue;
      const action = actionsByLabel.get(f.label);
      if (!action) continue; // factor wasn't in the proposal — leave untouched
      const multiplier = ACTION_MULTIPLIERS[action];
      deltaSum += (multiplier - 1) * f.weight;
    }

    const simulated = clamp(predicted + deltaSum);
    const didWin = row.outcome === "won";
    const realized = didWin ? 1 : 0;

    const predProb = predicted / 100;
    const simProb = simulated / 100;
    currentBrierSum += (predProb - realized) * (predProb - realized);
    simulatedBrierSum += (simProb - realized) * (simProb - realized);

    if (predictedWin(predicted) === didWin) currentHits += 1;
    if (predictedWin(simulated) === didWin) simulatedHits += 1;

    perDeal.push({
      packageId: row.packageId,
      outcome: row.outcome,
      predicted,
      simulated,
      delta: simulated - predicted,
    });
  }

  perDeal.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const n = rows.length;
  const currentBrier = currentBrierSum / n;
  const simulatedBrier = simulatedBrierSum / n;
  const currentHitRate = currentHits / n;
  const simulatedHitRate = simulatedHits / n;

  return {
    dealsSimulated: n,
    currentBrier,
    simulatedBrier,
    brierDelta: simulatedBrier - currentBrier,
    currentHitRate,
    simulatedHitRate,
    hitRateDelta: simulatedHitRate - currentHitRate,
    perDeal,
    lowConfidence: n < MIN_SIMULATION_SAMPLE,
    noActionableChanges,
  };
}

/**
 * One-line headline for the preview row. Explicitly names the metric
 * direction ("lower Brier = more accurate") because the average
 * reader has no intuition for Brier and will otherwise misread a
 * negative delta as regression.
 */
export function describeWhatIfHeadline(result: ScorerWhatIfResult): string | null {
  if (result.dealsSimulated === 0) return null;
  if (result.noActionableChanges) return null;
  if (
    result.currentBrier === null ||
    result.simulatedBrier === null ||
    result.brierDelta === null
  ) {
    return null;
  }
  const brierBetter = result.brierDelta < 0;
  const brierSame = result.brierDelta === 0;
  const brierWord = brierSame ? "unchanged" : brierBetter ? "improves" : "regresses";
  const brierAbs = Math.abs(result.brierDelta).toFixed(3);
  const sampleNote = result.lowConfidence
    ? ` — directional only (${result.dealsSimulated} deal${result.dealsSimulated === 1 ? "" : "s"})`
    : "";
  return `Applied to ${result.dealsSimulated} closed deal${result.dealsSimulated === 1 ? "" : "s"}, Brier ${brierWord} by ${brierAbs}${sampleNote}.`;
}
