/**
 * Factor Attribution — Slice 20g.
 *
 * Slice 20f measured *how often* the scorer is right. This file
 * measures *why* — for each scorer factor (e.g. "Trade in hand",
 * "Margin below baseline"), it computes the factor's real predictive
 * power against closed-deal outcomes.
 *
 * The output answers three questions every scorer evolution PR needs:
 *
 *   1. When this factor fires positive, how often does the deal win?
 *   2. When this factor is absent/negative, how often does the deal win?
 *   3. What's the delta? (positive = factor really is a tailwind;
 *      near-zero = factor is noise; negative = factor is actively
 *      miscalibrated and the rule should be reviewed.)
 *
 * Move 2 framing: this is the instrumentation that turns the scorer
 * from a black box into an auditable rules engine. When the ML model
 * ships, the same per-factor lift numbers become feature-importance
 * scores — the interface stays the same.
 *
 * Pure functions — no I/O. The edge function hands over raw
 * `{ label, weight, outcome }[]` tuples; this module does the stats.
 *
 * Stability note: factors are keyed by `label` (not a synthetic id)
 * because the scorer's factor labels are the stable contract. When
 * labels change, callers should filter by `weightsVersion` before
 * feeding into this pipeline so v1-labeled rows don't get mixed with
 * v2-labeled rows. That gating lives in the edge function.
 */

import type { CalibrationOutcome } from "./scorer-calibration";

/**
 * One saved `(factor × outcome)` observation. Produced by flattening
 * `quote_packages.win_probability_snapshot.factors[]` against the
 * deal's final outcome from `qb_quote_outcomes`.
 */
export interface FactorObservation {
  /** Factor label — the stable contract between scorer + attribution. */
  label: string;
  /** Signed weight applied by the scorer at save time. */
  weight: number;
  /** The deal's final outcome. Skipped rows should be filtered out upstream. */
  outcome: CalibrationOutcome;
}

/**
 * Per-factor report row. Every numeric field is independently
 * null-safe so the UI can render partial states gracefully.
 */
export interface FactorAttribution {
  /** Stable factor label (e.g. "Trade in hand"). */
  label: string;
  /** Total observations that include this factor at any weight. */
  present: number;
  /** Wins among observations where this factor was present. */
  presentWins: number;
  /** Observations where this factor was absent (did not appear in snapshot). */
  absent: number;
  /** Wins among observations where this factor was absent. */
  absentWins: number;
  /** Average signed weight the scorer assigned when this factor fired. */
  avgWeightWhenPresent: number;
  /**
   * Win rate when present minus win rate when absent. Positive means
   * "factor's presence predicts wins". Negative means "factor is
   * either miscalibrated or actively anti-predictive". Null when
   * either side has zero observations (can't compute the delta).
   */
  lift: number | null;
  /** Win rate when present. Null when present=0. */
  winRateWhenPresent: number | null;
  /** Win rate when absent. Null when absent=0. */
  winRateWhenAbsent: number | null;
  /**
   * True when we don't have enough observations on at least one side
   * to trust the lift number. UI uses this to fade / warn on the row.
   */
  lowConfidence: boolean;
}

export interface FactorAttributionReport {
  /** Total deals (not rows) that contributed observations. */
  dealsAnalyzed: number;
  /** Per-factor rollups, sorted by |lift| descending so the most
   *  signal-bearing factors are first. Null lifts sort to the bottom. */
  factors: FactorAttribution[];
  /**
   * Aggregate warning — true when `dealsAnalyzed` is too small to
   * trust any per-factor number. Threshold matches the calibration
   * lib's LOW_CONFIDENCE_THRESHOLD so the two cards tell a consistent
   * story.
   */
  lowConfidence: boolean;
}

/**
 * The minimum deals-analyzed before any lift number is considered
 * trustworthy. Shared with scorer-calibration's LOW_CONFIDENCE_THRESHOLD
 * so the two cards don't disagree about when data is "real".
 */
const MIN_DEALS_FOR_CONFIDENCE = 10;
/**
 * Per-factor minimum: a factor needs at least this many observations
 * on BOTH the present and absent sides before its lift is trustworthy.
 * Lower than the aggregate threshold because the factor might rarely
 * fire — we still want to surface it, just with a low-confidence flag.
 */
