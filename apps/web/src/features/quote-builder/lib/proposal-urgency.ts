/**
 * Proposal Urgency — Slice 20t.
 *
 * 20m emits a structured scorer-evolution proposal. 20s tells us
 * whether the scorer's overall calibration is improving, holding, or
 * dulling over the last 90 days. This slice joins the two: the
 * proposal is the same regardless of trend, but the *urgency* with
 * which the manager should act on it depends heavily on which way the
 * engine is moving.
 *
 * Three urgency levels drive card tone + copy:
 *
 *   • `high`   — calibration is degrading with a substantive hit-rate
 *                drop and the sample is trusted. Rose escalation —
 *                "open the PR this week."
 *   • `medium` — calibration is stable, unavailable, or degrading
 *                with thin data / small delta. Violet (default) —
 *                "review when you have time."
 *   • `low`    — calibration is improving with a trusted sample.
 *                Emerald — "the scorer is sharpening on its own, so
 *                these are polish changes, not firefighting."
 *
 * Move-2 relevance: commodity CRMs promote all their prediction advice
 * at the same volume. QEP escalates based on measured reality — the
 * proposal gets louder when the engine actually needs attention and
 * softer when it's trending up on its own. That matched-tone-to-truth
 * is the transparent-over-confident stance in action.
 *
 * Pure functions — no I/O.
 */

import type { CalibrationDriftReport } from "./calibration-drift";

/**
 * Substantive hit-rate drop threshold for escalation. Matches the
 * intuition "5pp is noise, 8pp is a story, 10pp is an emergency" — we
 * escalate to `high` at 8pp which is firmly outside routine sampling
 * noise on 20–40 deals per window. Below this we stay at `medium`
 * even when the direction is degrading.
 */
export const HIGH_URGENCY_ACCURACY_DROP = 0.08;

export type ProposalUrgency = "high" | "medium" | "low";

export interface ProposalUrgencyResult {
  urgency: ProposalUrgency;
  /**
   * One-sentence rationale the card can render verbatim. Null when
   * there's no calibration signal to explain the urgency (defaults to
   * medium silently — no extra copy to distract the reader).
   */
  rationale: string | null;
}

/**
 * Decide the urgency from a calibration drift report.
 *
 * Decision tree:
 *   1. Null / no data / insufficient samples → medium (silent).
 *   2. Degrading & trusted & accuracy drop ≥ 8pp → high.
 *   3. Degrading (any other) → medium with a "watch" note.
 *   4. Improving & trusted → low.
 *   5. Stable → medium (silent).
 *
 * The "trusted" gate (`!lowConfidence`) is deliberately strict — we
 * only escalate to high or de-escalate to low when we have real
 * samples on both sides. A single quarter with 3 deals that happened
 * to flip isn't an emergency, it's a measurement artifact.
 */
export function computeProposalUrgency(
  drift: CalibrationDriftReport | null,
): ProposalUrgencyResult {
  if (!drift) {
    return { urgency: "medium", rationale: null };
  }
  if (drift.recentN === 0 && drift.priorN === 0) {
    return { urgency: "medium", rationale: null };
  }
  if (drift.lowConfidence) {
    // Thin data: we can't escalate or de-escalate responsibly, so we
    // sit at medium. If the direction is degrading we still note it —
    // the manager should know a trend is starting to show even if we
    // can't confirm it yet.
    if (drift.direction === "degrading") {
      return {
        urgency: "medium",
        rationale: `Directional signal: scorer may be dulling (${formatAccDelta(drift.accuracyDelta)}) but sample is thin — treat these changes as the usual review queue.`,
      };
    }
    return { urgency: "medium", rationale: null };
  }

  if (drift.direction === "degrading") {
    const dropDeep =
      drift.accuracyDelta !== null &&
      drift.accuracyDelta <= -HIGH_URGENCY_ACCURACY_DROP;
    if (dropDeep) {
      return {
        urgency: "high",
        rationale: `Scorer dulled ${formatAccDelta(drift.accuracyDelta)} over the last ${drift.windowDays} days — open a scorer PR this week.`,
      };
    }
    return {
      urgency: "medium",
      rationale: `Calibration slipping (${formatAccDelta(drift.accuracyDelta)}) — review these changes at the next weekly cadence.`,
    };
  }

  if (drift.direction === "improving") {
    return {
      urgency: "low",
      rationale: `Scorer is sharpening on its own (${formatAccDelta(drift.accuracyDelta)} over the last ${drift.windowDays} days) — these are polish changes, not firefighting.`,
    };
  }

  // Stable with trusted sample: no escalation, no copy noise.
  return { urgency: "medium", rationale: null };
}

/**
 * Short pill label for the urgency state — shown in the card header.
 * Kept here so the copy is testable + the component stays dumb.
 */
export function describeProposalUrgencyPill(urgency: ProposalUrgency): string {
  if (urgency === "high") return "HIGH PRIORITY";
  if (urgency === "low") return "LOW URGENCY";
  return "STANDARD";
}

/**
 * Format a signed accuracy delta as pp (percentage points). Keeps the
 * sign explicit so "-12pp" and "+8pp" both read naturally in prose.
 */
function formatAccDelta(delta: number | null): string {
  if (delta === null) return "—";
  const pp = Math.round(delta * 100);
  return `${pp > 0 ? "+" : ""}${pp}pp`;
}
