/**
 * Ensemble Win Probability — Slice 20q.
 *
 * The live strip shows the rep two numbers today: the rule score (big,
 * 0..100) and the shadow K-NN chip (small, 0..100). When they disagree
 * the rep is silently asked to pick which to trust — a cognitive tax
 * that commodity CRMs don't charge because commodity CRMs only have
 * one model. QEP carries two on purpose, and the price of that
 * diversity is a decision the rep shouldn't have to make themselves.
 *
 * This module closes that loop. Given 20k's retrospective shadow
 * summary — which measures rule and shadow agreement-with-reality on
 * the SAME scorable subset — we emit one consensus number plus a
 * defensible sentence on how the weights were chosen.
 *
 * Move-2 relevance: this is the transformation commodity CRMs don't
 * deliver. They score by one model or the other; we blend two, weight
 * them by measured skill, and surface the blend with its receipts.
 *
 * Design bar (carried from earlier slices): *transparent over
 * confident*. When we don't have enough data to weight meaningfully,
 * we fall back to rule-only and say so. We never hide the blend math.
 *
 * Pure functions — no I/O. The WinProbabilityStrip wires everything
 * through here and renders `ensembleScore` + `explanation`.
 */

import type { ShadowScoreResult } from "./shadow-score";
import type { ShadowAgreementSummary } from "./retrospective-shadow";

/**
 * Reason the ensemble landed where it did. Used by the UI to pick the
 * right copy + decide whether to show a blended pill at all.
 *
 *   • `rule-only`        — we have no shadow (null), shadow abstained
 *                          via low confidence, or neither model clears
 *                          chance → don't surface a "consensus" pill.
 *   • `shadow-only`      — rule is absent/zero-skill AND shadow clears
 *                          chance. Edge case (shadow track record >
 *                          rule's) but we handle it symmetrically.
 *   • `blended`          — both models have above-chance skill; the
 *                          weighted ensemble is the signal the rep
 *                          should lean on.
 *   • `calibration-thin` — we have both scores but 20k doesn't have
 *                          enough history to weight them yet. Fall
 *                          back to rule-only but tell the UI so it
 *                          can surface "blend pending more data".
 */
export type EnsembleReason =
  | "rule-only"
  | "shadow-only"
  | "blended"
  | "calibration-thin";

export interface EnsembleWinProbabilityResult {
  /** The final blended (or fallback) score, clamped [5, 95]. */
  ensembleScore: number;
  /** Rule's fractional weight in the ensemble [0, 1]. */
  ruleWeight: number;
  /** Shadow's fractional weight in the ensemble [0, 1]. */
  shadowWeight: number;
  /** Which branch of the decision tree produced the result. */
  reason: EnsembleReason;
  /**
   * One-sentence receipts — what inputs drove the weights, in a form
   * the rep can screenshot and defend. Null when there's nothing
   * informative to say (pure rule-only fallback without a shadow to
   * report on).
   */
  explanation: string | null;
  /**
   * True when the ensemble isn't confident enough to promote over the
   * rule score. The UI uses this to decide whether to render a
   * "consensus" pill or stay quiet.
   */
  lowConfidence: boolean;
}

/**
 * Minimum above-chance skill (accuracy - 0.5) for a model to earn any
 * ensemble weight. At exactly 0 skill the model is a coin-flip and we
 * don't want a coin-flip diluting a genuine signal, so it gets zero
 * weight. 0.01 is a deliberately low bar — we're not claiming a 51%
 * model is great, only that it's demonstrably above chance.
 */
export const MIN_SKILL_FOR_ENSEMBLE = 0.01;

/**
 * Same clamp the scorer applies — [5, 95] integer. Centralized so a
 * future change to the scorer's clamp propagates here.
 */
function clamp(score: number): number {
  if (!Number.isFinite(score)) return 50;
  return Math.max(5, Math.min(95, Math.round(score)));
}

/**
 * Compute a consensus win-probability score from the live rule score +
 * the shadow K-NN score, weighted by their demonstrated above-chance
 * accuracy on 20k's scorable subset.
 *
 * Decision tree:
 *
 *   1. No shadow, or shadow lowConfidence → rule-only.
 *   2. No calibration summary, or summary.lowConfidence → rule-only
 *      with `calibration-thin` reason (the UI can say "blend pending
 *      more data" rather than pretending the shadow doesn't exist).
 *   3. Both models below `MIN_SKILL_FOR_ENSEMBLE` above chance →
 *      rule-only. Blending a coin-flip into a coin-flip just gives you
 *      a coin-flip with more noise.
 *   4. Exactly one model above chance → that model's score wins
 *      outright (weight 1). Rare but handled.
 *   5. Both above chance → weights proportional to above-chance skill;
 *      ensembleScore = clamp(round(w_r*live + w_s*shadow)).
 */
