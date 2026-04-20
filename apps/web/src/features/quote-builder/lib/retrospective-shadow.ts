/**
 * Retrospective Shadow Calibration — Slice 20k.
 *
 * Slice 20j put a live shadow score next to the rule score, but left an
 * honest question unanswered: *should the manager actually trust the
 * shadow?* A number that's never been back-tested is a vibe, not a
 * signal.
 *
 * This module closes the loop. Given the same `ClosedDealAuditRow[]`
 * stream the 20h audit already fetches, for every deal we re-run the
 * shadow calculator using the OTHER deals as history (leave-one-out),
 * then tally:
 *
 *   • Did the shadow's prediction (score ≥ 50) match the realized
 *     outcome (won vs not)?
 *   • Did the rule scorer's prediction match?
 *   • When the two disagreed, which one was right more often?
 *
 * That last row is the Move-2-critical one. If the shadow wins the
 * disagreement coin-flip more than half the time, it deserves a seat
 * at the table. If it doesn't, we show the number honestly anyway —
 * this file deliberately does not filter, suppress, or flatter the
 * shadow's record. Transparent over confident.
 *
 * Pure functions — no I/O. Callers feed in the same row shape that
 * `closed-deals-audit`'s edge function already emits.
 *
 * Leave-one-out justification: including the deal's own snapshot in
 * its history would drive distance to 0 on the trivial self-match
 * and bias every row toward "shadow is always right". LOO is the
 * cheapest honest cross-validation available, and since shadow is
 * K-NN (not parametric) there's no training cost to re-paying.
 */

import type { ClosedDealAuditRow } from "./closed-deals-audit";
import {
  computeShadowScore,
  type ShadowHistoricalSnapshot,
  type ShadowReason,
} from "./shadow-score";

/**
 * Threshold at which we consider a score to be "predicting win". We
 * treat 50 as the neutral line — below is a miss-leaning read, at or
 * above is a win-leaning read. That's the same midpoint the live
 * scorer's band boundaries hover around and the same split
 * closed-deals-audit uses implicitly via `realizedProbability`.
 */
export const WIN_PREDICTION_THRESHOLD = 50;

export interface RetrospectiveShadowRow {
  packageId: string;
  outcome: "won" | "lost" | "expired";
  /** The stored rule-based score at save time, clamped to [0,100]. */
  liveScore: number;
  /** Shadow score computed from leave-one-out peers. */
  shadowScore: number;
  /** Mirrors the raw `computeShadowScore` confidence flag. */
  shadowLowConfidence: boolean;
  shadowReason: ShadowReason;
  /**
   * Did the rule score call the outcome correctly? Rule predicts win
   * when liveScore ≥ 50 and "correct" means that prediction matched
   * realized outcome (won vs not-won). Expired folds into not-won —
   * same convention as scorer-calibration.ts and closed-deals-audit.ts.
   */
  ruleAgreed: boolean;
  /**
   * Did the shadow score call the outcome correctly? `null` when the
   * shadow's confidence was too thin to make the call — we'd rather
   * abstain than pad the shadow's agreement rate with coin-flip rows.
   */
  shadowAgreed: boolean | null;
  /** Captured-at passed through for recency / ordering in the UI. */
  capturedAt: string | null;
}

export interface ShadowAgreementSummary {
  /** Total deals that contributed to calibration math. */
  totalDeals: number;
  /** Deals where the shadow had thin data — excluded from agreement stats. */
  shadowAbstainCount: number;
  /**
   * Deals with both predictions scorable (i.e. shadow did not abstain).
   * Denominator for the agreement-rate fields below.
   */
  scorableDeals: number;
  /** How often the rule scorer was right on the scorable set. */
  ruleAgreedCount: number;
  /** How often the shadow was right on the scorable set. */
  shadowAgreedCount: number;
  /** Percentage forms (0..1), null when `scorableDeals === 0`. */
  ruleAgreementRate: number | null;
  shadowAgreementRate: number | null;
  /**
   * Deals where the two predictions disagreed (one said win, one said
   * miss). This is the interesting subset — when they agree, the
   * shadow isn't telling you anything new. When they disagree, the
   * shadow is genuinely earning or losing its keep.
   */
  disagreementCount: number;
  /** Of `disagreementCount`, how many the shadow got right. */
  shadowWonDisagreementCount: number;
  /** shadowWonDisagreementCount / disagreementCount; null when zero disagreements. */
  shadowDisagreementWinRate: number | null;
  /**
   * Aggregate trust flag: do we have enough calibration data (scorable
   * deals) to even show a "shadow won the disagreements" number? 10
   * matches the aggregate-calibration threshold elsewhere in the
   * codebase, so the three instrumentation cards all start trusting
   * their own numbers at the same cadence.
   */
  lowConfidence: boolean;
}

/** Mirrors the aggregate confidence threshold used across the slice arc. */
export const MIN_DEALS_FOR_SHADOW_CONFIDENCE = 10;

