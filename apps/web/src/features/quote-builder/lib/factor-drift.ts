/**
 * Factor Drift Detection — Slice 20r.
 *
 * Slice 20g's attribution report is aggregate-across-all-time, which
 * means it is blind to a specific, common failure mode: a factor that
 * earned its weight 12 months ago and is neutral (or anti-predictive)
 * today. The market shifted; the scorer didn't notice; the aggregate
 * lift still looks fine because historical wins drown out recent
 * losses.
 *
 * Commodity CRMs don't flag this because commodity CRMs don't have a
 * measurable scorer. QEP does, so this slice reads the same closed-
 * deal audit rows (which carry `capturedAt`), splits them into a
 * recent window vs. a prior window, runs 20g's attribution on each
 * independently, and diffs the lifts. A factor whose lift has moved
 * meaningfully between windows is surfaced as a drift finding.
 *
 * Move-2 relevance: this is the feedback loop that keeps the rule
 * scorer honest over time. Without drift detection, a scorer that
 * worked in Q1 can quietly degrade by Q4 with no alarm. With it,
 * every quarter the manager sees which rules need a second look.
 *
 * Pure functions — no I/O. The consumer passes in the same raw audit
 * rows 20h / 20k / 20p already fetch.
 *
 * Design bar (carried): *transparent over confident*. We never hide a
 * drift finding behind "it's within the noise floor" — if it crosses
 * the threshold we surface it. Low-confidence (thin window) is a
 * visible flag on the row, not a filter.
 */

import type { ClosedDealAuditRow } from "./closed-deals-audit";
import {
  computeFactorAttribution,
  type FactorAttribution,
  type DealFactorObservation,
} from "./factor-attribution";

/**
 * Default recency window, in days. 90 days was chosen to balance two
 * pressures: (a) long enough for a factor to accumulate meaningful
 * observations on both sides, and (b) short enough that a market
 * shift that happened "last quarter" is visible. Callers can override
 * via `opts.windowDays` — a team with high deal velocity might tighten
 * to 30, while a team with sparse data might widen to 180.
 */
export const DEFAULT_DRIFT_WINDOW_DAYS = 90;

/**
 * Minimum absolute lift change to flag a factor as drifting. 10pp was
 * chosen because it's the smallest delta a human quickly reads as
 * "something changed" without tripping on routine sampling noise. The
 * aggregate-attribution "factor is noise" threshold is 5pp (20m's
 * LOW_LEVERAGE_LIFT), so 10pp is 2× that — a genuine shift, not
 * measurement jitter.
 */
export const MIN_DRIFT_DELTA = 0.1;

/**
 * Minimum deals per window before we trust a drift reading. Matches
 * MIN_DEALS_FOR_CONFIDENCE in scorer-calibration so the three
 * confidence thresholds across the instrumentation arc stay in sync.
 * A window below this still computes, but the factor row is flagged
 * `lowConfidence` so the UI can fade it.
 */
export const MIN_DEALS_PER_WINDOW = 10;

/**
 * What direction did the factor's predictive power move?
 *
 *   • `rising`  — positive lift grew OR a near-zero factor is now a
 *                 real tailwind. Good news; scorer may be undercrediting.
 *   • `falling` — positive lift shrank OR a tailwind is turning neutral.
 *                 Warning; the rule is losing signal.
 *   • `flipped` — the lift's SIGN changed (tailwind → headwind or
 *                 vice-versa). Highest alarm; the factor's direction
 *                 is now literally wrong relative to what it was.
 *   • `stable`  — drift magnitude below threshold.
 */
export type DriftDirection = "rising" | "falling" | "flipped" | "stable";

export interface FactorDrift {
  label: string;
  /** Lift observed in the recent window; null if factor absent or one side empty. */
  recentLift: number | null;
  /** Lift observed in the prior window; null if factor absent or one side empty. */
  priorLift: number | null;
  /** recentLift - priorLift. Null when either window's lift is null. */
  drift: number | null;
  /** Classified direction (see DriftDirection). */
  direction: DriftDirection;
  /** Deals in the recent window where this factor was PRESENT. */
  recentPresent: number;
  /** Deals in the prior window where this factor was PRESENT. */
  priorPresent: number;
  /** Avg signed weight the scorer applied to this factor when present (recent window). */
  recentAvgWeight: number;
  /**
   * True when either window has too thin a sample to trust the drift
   * call. UI uses this to fade the row. Does NOT cause the factor to
   * be filtered out — an honest "directional-only" surface beats a
   * silent drop.
   */
  lowConfidence: boolean;
}