export function computeEnsembleWinProbability(
  liveScore: number,
  shadow: ShadowScoreResult | null,
  summary: ShadowAgreementSummary | null,
): EnsembleWinProbabilityResult {
  const safeLive = clamp(liveScore);

  // Branch 1: no shadow to blend with.
  if (!shadow || shadow.lowConfidence) {
    return {
      ensembleScore: safeLive,
      ruleWeight: 1,
      shadowWeight: 0,
      reason: "rule-only",
      explanation: null,
      lowConfidence: true,
    };
  }

  const safeShadow = clamp(shadow.shadowScore);

  // Branch 2: no track record to weight by yet.
  if (
    !summary ||
    summary.lowConfidence ||
    summary.ruleAgreementRate === null ||
    summary.shadowAgreementRate === null
  ) {
    return {
      ensembleScore: safeLive,
      ruleWeight: 1,
      shadowWeight: 0,
      reason: "calibration-thin",
      explanation: `Shadow scored ${safeShadow} but we don't yet have enough closed deals to weight the blend — leaning on the rule score alone until calibration firms up.`,
      lowConfidence: true,
    };
  }

  const ruleSkill = Math.max(0, summary.ruleAgreementRate - 0.5);
  const shadowSkill = Math.max(0, summary.shadowAgreementRate - 0.5);
  const ruleQualifies = ruleSkill >= MIN_SKILL_FOR_ENSEMBLE;
  const shadowQualifies = shadowSkill >= MIN_SKILL_FOR_ENSEMBLE;

  const rulePct = Math.round(summary.ruleAgreementRate * 100);
  const shadowPct = Math.round(summary.shadowAgreementRate * 100);

  // Branch 3: neither model above chance.
  if (!ruleQualifies && !shadowQualifies) {
    return {
      ensembleScore: safeLive,
      ruleWeight: 1,
      shadowWeight: 0,
      reason: "rule-only",
      explanation: `Both models are at or below coin-flip accuracy on ${summary.scorableDeals} closed deals (rule ${rulePct}%, shadow ${shadowPct}%) — no blend earned, showing rule score alone.`,
      lowConfidence: true,
    };
  }

  // Branch 4: exactly one model above chance.
  if (ruleQualifies && !shadowQualifies) {
    return {
      ensembleScore: safeLive,
      ruleWeight: 1,
      shadowWeight: 0,
      reason: "rule-only",
      explanation: `Rule scorer is ${rulePct}% accurate vs. shadow's ${shadowPct}% across ${summary.scorableDeals} closed deals — shadow hasn't earned weight in the blend.`,
      lowConfidence: false,
    };
  }
  if (!ruleQualifies && shadowQualifies) {
    return {
      ensembleScore: safeShadow,
      ruleWeight: 0,
      shadowWeight: 1,
      reason: "shadow-only",
      explanation: `Shadow K-NN is ${shadowPct}% accurate vs. rule's ${rulePct}% across ${summary.scorableDeals} closed deals — leaning on shadow until the rule earns weight back.`,
      lowConfidence: false,
    };
  }

  // Branch 5: both above chance — skill-proportional blend.
  const totalSkill = ruleSkill + shadowSkill;
  const ruleWeight = ruleSkill / totalSkill;
  const shadowWeight = shadowSkill / totalSkill;
  const rawEnsemble = ruleWeight * safeLive + shadowWeight * safeShadow;
  const ensembleScore = clamp(rawEnsemble);

  const ruleWeightPct = Math.round(ruleWeight * 100);
  const shadowWeightPct = 100 - ruleWeightPct;
  const explanation = `Weighted ${ruleWeightPct}/${shadowWeightPct} rule/shadow based on historical accuracy (rule ${rulePct}%, shadow ${shadowPct}% across ${summary.scorableDeals} closed deals).`;

  return {
    ensembleScore,
    ruleWeight,
    shadowWeight,
    reason: "blended",
    explanation,
    lowConfidence: false,
  };
}

/**
 * Short headline for the ensemble pill — "Consensus 64" / "No consensus
 * yet" etc. Kept here so tests pin the copy and the component stays
 * presentation-only.
 */
export function describeEnsembleHeadline(
  result: EnsembleWinProbabilityResult,
): string {
  if (result.reason === "blended") {
    return `Consensus ${result.ensembleScore}`;
  }
  if (result.reason === "shadow-only") {
    return `Shadow-led ${result.ensembleScore}`;
  }
  if (result.reason === "calibration-thin") {
    return `Blend pending`;
  }
  return `Rule-led ${result.ensembleScore}`;
}
