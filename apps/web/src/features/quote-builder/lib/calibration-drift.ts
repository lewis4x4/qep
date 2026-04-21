/**
 * Calibration Drift — Slice 20s.
 *
 * Slice 20r told us which *factors* have drifted between a recent and
 * a prior window. This slice asks the companion question at the next
 * level up: is the *scorer as a whole* getting sharper or dulling?
 *
 * The same closed-deal audit rows that 20f / 20h / 20r already load
 * carry everything we need: a saved score, a realized outcome, and a
 * capture timestamp. Split by time, run 20f's calibration math on each
 * side, diff the headline numbers. A rising hit-rate with a falling
 * Brier score means the engine is genuinely improving; the reverse
 * means it's regressing and should be triaged before the next PR.
 *
 * Move-2 relevance: commodity CRMs can't tell you whether their
 * prediction engine is aging well because they have no calibration
 * number to begin with. QEP's scorer is measurable, so "it's getting
 * sharper / dulling" is a fact we can carry on the manager's home
 * screen quarter-over-quarter. Pair this with 20r and the manager
 * sees both the aggregate health trend AND which specific rules
 * drove it.
 *
 * Design bar (carried): *transparent over confident*. Mixed signals
 * (accuracy up but Brier also up — the scorer bets more confidently
 * on each direction but calls them less cleanly) resolve to "stable"
 * rather than pretending there's a trend. We never hide a degradation
 * behind a low-confidence caveat either — thin-sample drifts surface
 * with a muted palette but they surface.
 *
 * Pure functions — no I/O.
 */

import type { ClosedDealAuditRow } from "./closed-deals-audit";
import {
  computeCalibrationReport,
  type CalibrationObservation,
  type CalibrationReport,
} from "./scorer-calibration";

/**
 * Default recency window, in days. Matches factor-drift so the two
 * drift cards tell a consistent "last 90 days vs. everything older"
 * story. Callers can override per team velocity.
 */
export const DEFAULT_CALIBRATION_DRIFT_WINDOW_DAYS = 90;

/**
 * Minimum hit-rate delta (as a fraction, e.g. 0.05 = 5pp) before we
 * call it a drift. 5pp is the smallest move that's clearly outside
 * routine sampling noise at typical window sizes (20–40 deals/side),
 * and is consistent with commodity-CRM-grade "meaningful change".
 */
export const MIN_CALIBRATION_DRIFT_DELTA = 0.05;

/**
 * Minimum deals per window before we trust the reading. Matches
 * factor-drift + scorer-calibration's low-confidence threshold so all
 * three instrumentation surfaces agree on what "enough data" means.
 */
export const MIN_DEALS_PER_WINDOW = 10;

/**
 * Direction of the drift.
 *
 *   • `improving` — hit-rate went up AND Brier went down (or one moved
 *                   past threshold while the other stayed flat). The
 *                   engine is genuinely sharpening.
 *   • `degrading` — hit-rate went down AND Brier went up (or either
 *                   crossed threshold in the bad direction with the
 *                   other flat). The engine is dulling.
 *   • `stable`    — drift below threshold OR mixed signals (one metric
 *                   improved while the other degraded — we don't claim
 *                   a trend we can't defend).
 */
export type CalibrationDriftDirection = "improving" | "degrading" | "stable";

export interface CalibrationDriftReport {
  /** ISO timestamp of the reference "now" used to partition windows. */
  referenceDate: string;
  /** Width of the recent window in days. */
  windowDays: number;
  /** Deals that fell in the recent window. */
  recentN: number;
  /** Deals that fell in the prior window (everything older). */
  priorN: number;
  /** Recent window's hit-rate as a fraction [0, 1] or null. */
  recentAccuracy: number | null;
  /** Prior window's hit-rate as a fraction [0, 1] or null. */
  priorAccuracy: number | null;
  /** recentAccuracy - priorAccuracy, or null when either side is null. */
  accuracyDelta: number | null;
  /** Recent window's Brier score or null. Lower is better. */
  recentBrier: number | null;
  /** Prior window's Brier score or null. Lower is better. */
  priorBrier: number | null;
  /** recentBrier - priorBrier, or null when either side is null. */
  brierDelta: number | null;
  /** Trend classification. */
  direction: CalibrationDriftDirection;
  /** True when either window has too few deals to trust the reading. */
  lowConfidence: boolean;
}

export interface CalibrationDriftOptions {
  /** Override the recency window width. */
  windowDays?: number;
  /** Override the minimum accuracy-delta threshold for a direction call. */
  minAccuracyDelta?: number;
  /** Inject a deterministic "now" for testing; defaults to Date.now(). */
  referenceDateMs?: number;
}

/** Safe parse of an ISO string to epoch ms, or null if unparseable. */
function parseCapturedMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Map an audit row to the shape the calibration library expects. */
function toObservation(row: ClosedDealAuditRow): CalibrationObservation {
  return { score: row.score, outcome: row.outcome };
}

/**
 * Classify trend direction from the two headline deltas.
 *
 * Precedence table (tri-state by sign of each delta past threshold):
 *
 *    acc ↑ + brier ↓ → improving    (both agree: good)
 *    acc ↓ + brier ↑ → degrading    (both agree: bad)
 *    acc ↑ + brier ↑ → stable       (mixed — bet size up, direction down)
 *    acc ↓ + brier ↓ → stable       (mixed — less accurate but tighter)
 *    only one metric moves → that metric's direction wins
 *    neither moves        → stable
 *
 * The mixed-signals-fold-to-stable choice is the honesty tax — we'd
 * rather say "no clear trend" than promote a misleading one.
 */