export interface FactorDriftReport {
  /** ISO timestamp of the reference "now" used to partition windows. */
  referenceDate: string;
  /** Width of the recent window in days. */
  windowDays: number;
  /** Deals that fell in the recent window. */
  recentN: number;
  /** Deals that fell in the prior window (everything older). */
  priorN: number;
  /** Drifting factors (direction != "stable"), sorted by |drift| desc. */
  drifts: FactorDrift[];
  /** True when either window has too few deals to trust any reading. */
  lowConfidence: boolean;
}

export interface FactorDriftOptions {
  /** Override the recency window width. */
  windowDays?: number;
  /** Override the min-drift-delta threshold for flagging. */
  minDriftDelta?: number;
  /** Inject a deterministic "now" for testing; defaults to Date.now(). */
  referenceDateMs?: number;
}

/** Safe parse of an ISO string to epoch ms, or null if unparseable. */
function parseCapturedMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Convert ClosedDealAuditRow → DealFactorObservation (structural subset). */
function toObs(row: ClosedDealAuditRow): DealFactorObservation {
  return { factors: row.factors, outcome: row.outcome };
}

/**
 * Classify drift direction. Called only when we have a numeric `drift`.
 * "Flipped" takes precedence over rising/falling because the sign
 * change is the more alarming finding — a factor that used to predict
 * wins and now predicts losses is worse than one whose effect merely
 * shrank.
 */
function classifyDirection(
  recent: number | null,
  prior: number | null,
  drift: number,
  minDriftDelta: number,
): DriftDirection {
  if (Math.abs(drift) < minDriftDelta) return "stable";
  // Null-guard for "flipped" — both windows need a measurable lift to
  // call a sign change. (A null on either side is simply "we couldn't
  // measure", not a flip.)
  if (recent !== null && prior !== null) {
    if (prior > 0 && recent < 0) return "flipped";
    if (prior < 0 && recent > 0) return "flipped";
  }
  return drift > 0 ? "rising" : "falling";
}

/**
 * Compute factor drift by running 20g's attribution on two time-sliced
 * subsets of the audit rows and diffing the per-factor lifts.
 *
 * Rows with a null / unparseable `capturedAt` are excluded — we can't
 * window something we can't date. This is deliberately conservative:
 * a drift finding built on a row we can't timestamp is a finding we
 * can't defend in a review.
 */
