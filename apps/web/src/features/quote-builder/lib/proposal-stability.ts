/**
 * Proposal Stability (Sensitivity Analysis) — Slice 20aa.
 *
 * Slices 20m–20z built the decision layer: what to change, how sure we
 * are, whether to apply, what to monitor after applying. Every one of
 * those calls rests on the measured `lift` number for each factor —
 * but `lift` is itself a measurement with some noise. A factor with a
 * measured lift of +0.26 and a `strengthen` recommendation would look
 * pretty different at +0.24 (still strengthen) or +0.18 (keep). One
 * recommendation is rock-solid; the other is a knife's-edge call.
 *
 * This module answers: for each actionable change in the proposal,
 * HOW STABLE is that specific recommendation against small
 * perturbations of the measured lift?
 *
 * The method is deterministic perturbation: for each factor, we walk a
 * fixed grid of lift shifts {-5pp, -2.5pp, 0, +2.5pp, +5pp} and
 * sample-size scales {0.8, 1.0, 1.2}, re-run the `pickAction`
 * classifier on each perturbed cell, and count:
 *
 *   • `stability`   — fraction of perturbations that preserved the
 *                     original action verb. 1.0 = rock solid, 0.0 =
 *                     every nearby sample would pick a different verb.
 *   • `altAction`   — the single most common alternative action verb
 *                     when the original flipped, or null if stability
 *                     is 1.0. Tells the manager which way the call
 *                     would drift ("would become 'keep' if lift were
 *                     2pp lower").
 *   • `rating`      — "stable" (≥0.8) / "mixed" (≥0.5) / "fragile"
 *                     (<0.5). UI band.
 *
 * At the proposal level we emit the mean per-change stability and a
 * single verdict pill ("Stability: stable" / "mixed" / "fragile"), so
 * the manager can read the top-line without drilling in.
 *
 * Why this is Move-2 and not commodity: a commodity CRM says "here is
 * the new model, apply it." QEP says "here is the new model, AND here
 * is which specific pieces of it would change if one more deal came
 * in." The manager gets to separate the rock-solid calls from the
 * close ones — the same scorer change is not one binary decision, it
 * is N per-factor decisions with different confidences, and treating
 * them uniformly is a category error.
 *
 * Pure function — no I/O. Deterministic for a given input.
 */

import type {
  FactorAttribution,
  FactorAttributionReport,
} from "./factor-attribution";
import { pickAction } from "./scorer-proposal";
import type {
  ScorerAction,
  ScorerFactorChange,
  ScorerProposal,
} from "./scorer-proposal";

/**
 * Lift-shift perturbation grid, expressed as absolute lift deltas.
 * -5pp to +5pp in 2.5pp steps — the range a single outlier deal can
 * move the lift by on a typical sample, and the smallest delta a
 * human reader can tell apart. Five grid points.
 */
export const LIFT_PERTURBATIONS = [-0.05, -0.025, 0, 0.025, 0.05] as const;

/**
 * Sample-size scale perturbations. Multiplies `present` and `absent`
 * counts uniformly to simulate "what if we had 20% fewer / more
 * observations". Three grid points keep the total at 15 cells per
 * factor — enough granularity, still <1ms to compute.
 */
export const SAMPLE_SCALE_PERTURBATIONS = [0.8, 1.0, 1.2] as const;

/**
 * Rating bands for the overall stability score. Tuned so that "stable"
 * means "≤1 of 15 cells flipped" (≥0.87 naturally, but 0.8 gives
 * breathing room), "mixed" means the recommendation holds in a
 * majority of cells but is genuinely contested, and "fragile" means
 * the majority of perturbations would have picked a different verb.
 */
export const STABLE_THRESHOLD = 0.8;
export const MIXED_THRESHOLD = 0.5;

export type StabilityRating = "stable" | "mixed" | "fragile";

export interface ChangeStability {
  label: string;
  /** The action the proposal originally picked. */
  action: Exclude<ScorerAction, "keep">;
  /** Fraction of perturbation cells that preserved `action`, 0..1. */
  stability: number;
  /** Most common alternative action when the original flipped, else null. */
  altAction: ScorerAction | null;
  /** "stable" / "mixed" / "fragile" based on `stability`. */
  rating: StabilityRating;
}

export interface ProposalStabilityReport {
  /** Per-actionable-change stability rows, sorted least-stable-first
   *  so the UI shows the knife's-edge calls at the top. */
  changes: ChangeStability[];
  /** Mean stability across actionable changes, 0..1. Null when there
   *  are no actionable changes to evaluate. */
  meanStability: number | null;
  /** Aggregate rating from `meanStability` + worst-case cushion. */
  rating: StabilityRating | null;
  /** One-sentence summary for headline rendering. Null on empty. */
  headline: string | null;
  /** True when the proposal has no actionable changes to evaluate. */
  empty: boolean;
}