function didWin(outcome: "won" | "lost" | "expired"): boolean {
  return outcome === "won";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

/**
 * Convert a raw audit row to a history snapshot. Separated so the
 * filter that drops malformed rows lives in one place.
 */
function toSnapshot(row: ClosedDealAuditRow): ShadowHistoricalSnapshot {
  return {
    packageId: row.packageId,
    factors: row.factors,
    outcome: row.outcome,
  };
}

/**
 * For each valid row, run shadow scoring on the OTHER rows as peers
 * (leave-one-out) and record whether rule + shadow each called the
 * realized outcome correctly.
 *
 * The sort order of the returned list is NOT guaranteed — callers
 * that want "worst disagreements first" (or similar) should sort
 * themselves, because different UIs want different orderings.
 */
export function computeRetrospectiveShadows(
  rows: ClosedDealAuditRow[],
): RetrospectiveShadowRow[] {
  const valid = (rows ?? []).filter(
    (r) =>
      r != null &&
      typeof r.packageId === "string" &&
      r.packageId.length > 0 &&
      typeof r.score === "number" &&
      Number.isFinite(r.score) &&
      (r.outcome === "won" || r.outcome === "lost" || r.outcome === "expired") &&
      Array.isArray(r.factors),
  );

  return valid.map((row, idx) => {
    // Leave-one-out: every other row becomes the peer history.
    const peers: ShadowHistoricalSnapshot[] = valid
      .filter((_, i) => i !== idx)
      .map(toSnapshot);
    const shadow = computeShadowScore(row.factors, peers);
    const liveScore = clamp01(row.score);
    const outcomeWon = didWin(row.outcome);

    const rulePredictsWin = liveScore >= WIN_PREDICTION_THRESHOLD;
    const shadowPredictsWin = shadow.shadowScore >= WIN_PREDICTION_THRESHOLD;

    const ruleAgreed = rulePredictsWin === outcomeWon;
    const shadowAgreed = shadow.lowConfidence ? null : shadowPredictsWin === outcomeWon;

    return {
      packageId: row.packageId,
      outcome: row.outcome,
      liveScore,
      shadowScore: shadow.shadowScore,
      shadowLowConfidence: shadow.lowConfidence,
      shadowReason: shadow.reason,
      ruleAgreed,
      shadowAgreed,
      capturedAt: row.capturedAt,
    };
  });
}

/**
 * Aggregate the retrospective rows into a single headline-ready
 * summary. Abstention (shadow low-confidence) is preserved in the
 * shape so the UI can say "Shadow had enough data on X of Y deals";
 * silently dropping abstention counts would let a tiny confident
 * sample look like a large one.
 */
export function computeShadowAgreementSummary(
  rows: RetrospectiveShadowRow[],
): ShadowAgreementSummary {
  const totalDeals = rows.length;
  const shadowAbstainCount = rows.filter((r) => r.shadowAgreed === null).length;
  const scorable = rows.filter((r) => r.shadowAgreed !== null);
  const scorableDeals = scorable.length;

  let ruleAgreedCount = 0;
  let shadowAgreedCount = 0;
  let disagreementCount = 0;
  let shadowWonDisagreementCount = 0;

  for (const r of scorable) {
    if (r.ruleAgreed) ruleAgreedCount += 1;
    if (r.shadowAgreed === true) shadowAgreedCount += 1;
    // "Disagreement" means the two predictions picked different sides
    // — one said win, the other said not-win. When that happens,
    // exactly one of them can agree with the realized outcome, and
    // that one "won the disagreement".
    if (r.ruleAgreed !== r.shadowAgreed) {
      disagreementCount += 1;
      if (r.shadowAgreed === true) shadowWonDisagreementCount += 1;
    }
  }

  const ruleAgreementRate = scorableDeals > 0 ? ruleAgreedCount / scorableDeals : null;
  const shadowAgreementRate = scorableDeals > 0 ? shadowAgreedCount / scorableDeals : null;
  const shadowDisagreementWinRate =
    disagreementCount > 0 ? shadowWonDisagreementCount / disagreementCount : null;

  return {
    totalDeals,
    shadowAbstainCount,
    scorableDeals,
    ruleAgreedCount,
    shadowAgreedCount,
    ruleAgreementRate,
    shadowAgreementRate,
    disagreementCount,
    shadowWonDisagreementCount,
    shadowDisagreementWinRate,
    lowConfidence: scorableDeals < MIN_DEALS_FOR_SHADOW_CONFIDENCE,
  };
}

/**
 * Short, rep/manager-agnostic sentence summarizing the shadow's track
 * record on the disagreement subset. Kept here (not in a component)
 * so tests can pin the copy. Honest phrasing: we only claim trust
 * when the shadow won > 55% of disagreements AND we have enough data.
 */
export function describeShadowTrustHeadline(
  summary: ShadowAgreementSummary,
): string {
  if (summary.scorableDeals === 0) {
    return "Not enough closed deals yet to calibrate the shadow score.";
  }
  if (summary.lowConfidence) {
    return `Only ${summary.scorableDeals} deal${summary.scorableDeals === 1 ? "" : "s"} with shadow confidence so far — calibration is directional, not decisive.`;
  }
  if (summary.disagreementCount === 0) {
    return `Shadow and rule scorer agreed on every call across ${summary.scorableDeals} deals — no disagreements to adjudicate yet.`;
  }
  const pct = Math.round((summary.shadowDisagreementWinRate ?? 0) * 100);
  if (pct >= 60) {
    return `Shadow won ${summary.shadowWonDisagreementCount} of ${summary.disagreementCount} disagreements (${pct}%) — worth a second look when it disagrees with the live score.`;
  }
  if (pct <= 40) {
    return `Shadow won only ${summary.shadowWonDisagreementCount} of ${summary.disagreementCount} disagreements (${pct}%) — rule scorer has been the stronger signal so far.`;
  }
  return `Shadow won ${summary.shadowWonDisagreementCount} of ${summary.disagreementCount} disagreements (${pct}%) — a coin-flip so far; neither score dominates.`;
}