function classifyDirection(
  accuracyDelta: number | null,
  brierDelta: number | null,
  minAccuracyDelta: number,
): CalibrationDriftDirection {
  const accSig =
    accuracyDelta === null ? 0 : accuracyDelta >= minAccuracyDelta ? 1 : accuracyDelta <= -minAccuracyDelta ? -1 : 0;
  // Brier threshold is scaled down because Brier deltas are naturally
  // smaller than accuracy deltas — a 0.02 shift in Brier is comparable
  // to a 5pp shift in accuracy.
  const brierThreshold = minAccuracyDelta * 0.4;
  const brierSig =
    brierDelta === null ? 0 : brierDelta >= brierThreshold ? 1 : brierDelta <= -brierThreshold ? -1 : 0;

  // Both flat → stable.
  if (accSig === 0 && brierSig === 0) return "stable";

  // Mixed signs (remember: brier DOWN is good, so brierSig=-1 is good).
  // Improving = acc up AND brier down.
  if (accSig === 1 && brierSig === -1) return "improving";
  if (accSig === -1 && brierSig === 1) return "degrading";

  // Only one metric moved. Let it carry the verdict.
  if (accSig === 1 && brierSig === 0) return "improving";
  if (accSig === -1 && brierSig === 0) return "degrading";
  if (accSig === 0 && brierSig === -1) return "improving";
  if (accSig === 0 && brierSig === 1) return "degrading";

  // Remaining case: both moved but in the "same direction" (e.g. both
  // up). That's a conflicting story — fold to stable.
  return "stable";
}

/**
 * Compute calibration drift by running 20f's calibration math on two
 * time-sliced subsets of the audit rows and diffing the headline hit-
 * rate + Brier.
 *
 * Rows with null / unparseable `capturedAt` are excluded — we can't
 * window something we can't date, and a drift finding we can't defend
 * in review is worse than no finding at all.
 */
export function computeCalibrationDrift(
  rows: ClosedDealAuditRow[] | null | undefined,
  opts: CalibrationDriftOptions = {},
): CalibrationDriftReport {
  const windowDays = opts.windowDays ?? DEFAULT_CALIBRATION_DRIFT_WINDOW_DAYS;
  const minAccuracyDelta = opts.minAccuracyDelta ?? MIN_CALIBRATION_DRIFT_DELTA;
  const referenceDateMs = opts.referenceDateMs ?? Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoff = referenceDateMs - windowMs;

  const recent: ClosedDealAuditRow[] = [];
  const prior: ClosedDealAuditRow[] = [];
  for (const r of rows ?? []) {
    if (!r) continue;
    if (r.outcome !== "won" && r.outcome !== "lost" && r.outcome !== "expired") continue;
    const ms = parseCapturedMs(r.capturedAt);
    if (ms === null) continue;
    if (ms >= cutoff) recent.push(r);
    else prior.push(r);
  }

  const recentReport: CalibrationReport = computeCalibrationReport(recent.map(toObservation));
  const priorReport: CalibrationReport = computeCalibrationReport(prior.map(toObservation));

  const recentAccuracy = recentReport.accuracyPct;
  const priorAccuracy = priorReport.accuracyPct;
  const accuracyDelta =
    recentAccuracy !== null && priorAccuracy !== null ? recentAccuracy - priorAccuracy : null;
  const recentBrier = recentReport.brierScore;
  const priorBrier = priorReport.brierScore;
  const brierDelta =
    recentBrier !== null && priorBrier !== null ? recentBrier - priorBrier : null;

  const direction = classifyDirection(accuracyDelta, brierDelta, minAccuracyDelta);

  const lowConfidence =
    recent.length < MIN_DEALS_PER_WINDOW || prior.length < MIN_DEALS_PER_WINDOW;

  return {
    referenceDate: new Date(referenceDateMs).toISOString(),
    windowDays,
    recentN: recent.length,
    priorN: prior.length,
    recentAccuracy,
    priorAccuracy,
    accuracyDelta,
    recentBrier,
    priorBrier,
    brierDelta,
    direction,
    lowConfidence,
  };
}

/**
 * One-line headline. Designed to be scannable in under 2 seconds —
 * the manager should know at a glance whether the engine's getting
 * sharper, dulling, or holding.
 */
export function describeCalibrationDriftHeadline(report: CalibrationDriftReport): string {
  const { direction, windowDays, recentN, priorN, lowConfidence } = report;
  const sampleNote = lowConfidence ? ` — directional only (${recentN} recent, ${priorN} prior)` : "";

  if (direction === "stable") {
    if (recentN === 0 && priorN === 0) {
      return "No closed deals to measure calibration drift yet.";
    }
    return `Scorer calibration is stable over the last ${windowDays} days${sampleNote}.`;
  }

  const accPct =
    report.accuracyDelta === null ? null : Math.round(report.accuracyDelta * 100);
  const accFragment =
    accPct === null
      ? ""
      : ` (hit rate ${accPct > 0 ? "+" : ""}${accPct}pp)`;

  if (direction === "improving") {
    return `Scorer is sharpening over the last ${windowDays} days${accFragment}${sampleNote}.`;
  }
  return `Scorer is dulling over the last ${windowDays} days${accFragment}${sampleNote}.`;
}

/**
 * Format a number as a percent string with explicit sign for deltas.
 * Centralized so tests pin the exact copy and the UI stays dumb.
 */
export function formatSignedPct(value: number | null): string {
  if (value === null) return "—";
  const pct = Math.round(value * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * Format a Brier delta. Brier is a [0,1] error metric so three decimal
 * places is the right precision — the whole interesting range sits in
 * the hundredths. Negative delta ("lower is better") is formatted with
 * a leading minus so the direction reads naturally.
 */
export function formatBrierDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(3)}`;
}