/**
 * Build the stability report.
 *
 * Returns `empty=true` when the proposal has no actionable changes,
 * because there's nothing to stability-test. Otherwise emits a
 * per-change row for every actionable change (flip / strengthen /
 * weaken / drop) along with the aggregate rating.
 */
export function computeProposalStability(
  attribution: FactorAttributionReport | null,
  proposal: ScorerProposal | null,
): ProposalStabilityReport {
  if (!proposal || proposal.changes.length === 0 || !attribution) {
    return emptyReport();
  }

  const actionable = proposal.changes.filter((c) => c.action !== "keep");
  if (actionable.length === 0) return emptyReport();

  // Build a by-label lookup into the raw FactorAttribution rows so we
  // can pull the starting numbers (winRateWhenPresent/Absent, present,
  // absent) and re-derive perturbed lifts.
  const attrByLabel = new Map<string, FactorAttribution>();
  for (const f of attribution.factors) attrByLabel.set(f.label, f);

  const rows: ChangeStability[] = [];
  for (const change of actionable) {
    const attr = attrByLabel.get(change.label);
    const action = change.action as Exclude<ScorerAction, "keep">;
    if (!attr) {
      // No underlying attribution row — treat as fragile (we can't
      // test it at all) rather than silently omit it. Makes the
      // missing-data case visible.
      rows.push({
        label: change.label,
        action,
        stability: 0,
        altAction: null,
        rating: "fragile",
      });
      continue;
    }
    rows.push(evaluateChange(change, attr, action));
  }

  // Sort least-stable first so the UI leads with the risky calls. Ties
  // broken by original actionable order (preserved via index).
  const withIdx = rows.map((row, i) => ({ row, i }));
  withIdx.sort((a, b) => {
    if (a.row.stability !== b.row.stability) {
      return a.row.stability - b.row.stability;
    }
    return a.i - b.i;
  });
  const sorted = withIdx.map((x) => x.row);

  const meanStability =
    sorted.reduce((acc, r) => acc + r.stability, 0) / sorted.length;
  const rating = deriveAggregateRating(sorted, meanStability);
  const headline = describeHeadline(sorted, meanStability, rating);

  return {
    changes: sorted,
    meanStability,
    rating,
    headline,
    empty: false,
  };
}

function emptyReport(): ProposalStabilityReport {
  return {
    changes: [],
    meanStability: null,
    rating: null,
    headline: null,
    empty: true,
  };
}

function evaluateChange(
  change: ScorerFactorChange,
  attr: FactorAttribution,
  action: Exclude<ScorerAction, "keep">,
): ChangeStability {
  let total = 0;
  let preserved = 0;
  const altCounts = new Map<ScorerAction, number>();

  for (const liftShift of LIFT_PERTURBATIONS) {
    for (const sampleScale of SAMPLE_SCALE_PERTURBATIONS) {
      const perturbed = perturbFactor(attr, liftShift, sampleScale);
      const result = pickAction(perturbed);
      total += 1;
      if (result.action === action) {
        preserved += 1;
      } else {
        altCounts.set(result.action, (altCounts.get(result.action) ?? 0) + 1);
      }
    }
  }

  const stability = total === 0 ? 0 : preserved / total;
  const altAction = dominantAlt(altCounts);
  return {
    label: change.label,
    action,
    stability,
    altAction,
    rating: rateBand(stability),
  };
}

/**
 * Produce a perturbed copy of a FactorAttribution row with:
 *   • lift shifted by `liftShift` absolute (clamped to [-1, +1])
 *   • present/absent counts scaled by `sampleScale` (min 1 each)
 *   • winRateWhenPresent/Absent re-derived from the shifted lift while
 *     preserving one side's rate and deriving the other
 *
 * We preserve `winRateWhenAbsent` as the anchor and move
 * `winRateWhenPresent` to honour the shifted lift. That matches the
 * measurement interpretation "we learned one more win/loss on the
 * present side", which is the typical way lift moves between sample
 * updates.
 */