const MIN_FACTOR_OBS_PER_SIDE = 3;

/**
 * Input shape: one row per deal, with the full factor list from that
 * deal's saved snapshot. This is the natural shape the edge function
 * produces from the jsonb blob + outcomes join, and keeping it
 * deal-grouped (rather than already flattened) lets us compute the
 * "absent" side correctly — a factor is *absent* from a deal when it
 * doesn't appear in that deal's factor list at all.
 */
export interface DealFactorObservation {
  factors: Array<{ label: string; weight: number }>;
  outcome: CalibrationOutcome;
}

/**
 * Core attribution calculator. Deal-grouped so "absent" means
 * "the scorer didn't include this factor for this deal" — not just
 * "the factor had weight=0 in this row".
 */
export function computeFactorAttribution(
  deals: DealFactorObservation[],
): FactorAttributionReport {
  const valid = deals.filter(
    (d) =>
      Array.isArray(d.factors) &&
      (d.outcome === "won" || d.outcome === "lost" || d.outcome === "expired"),
  );

  if (valid.length === 0) {
    return { dealsAnalyzed: 0, factors: [], lowConfidence: true };
  }

  // Discover every distinct label seen across the full sample.
  const labelSet = new Set<string>();
  for (const deal of valid) {
    for (const f of deal.factors) {
      if (typeof f.label === "string" && f.label.trim().length > 0) {
        labelSet.add(f.label);
      }
    }
  }

  const factors: FactorAttribution[] = [];
  for (const label of labelSet) {
    let present = 0;
    let presentWins = 0;
    let absent = 0;
    let absentWins = 0;
    let weightSum = 0;

    for (const deal of valid) {
      const hit = deal.factors.find((f) => f.label === label);
      const won = deal.outcome === "won";
      if (hit) {
        present += 1;
        if (won) presentWins += 1;
        if (Number.isFinite(hit.weight)) weightSum += hit.weight;
      } else {
        absent += 1;
        if (won) absentWins += 1;
      }
    }

    const winRateWhenPresent = present > 0 ? presentWins / present : null;
    const winRateWhenAbsent = absent > 0 ? absentWins / absent : null;
    const lift =
      winRateWhenPresent !== null && winRateWhenAbsent !== null
        ? winRateWhenPresent - winRateWhenAbsent
        : null;
    const avgWeightWhenPresent = present > 0 ? weightSum / present : 0;
    const lowConfidence =
      present < MIN_FACTOR_OBS_PER_SIDE || absent < MIN_FACTOR_OBS_PER_SIDE;

    factors.push({
      label,
      present,
      presentWins,
      absent,
      absentWins,
      avgWeightWhenPresent,
      lift,
      winRateWhenPresent,
      winRateWhenAbsent,
      lowConfidence,
    });
  }

  // Sort by |lift| descending, null lifts last — the most
  // signal-bearing factors surface first in the UI.
  factors.sort((a, b) => {
    if (a.lift === null && b.lift === null) return 0;
    if (a.lift === null) return 1;
    if (b.lift === null) return -1;
    return Math.abs(b.lift) - Math.abs(a.lift);
  });

  return {
    dealsAnalyzed: valid.length,
    factors,
    lowConfidence: valid.length < MIN_DEALS_FOR_CONFIDENCE,
  };
}

/**
 * Flag a factor as "surprising" when its lift disagrees with its
 * signed weight — i.e. the scorer assigns positive weight but the
 * factor actually correlates with losses, or vice-versa.
 *
 * These are the exact rows the scorer-evolution PR should triage.
 */
export function isFactorSurprising(f: FactorAttribution): boolean {
  if (f.lift === null) return false;
  if (f.lowConfidence) return false;
  // A factor with positive avg weight should lift the win rate.
  // Surprising means avg weight ≥ +1 but lift is negative (or vice-versa).
  if (f.avgWeightWhenPresent >= 1 && f.lift < 0) return true;
  if (f.avgWeightWhenPresent <= -1 && f.lift > 0) return true;
  return false;
}
