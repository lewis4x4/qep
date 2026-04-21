/**
 * Scorer Calibration — Slice 20f.
 *
 * Pure functions that turn a set of (saved snapshot × actual outcome)
 * pairs into a calibration report. This is the instrumentation that
 * makes the rule-based win-probability scorer measurable — and makes
 * any future ML model provable against it.
 *
 * Move 2 (Counterfactual Win-Probability Engine) requires a trustworthy
 * baseline. Without this file, "our ML model is better" is unprovable.
 * With this file, every PR that touches the scorer can cite accuracy
 * delta over the existing held-out set.
 *
 * Design bar: *transparent over confident*. We surface sample size
 * alongside every number, and we never hide a tiny-n caveat.
 *
 * Pure functions — no I/O, no TanStack Query. The edge function hands
 * over raw rows; this module does the stats.
 */

/**
 * The four outcome classes that qb_quote_outcomes.outcome can hold.
 * `skipped` rows are excluded from calibration because "rep didn't
 * record a reason" is not a deal result.
 */
export type CalibrationOutcome = "won" | "lost" | "expired";

/**
 * A (score, outcome) pair ready for calibration math. Produced by the
 * edge function from quote_packages.win_probability_score +
 * qb_quote_outcomes.outcome.
 */
export interface CalibrationObservation {
  score: number; // 0..100 — the rule-scorer's clamped integer output
  outcome: CalibrationOutcome;
}

/**
 * Per-band rollup. Bands mirror WinProbabilityStrip thresholds so the
 * rep's UI and the calibration report agree on what "strong" means.
 */
export interface BandCalibration {
  band: "strong" | "healthy" | "mixed" | "at_risk";
  /** How many observations landed in this band. */
  n: number;
  /** Observations in this band that closed won. */
  won: number;
  /** Observations in this band that closed lost or expired. */
  lost: number;
  /** Empirical win-rate for this band (null when n=0). */
  winRate: number | null;
}

/**
 * Final report returned to the UI. Every field is independently
 * null-safe so the card can render a meaningful empty/low-n state.
 */
export interface CalibrationReport {
  /** Total observations with both a snapshot + a non-skipped outcome. */
  sampleSize: number;
  /**
   * Band-level agreement rate: strong/healthy predicted "likely win"
   * and the deal actually won, OR mixed/at_risk predicted "likely
   * loss" and the deal actually lost/expired. Null when sampleSize=0.
   */
  accuracyPct: number | null;
  /**
   * Brier score — mean squared error between the scorer's predicted
   * probability (score/100) and the binary outcome (1=won, 0=lost).
   * Lower is better. 0.25 is the dumb-baseline (always predict 50%).
   * Null when sampleSize=0.
   */
  brierScore: number | null;
  /**
   * Per-band breakdown so the rep / manager can see whether the scorer
   * is well-calibrated in the middle bands or only at the extremes.
   */
  bands: BandCalibration[];
  /**
   * Honest-warning flag — `true` when the sample is too small to trust
   * the aggregate number. The card shows a "needs more data" banner.
   * Threshold intentionally low (10) so teams can start seeing signal
   * as soon as they start capturing outcomes, but the UI is clear
   * that the number is directional only.
   */
  lowConfidence: boolean;
}

const LOW_CONFIDENCE_THRESHOLD = 10;

/** Map a clamped integer score to the same 4 bands the scorer uses. */
export function scoreToBand(score: number): BandCalibration["band"] {
  if (score >= 70) return "strong";
  if (score >= 55) return "healthy";
  if (score >= 35) return "mixed";
  return "at_risk";
}

/**
 * Core calibration calculator. Given a list of observations, produce
 * the aggregate report. Filters out malformed rows defensively — a bad
 * row shouldn't kill the whole calibration number.
 */
export function computeCalibrationReport(
  observations: CalibrationObservation[],
): CalibrationReport {
  const valid = observations.filter(
    (o) =>
      Number.isFinite(o.score) &&
      o.score >= 0 &&
      o.score <= 100 &&
      (o.outcome === "won" || o.outcome === "lost" || o.outcome === "expired"),
  );

  if (valid.length === 0) {
    // lowConfidence is `false` here (not `true`) — "we have zero data"
    // is semantically different from "we have a small sample". Callers
    // that key off lowConfidence to show "need more data" warnings
    // should check sampleSize==0 separately.
    return {
      sampleSize: 0,
      accuracyPct: null,
      brierScore: null,
      bands: emptyBands(),
      lowConfidence: false,
    };
  }

  // Build per-band counters.
  const bandAccum: Record<BandCalibration["band"], { n: number; won: number; lost: number }> = {
    strong: { n: 0, won: 0, lost: 0 },
    healthy: { n: 0, won: 0, lost: 0 },
    mixed: { n: 0, won: 0, lost: 0 },
    at_risk: { n: 0, won: 0, lost: 0 },
  };

  let agreement = 0;
  let brierSum = 0;

  for (const obs of valid) {
    const band = scoreToBand(obs.score);
    const didWin = obs.outcome === "won";
    bandAccum[band].n += 1;
    if (didWin) bandAccum[band].won += 1;
    else bandAccum[band].lost += 1;

    // "Agreement" = scorer and reality pointed the same direction:
    //   strong|healthy predicted "likely win" and deal won, OR
    //   mixed|at_risk predicted "likely loss" and deal lost/expired.
    const predictedWin = band === "strong" || band === "healthy";
    if (predictedWin === didWin) agreement += 1;

    // Brier uses the raw score as a probability in [0,1].
    const pred = obs.score / 100;
    const actual = didWin ? 1 : 0;
    brierSum += (pred - actual) * (pred - actual);
  }

  const bands: BandCalibration[] = (["strong", "healthy", "mixed", "at_risk"] as const).map(
    (band) => {
      const { n, won, lost } = bandAccum[band];
      return {
        band,
        n,
        won,
        lost,
        winRate: n > 0 ? won / n : null,
      };
    },
  );

  return {
    sampleSize: valid.length,
    accuracyPct: agreement / valid.length,
    brierScore: brierSum / valid.length,
    bands,
    lowConfidence: valid.length < LOW_CONFIDENCE_THRESHOLD,
  };
}

function emptyBands(): BandCalibration[] {
  return (["strong", "healthy", "mixed", "at_risk"] as const).map((band) => ({
    band,
    n: 0,
    won: 0,
    lost: 0,
    winRate: null,
  }));
}

/**
 * Format helper used by the card — keeps percent formatting logic out
 * of the component so tests can verify "null → '—'" + "<10 → (n=x)" +
 * "healthy → '67%'" patterns without touching React.
 */
export function formatPct(value: number | null, opts: { digits?: number } = {}): string {
  if (value == null) return "—";
  const digits = opts.digits ?? 0;
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * One-line headline for the top of the calibration card. Designed to
 * be scannable in under 1.5 seconds.
 */
export function calibrationHeadline(report: CalibrationReport): string {
  if (report.sampleSize === 0) {
    return "No closed deals with a saved score yet.";
  }
  if (report.lowConfidence) {
    return `Directional only — ${report.sampleSize} closed deal${report.sampleSize === 1 ? "" : "s"} so far.`;
  }
  const pct = formatPct(report.accuracyPct);
  return `Scorer agrees with reality ${pct} of the time across ${report.sampleSize} closed deals.`;
}