function perturbFactor(
  attr: FactorAttribution,
  liftShift: number,
  sampleScale: number,
): FactorAttribution {
  if (attr.lift === null) {
    // No measurable lift — can't perturb meaningfully. Return the
    // original; pickAction will yield the same verdict and the cell
    // will count as "preserved". This pulls null-lift rows toward
    // stable=1.0 which is honest: we can't falsify the verdict.
    return attr;
  }
  const shiftedLift = Math.min(1, Math.max(-1, attr.lift + liftShift));

  const scaledPresent = Math.max(1, Math.round(attr.present * sampleScale));
  const scaledAbsent = Math.max(1, Math.round(attr.absent * sampleScale));

  // Anchor the absent-side rate (assume we didn't learn anything new
  // on that side) and move the present-side rate to honour the new
  // lift. If absent rate is null, fall back to 0 so the subtraction
  // math still works.
  const absentRate = attr.winRateWhenAbsent ?? 0;
  const presentRate = Math.min(1, Math.max(0, absentRate + shiftedLift));

  return {
    label: attr.label,
    present: scaledPresent,
    presentWins: Math.round(scaledPresent * presentRate),
    absent: scaledAbsent,
    absentWins: Math.round(scaledAbsent * absentRate),
    avgWeightWhenPresent: attr.avgWeightWhenPresent,
    lift: shiftedLift,
    winRateWhenPresent: presentRate,
    winRateWhenAbsent: absentRate,
    // Recompute low-confidence based on the scaled sample. pickAction
    // early-returns `keep` when lowConfidence is true, which models the
    // "would we even trust this at a thinner sample?" question honestly.
    lowConfidence: scaledPresent < 3 || scaledAbsent < 3,
  };
}

function dominantAlt(counts: Map<ScorerAction, number>): ScorerAction | null {
  if (counts.size === 0) return null;
  let top: ScorerAction | null = null;
  let topN = 0;
  // Deterministic tie-breaking by action-verb alphabetical order so
  // test expectations are stable across runs.
  const ordered: ScorerAction[] = ["drop", "flip", "keep", "strengthen", "weaken"];
  for (const a of ordered) {
    const n = counts.get(a) ?? 0;
    if (n > topN) {
      top = a;
      topN = n;
    }
  }
  return top;
}

function rateBand(stability: number): StabilityRating {
  if (stability >= STABLE_THRESHOLD) return "stable";
  if (stability >= MIXED_THRESHOLD) return "mixed";
  return "fragile";
}

/**
 * The aggregate rating needs to be honest about the worst row, not
 * just the mean. A proposal with one fragile flip and two rock-solid
 * drops has a high mean but shouldn't read "stable" — the manager
 * needs to see that at least one piece is on a knife's edge.
 *
 * Rules:
 *   • If ANY change is fragile → aggregate is at most "mixed".
 *   • Otherwise mean decides.
 */
function deriveAggregateRating(
  rows: ChangeStability[],
  mean: number,
): StabilityRating {
  const worst = rows.reduce(
    (acc, r) => (r.stability < acc ? r.stability : acc),
    1,
  );
  if (worst < MIXED_THRESHOLD) return "fragile";
  const base = rateBand(mean);
  // One fragile row would already have been caught above; now guard
  // against the "mean says stable but worst row is mixed" case.
  if (base === "stable" && worst < STABLE_THRESHOLD) return "mixed";
  return base;
}

function describeHeadline(
  rows: ChangeStability[],
  mean: number,
  rating: StabilityRating,
): string {
  const pct = Math.round(mean * 100);
  const n = rows.length;
  const fragile = rows.filter((r) => r.rating === "fragile").length;
  const mixed = rows.filter((r) => r.rating === "mixed").length;
  const stableCount = rows.filter((r) => r.rating === "stable").length;

  if (rating === "stable") {
    return `Stable — ${pct}% mean stability across ${n} actionable change${n === 1 ? "" : "s"}, all survive small lift perturbations.`;
  }
  if (rating === "mixed") {
    if (fragile > 0) {
      return `Mixed — ${pct}% mean stability, but ${fragile} of ${n} change${n === 1 ? "" : "s"} ${fragile === 1 ? "is" : "are"} fragile against small perturbations.`;
    }
    return `Mixed — ${pct}% mean stability across ${n} actionable change${n === 1 ? "" : "s"} (${stableCount} stable, ${mixed} mixed).`;
  }
  return `Fragile — ${pct}% mean stability, ${fragile} of ${n} change${n === 1 ? "" : "s"} would pick a different action under small perturbations.`;
}

/**
 * Pill copy / tone for the UI. Consumer picks colour based on rating.
 */
export function describeStabilityPill(
  report: ProposalStabilityReport,
): { label: string; tone: "emerald" | "amber" | "rose" | "muted" } {
  if (report.empty || report.rating === null || report.meanStability === null) {
    return { label: "— NO DATA", tone: "muted" };
  }
  const pct = Math.round(report.meanStability * 100);
  if (report.rating === "stable") {
    return { label: `✓ STABLE ${pct}%`, tone: "emerald" };
  }
  if (report.rating === "mixed") {
    return { label: `⚠ MIXED ${pct}%`, tone: "amber" };
  }
  return { label: `✗ FRAGILE ${pct}%`, tone: "rose" };
}