export function computeFactorDrift(
  rows: ClosedDealAuditRow[] | null | undefined,
  opts: FactorDriftOptions = {},
): FactorDriftReport {
  const windowDays = opts.windowDays ?? DEFAULT_DRIFT_WINDOW_DAYS;
  const minDriftDelta = opts.minDriftDelta ?? MIN_DRIFT_DELTA;
  const referenceDateMs = opts.referenceDateMs ?? Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoff = referenceDateMs - windowMs;

  const recent: ClosedDealAuditRow[] = [];
  const prior: ClosedDealAuditRow[] = [];
  for (const r of rows ?? []) {
    if (!r || !Array.isArray(r.factors)) continue;
    if (r.outcome !== "won" && r.outcome !== "lost" && r.outcome !== "expired") continue;
    const ms = parseCapturedMs(r.capturedAt);
    if (ms === null) continue; // skip undatable rows
    if (ms >= cutoff) recent.push(r);
    else prior.push(r);
  }

  const recentReport = computeFactorAttribution(recent.map(toObs));
  const priorReport = computeFactorAttribution(prior.map(toObs));

  // Index prior factors by label so we can align with the recent set.
  const priorByLabel = new Map<string, FactorAttribution>();
  for (const f of priorReport.factors) priorByLabel.set(f.label, f);

  // Union of labels across both windows so a factor with data on only
  // one side is still carried through the loop (even though the null-
  // drift branch below will classify it "stable" and filter it out).
  // *Drift* specifically means "the lift moved between two measurable
  // points in time" — a factor that's newly emerged or entirely absent
  // from one window doesn't have two points to compare, so it belongs
  // in 20g's aggregate attribution view, not here. Keeping the union
  // future-proofs the data flow if we later decide to surface those.
  const labels = new Set<string>();
  for (const f of recentReport.factors) labels.add(f.label);
  for (const f of priorReport.factors) labels.add(f.label);

  const recentByLabel = new Map<string, FactorAttribution>();
  for (const f of recentReport.factors) recentByLabel.set(f.label, f);

  const drifts: FactorDrift[] = [];
  for (const label of labels) {
    const rF = recentByLabel.get(label);
    const pF = priorByLabel.get(label);
    const recentLift = rF?.lift ?? null;
    const priorLift = pF?.lift ?? null;
    const drift =
      recentLift !== null && priorLift !== null ? recentLift - priorLift : null;
    const direction =
      drift !== null ? classifyDirection(recentLift, priorLift, drift, minDriftDelta) : "stable";
    drifts.push({
      label,
      recentLift,
      priorLift,
      drift,
      direction,
      recentPresent: rF?.present ?? 0,
      priorPresent: pF?.present ?? 0,
      recentAvgWeight: rF?.avgWeightWhenPresent ?? 0,
      // Either side low-confidence OR the individual factor reports
      // flagged it thin — we want to fade either way.
      lowConfidence:
        recent.length < MIN_DEALS_PER_WINDOW ||
        prior.length < MIN_DEALS_PER_WINDOW ||
        (rF?.lowConfidence ?? true) ||
        (pF?.lowConfidence ?? true),
    });
  }

  // Only return drifting factors; "stable" rows are the expected case
  // and don't need UI real estate. Sorted by |drift| descending so the
  // most moved factor surfaces first.
  const drifting = drifts.filter((d) => d.direction !== "stable");
  drifting.sort((a, b) => {
    const aD = a.drift === null ? 0 : Math.abs(a.drift);
    const bD = b.drift === null ? 0 : Math.abs(b.drift);
    return bD - aD;
  });

  return {
    referenceDate: new Date(referenceDateMs).toISOString(),
    windowDays,
    recentN: recent.length,
    priorN: prior.length,
    drifts: drifting,
    lowConfidence:
      recent.length < MIN_DEALS_PER_WINDOW || prior.length < MIN_DEALS_PER_WINDOW,
  };
}

/**
 * One-line headline for the drift card. Counts + strongest finding so
 * a manager can triage in under 2 seconds.
 */
export function describeDriftHeadline(report: FactorDriftReport): string {
  if (report.drifts.length === 0) {
    return `No factor drift detected across ${report.recentN + report.priorN} closed deals.`;
  }
  const flipped = report.drifts.filter((d) => d.direction === "flipped").length;
  const falling = report.drifts.filter((d) => d.direction === "falling").length;
  const rising = report.drifts.filter((d) => d.direction === "rising").length;
  const parts: string[] = [];
  if (flipped > 0) parts.push(`${flipped} flipped`);
  if (falling > 0) parts.push(`${falling} falling`);
  if (rising > 0) parts.push(`${rising} rising`);
  const joined = parts.join(", ");
  const sampleNote = report.lowConfidence
    ? ` — directional only (${report.recentN} recent, ${report.priorN} prior)`
    : "";
  return `${report.drifts.length} factor${report.drifts.length === 1 ? "" : "s"} drifting (${joined}) over the last ${report.windowDays} days${sampleNote}.`;
}

/**
 * Per-row rationale: "<Label>: was +23% tailwind, now -4% headwind
 * over 14 recent vs 38 prior closed deals." Kept here so tests pin
 * the copy and the UI is presentation-only.
 */
export function describeDriftRationale(d: FactorDrift): string {
  const fmt = (lift: number | null): string =>
    lift === null ? "n/a" : `${lift > 0 ? "+" : ""}${Math.round(lift * 100)}%`;
  const direction =
    d.direction === "flipped"
      ? "flipped direction"
      : d.direction === "rising"
        ? "rising"
        : d.direction === "falling"
          ? "falling"
          : "stable";
  return `${d.label}: was ${fmt(d.priorLift)}, now ${fmt(d.recentLift)} — ${direction} across ${d.recentPresent} recent × ${d.priorPresent} prior presences.`;
}
