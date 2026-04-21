/**
 * Proposal Confidence Score — Slice 20v.
 *
 * Every slice before this one built a *signal*:
 *   • 20k/l — shadow agreement rate
 *   • 20m   — scorer proposal body + its own `lowConfidence` flag
 *   • 20p   — what-if Brier + hit-rate deltas
 *   • 20r   — per-factor drift detection
 *   • 20s   — scorer-wide calibration drift
 *
 * Managers now see all of them — but the card never answers the single
 * question that matters most at the moment of action: **should I
 * actually apply this proposal?** The signals sit side by side, and the
 * manager has to mentally triangulate across five cards.
 *
 * This slice composes them into one honest meta-confidence number with
 * per-driver rationale. The number is not "how confident is the scorer"
 * — that's already surfaced as the proposal's internal `lowConfidence`.
 * This is "how confident are we that *applying this proposal* would
 * improve things."
 *
 * Scoring rubric (starts at a deliberately agnostic 50):
 *
 *   Sample size            0 → +20   more closed-deal audits = more trust
 *   Calibration drift      -5 → +15  responding to a dulling scorer is
 *                                    worth more than tuning an already-
 *                                    improving one
 *   What-if improvement    -15 → +25 simulated Brier + hit-rate delta
 *                                    on historical audits — the strongest
 *                                    single signal when available
 *   Shadow corroboration   -5 → +10  shadow's track record of winning
 *                                    its disagreements
 *   Factor drift coherence 0 → +10   how many proposed changes map to
 *                                    factors we've actually seen drift
 *
 * Clamped to [0, 100]. Bands: ≥70 high, 45-69 medium, <45 low.
 *
 * Move-2 relevance: commodity CRMs hand managers a recommendation and
 * leave the trust calibration as the manager's problem. QEP stacks the
 * receipts and tells the manager, honestly, "here's why this is a 78 —
 * and here's why it would be a 42 if we were ignoring the thin-sample
 * warning." That's transparent-over-confident stance compounding — the
 * same honesty tax already paid by every upstream card, rolled into one
 * number the manager can glance at and act on.
 *
 * Pure functions — no I/O.
 */

import type { ScorerProposal } from "./scorer-proposal";
import type { CalibrationDriftReport } from "./calibration-drift";
import type { FactorDriftReport } from "./factor-drift";
import type { ScorerWhatIfResult } from "./scorer-what-if";
import type { ShadowAgreementSummary } from "./retrospective-shadow";

export type ProposalConfidenceBand = "high" | "medium" | "low";

export type ProposalConfidenceSignal =
  | "sample_size"
  | "calibration_drift"
  | "what_if"
  | "shadow_agreement"
  | "factor_drift_coherence";

export interface ProposalConfidenceDriver {
  signal: ProposalConfidenceSignal;
  /** Points added to (or subtracted from) the confidence score. */
  contribution: number;
  /** Rep/manager-readable one-liner explaining why this driver moved the dial. */
  rationale: string;
}

export interface ProposalConfidenceResult {
  /** 0..100 meta-confidence. */
  confidence: number;
  /** Band mapped from `confidence` — drives card pill color. */
  band: ProposalConfidenceBand;
  /** Per-signal contributions, ordered by |contribution| descending. */
  drivers: ProposalConfidenceDriver[];
  /** One-sentence narrative citing the top 1-2 drivers. */
  rationale: string;
  /** True when proposal.lowConfidence is set — we halve positive
   *  contributions as an honesty tax even when individual signals look
   *  strong, because the underlying attribution is thin. */
  dampenedByThinSample: boolean;
}

export interface ProposalConfidenceInputs {
  calibrationDrift: CalibrationDriftReport | null;
  factorDrift: FactorDriftReport | null;
  whatIf: ScorerWhatIfResult | null;
  shadowAgreement: ShadowAgreementSummary | null;
  /** Total closed-deal audits the proposal was derived from — drives
   *  the sample-size driver. Zero is a valid value (means we have a
   *  proposal from a synthetic or empty dataset). */
  auditCount: number;
}

/** Starting point before any signal moves the dial. */
export const CONFIDENCE_BASE = 50;

/** Band thresholds. Low < MEDIUM_THRESHOLD ≤ medium < HIGH_THRESHOLD ≤ high. */
export const HIGH_CONFIDENCE_THRESHOLD = 70;
export const MEDIUM_CONFIDENCE_THRESHOLD = 45;

/**
 * Compute the meta-confidence score for a proposal.
 *
 * Designed to be called whenever the manager-facing proposal card
 * renders — pure, cheap, deterministic. No memoization inside; the
 * caller's `useMemo` already dedupes.
 */
export function computeProposalConfidence(
  proposal: ScorerProposal,
  inputs: ProposalConfidenceInputs,
): ProposalConfidenceResult {
  const drivers: ProposalConfidenceDriver[] = [];
  let score = CONFIDENCE_BASE;

  // ── Sample size ──────────────────────────────────────────────────────
  // Scaled so 51+ audits earns the full +20; below 11 earns nothing —
  // that's the same threshold that triggers the proposal's own
  // `lowConfidence` flag elsewhere in the arc.
  const sampleContribution = sampleSizeContribution(inputs.auditCount);
  if (sampleContribution.contribution !== 0) {
    drivers.push({
      signal: "sample_size",
      contribution: sampleContribution.contribution,
      rationale: sampleContribution.rationale,
    });
    score += sampleContribution.contribution;
  }

  // ── Calibration drift direction ──────────────────────────────────────
  if (inputs.calibrationDrift && inputs.calibrationDrift.recentN > 0) {
    const d = inputs.calibrationDrift;
    if (d.direction === "degrading" && !d.lowConfidence) {
      drivers.push({
        signal: "calibration_drift",
        contribution: +15,
        rationale: `Scorer is dulling (${formatPp(d.accuracyDelta)} over ${d.windowDays}d) — applying this proposal is a direct response to a measured problem.`,
      });
      score += 15;
    } else if (d.direction === "improving" && !d.lowConfidence) {
      drivers.push({
        signal: "calibration_drift",
        contribution: -5,
        rationale: `Scorer is already sharpening on its own (${formatPp(d.accuracyDelta)} over ${d.windowDays}d) — less urgent to hand-tune.`,
      });
      score -= 5;
    }
    // Stable / low-confidence: no contribution, no driver row.
  }

  // ── What-if Brier / hit-rate improvement ────────────────────────────
  if (
    inputs.whatIf &&
    !inputs.whatIf.noActionableChanges &&
    inputs.whatIf.brierDelta !== null
  ) {
    const w = inputs.whatIf;
    const brierImproves = (w.brierDelta ?? 0) < 0; // negative = improvement
    const hitRateImproves = (w.hitRateDelta ?? 0) > 0;
    let contrib = 0;
    let rationale = "";
    if ((w.brierDelta ?? 0) <= -0.02 && hitRateImproves) {
      contrib = 25;
      rationale = `Simulated Brier improves by ${(-w.brierDelta!).toFixed(3)} and hit rate lifts ${formatPp(w.hitRateDelta)} on ${w.dealsSimulated} historical deals — strongest single signal.`;
    } else if (brierImproves) {
      contrib = 12;
      rationale = `Simulated Brier improves by ${(-w.brierDelta!).toFixed(3)} on ${w.dealsSimulated} deals — directional gain.`;
    } else if ((w.brierDelta ?? 0) > 0.005) {
      // Proposal would make calibration *worse*. This is rare for a
      // rule-driven proposal but it's the single loudest honesty
      // signal we have — never hide it.
      contrib = -15;
      rationale = `Simulated Brier worsens by ${w.brierDelta!.toFixed(3)} on ${w.dealsSimulated} deals — applying this would hurt accuracy.`;
    }
    if (contrib !== 0) {
      // Thin-sample what-if halves the contribution; we still report it
      // because abstaining from an available signal is worse than noting
      // it's directional.
      if (w.lowConfidence) {
        contrib = Math.sign(contrib) * Math.round(Math.abs(contrib) / 2);
        rationale = `${rationale} (Thin simulation sample — directional only.)`;
      }
      drivers.push({ signal: "what_if", contribution: contrib, rationale });
      score += contrib;
    }
  }

  // ── Shadow corroboration ────────────────────────────────────────────
  if (
    inputs.shadowAgreement &&
    !inputs.shadowAgreement.lowConfidence &&
    inputs.shadowAgreement.shadowDisagreementWinRate !== null &&
    inputs.shadowAgreement.disagreementCount > 0
  ) {
    const rate = inputs.shadowAgreement.shadowDisagreementWinRate;
    if (rate >= 0.6) {
      drivers.push({
        signal: "shadow_agreement",
        contribution: +10,
        rationale: `Shadow model won ${Math.round(rate * 100)}% of its disagreements with the rule scorer — independent corroboration that adjustments are needed.`,
      });
      score += 10;
    } else if (rate < 0.4) {
      drivers.push({
        signal: "shadow_agreement",
        contribution: -5,
        rationale: `Shadow model only won ${Math.round(rate * 100)}% of its disagreements — its opinion carries less weight than the rule scorer's.`,
      });
      score -= 5;
    }
    // 0.4-0.6: coin-flip-ish, no signal.
  }

  // ── Factor-drift coherence ──────────────────────────────────────────
  // If the proposal's actionable changes line up with factors we've
  // actually seen drift, that's corroboration. A proposal recommending
  // to flip a factor that *hasn't* drifted is more speculative — fine,
  // but we don't pay extra trust for it.
  if (inputs.factorDrift && inputs.factorDrift.drifts.length > 0) {
    const driftLabels = new Set(
      inputs.factorDrift.drifts.map((d) => d.label),
    );
    const actionable = proposal.changes.filter((c) => c.action !== "keep");
    if (actionable.length > 0) {
      const matched = actionable.filter((c) => driftLabels.has(c.label));
      const matchRatio = matched.length / actionable.length;
      if (matchRatio >= 0.5) {
        drivers.push({
          signal: "factor_drift_coherence",
          contribution: +10,
          rationale: `${matched.length} of ${actionable.length} recommended changes align with factors that have actually drifted — the proposal is tracking reality.`,
        });
        score += 10;
      } else if (matchRatio >= 0.25) {
        drivers.push({
          signal: "factor_drift_coherence",
          contribution: +5,
          rationale: `${matched.length} of ${actionable.length} recommended changes align with drifting factors — partial corroboration.`,
        });
        score += 5;
      }
    }
  }

  // ── Thin-sample damping ─────────────────────────────────────────────
  // When the proposal itself is flagged lowConfidence (thin attribution
  // data — 20g's threshold), we halve positive contributions. We don't
  // halve negatives: an actively-worse what-if is the one thing we want
  // to shout about even when data is thin.
  let dampened = false;
  if (proposal.lowConfidence) {
    dampened = true;
    let adjustment = 0;
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i];
      if (d.contribution > 0) {
        const halved = Math.round(d.contribution / 2);
        const diff = halved - d.contribution;
        adjustment += diff;
        drivers[i] = {
          ...d,
          contribution: halved,
          rationale: `${d.rationale} (Halved — proposal's underlying factor attribution is thin.)`,
        };
      }
    }
    score += adjustment;
  }

  // ── Clamp + band ────────────────────────────────────────────────────
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band: ProposalConfidenceBand =
    clamped >= HIGH_CONFIDENCE_THRESHOLD
      ? "high"
      : clamped >= MEDIUM_CONFIDENCE_THRESHOLD
        ? "medium"
        : "low";

  // Sort drivers so the UI can render the biggest movers first,
  // independent of the order we pushed them in above.
  drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    confidence: clamped,
    band,
    drivers,
    rationale: buildRationale(clamped, band, drivers, dampened),
    dampenedByThinSample: dampened,
  };
}

/**
 * Short pill label for the confidence band — shown next to the urgency
 * pill in the card header. Kept here so the copy is testable.
 */
export function describeProposalConfidencePill(
  band: ProposalConfidenceBand,
): string {
  if (band === "high") return "HIGH CONFIDENCE";
  if (band === "low") return "LOW CONFIDENCE";
  return "MEDIUM CONFIDENCE";
}

// ── Internals ─────────────────────────────────────────────────────────

function sampleSizeContribution(n: number): {
  contribution: number;
  rationale: string;
} {
  if (n >= 51) {
    return {
      contribution: 20,
      rationale: `${n} closed-deal audits back this proposal — substantial sample.`,
    };
  }
  if (n >= 26) {
    return {
      contribution: 12,
      rationale: `${n} closed-deal audits — healthy sample, adjustments trustworthy.`,
    };
  }
  if (n >= 11) {
    return {
      contribution: 5,
      rationale: `${n} closed-deal audits — minimum viable sample for directional calls.`,
    };
  }
  if (n === 0) {
    return { contribution: 0, rationale: "" };
  }
  // 1..10
  return {
    contribution: -5,
    rationale: `Only ${n} closed-deal audit${n === 1 ? "" : "s"} — below the 11-deal minimum for trustworthy attribution.`,
  };
}

function buildRationale(
  confidence: number,
  band: ProposalConfidenceBand,
  drivers: ProposalConfidenceDriver[],
  dampened: boolean,
): string {
  if (drivers.length === 0) {
    return "Neutral prior — no signals yet to move confidence in either direction.";
  }
  const top = drivers[0];
  const second = drivers[1];
  const dampenedNote = dampened
    ? " Contributions dampened — proposal attribution sample is thin."
    : "";
  if (band === "high") {
    const secondPhrase = second
      ? ` plus ${phraseForDriver(second)}`
      : "";
    return `High confidence (${confidence}) — driven by ${phraseForDriver(top)}${secondPhrase}.${dampenedNote}`;
  }
  if (band === "low") {
    const secondPhrase = second ? `, with ${phraseForDriver(second)}` : "";
    return `Low confidence (${confidence}) — the dominant drag is ${phraseForDriver(top)}${secondPhrase}. Hold until signals strengthen.${dampenedNote}`;
  }
  // medium
  const secondPhrase = second
    ? `, balanced against ${phraseForDriver(second)}`
    : "";
  return `Medium confidence (${confidence}) — ${phraseForDriver(top)}${secondPhrase}. Review with human judgment.${dampenedNote}`;
}

/** Short noun-phrase form of a driver for use in the rationale sentence. */
function phraseForDriver(d: ProposalConfidenceDriver): string {
  const sign = d.contribution > 0 ? "+" : "";
  const num = `${sign}${d.contribution}`;
  switch (d.signal) {
    case "sample_size":
      return `sample size (${num})`;
    case "calibration_drift":
      return `calibration drift direction (${num})`;
    case "what_if":
      return `what-if preview (${num})`;
    case "shadow_agreement":
      return `shadow corroboration (${num})`;
    case "factor_drift_coherence":
      return `factor-drift coherence (${num})`;
  }
}

function formatPp(delta: number | null): string {
  if (delta === null) return "—";
  const pp = Math.round(delta * 100);
  return `${pp > 0 ? "+" : ""}${pp}pp`;
}
