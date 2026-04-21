/**
 * Shadow Disagreement Callout — Slice 20l.
 *
 * 20j introduced the live shadow score. 20k proved whether managers
 * should trust it aggregate-wide. 20l closes the loop on individual
 * live deals: when the shadow meaningfully disagrees with the rule
 * score AND the measured disagreement-win-rate says the shadow has
 * earned the right to speak up, we promote the signal from a passive
 * chip to a first-class callout.
 *
 * Design philosophy (every callout library should earn its screen
 * real estate, especially in a rep-facing surface):
 *
 *   • **Delta gate first, trust gate second.** Small disagreements
 *     (±10 or less) are already handled by the shadow chip's colored
 *     border; we only promote a callout when |delta| ≥ 15. Below that,
 *     the chip alone is the honest UI.
 *   • **Tone driven by measured evidence.** If the shadow has won
 *     ≥60% of historical disagreements, the callout speaks with
 *     confidence ("worth a second look"). If it's won 40–60%, the
 *     callout is neutral ("two systems disagree"). If <40%, we
 *     suppress entirely — raising a flag we know to be usually-wrong
 *     would train reps to ignore the signal entirely.
 *   • **Low-confidence suppresses the callout.** When 20k's
 *     summary.lowConfidence is true (thin calibration data), the
 *     shadow's track record is too small to justify escalating its
 *     voice. The chip still renders; the callout does not.
 *   • **Explicit direction.** We say "similar deals won MORE often"
 *     or "LESS often" than the rules suggest — never just "there's a
 *     disagreement". A signal without direction is noise.
 *
 * Pure functions — no I/O. The live scorer produces `liveScore`, the
 * shadow engine produces `shadow`, and the retrospective engine
 * (20k) produces `calibration`. This module reads all three and
 * answers a single question: "should the strip shout?".
 */

import type { ShadowScoreResult } from "./shadow-score";
import type { ShadowAgreementSummary } from "./retrospective-shadow";

/**
 * Minimum |shadow − live| before we even *consider* promoting a
 * callout. Matches the threshold the ShadowChip uses to flip from
 * neutral to amber border — callers who want a looser / tighter
 * cutoff can override via opts.
 */
export const CALLOUT_DELTA_THRESHOLD = 15;

/**
 * Tone-selection thresholds on shadow disagreement-win-rate. Below
 * STRONG_RATE we don't speak confidently; below SUPPRESS_RATE we
 * don't speak at all. Documented as constants because a PR that
 * changes them is worth the review friction.
 */
export const STRONG_DISAGREEMENT_RATE = 0.6;
export const SUPPRESS_DISAGREEMENT_RATE = 0.4;

export type ShadowCalloutTone = "strong" | "neutral";

export type ShadowCalloutDirection = "higher" | "lower";

export interface ShadowCallout {
  /** Tone guides the strip's background + icon color. */
  tone: ShadowCalloutTone;
  /**
   * Which way the shadow is pulling. `higher` = similar historical
   * deals won more often than the rules suggest; `lower` = less.
   */
  direction: ShadowCalloutDirection;
  /** |shadow.shadowScore − liveScore|, pre-rounded. */
  deltaPts: number;
  /** Short, rep-friendly sentence; safe to render directly. */
  headline: string;
  /**
   * One-liner citing the measured disagreement record so the rep
   * understands *why* we're escalating. Example: "Shadow has won 7 of
   * 10 disagreements with the rule scorer historically."
   */
  evidence: string;
}

export interface ShadowCalloutOptions {
  deltaThreshold?: number;
  strongRate?: number;
  suppressRate?: number;
}

/**
 * Main entry point. Returns `null` when we've decided not to promote
 * a callout — the strip should render nothing extra.
 */
export function computeShadowCallout(
  liveScore: number,
  shadow: ShadowScoreResult | null,
  calibration: ShadowAgreementSummary | null,
  opts: ShadowCalloutOptions = {},
): ShadowCallout | null {
  const deltaThreshold = opts.deltaThreshold ?? CALLOUT_DELTA_THRESHOLD;
  const strongRate = opts.strongRate ?? STRONG_DISAGREEMENT_RATE;
  const suppressRate = opts.suppressRate ?? SUPPRESS_DISAGREEMENT_RATE;

  // Missing data: caller didn't pass shadow, or shadow is self-flagged
  // low-confidence (sparse sample / distant neighbors). Either way we
  // don't speak.
  if (!shadow || shadow.lowConfidence) return null;

  // Not enough calibration evidence. We could still speak cautiously
  // from delta alone, but the whole point of this slice is "promote
  // only when the shadow has earned a voice" — so without calibration
  // we stay silent and let the chip carry the signal.
  if (!calibration || calibration.lowConfidence) return null;

  // Nothing to escalate when rule + shadow are within the chip's
  // natural range.
  const signedDelta = Math.round(shadow.shadowScore - liveScore);
  const absDelta = Math.abs(signedDelta);
  if (absDelta < deltaThreshold) return null;

  // If we've never actually observed them disagreeing in the
  // calibration window, we have no track record to stand on. This
  // mirrors the "every call agreed" copy in describeShadowTrustHeadline.
  const rate = calibration.shadowDisagreementWinRate;
  if (rate === null) return null;

  // Suppression rule: shadow has a LOSING track record on
  // disagreements, so promoting its disagreement on this deal would
  // push the rep toward the wrong signal more than half the time.
  if (rate < suppressRate) return null;

  const tone: ShadowCalloutTone = rate >= strongRate ? "strong" : "neutral";
  const direction: ShadowCalloutDirection = signedDelta > 0 ? "higher" : "lower";

  const comparison = direction === "higher" ? "more often" : "less often";
  const headline =
    tone === "strong"
      ? `Similar closed deals have won ${comparison} than the live score suggests (Δ ${absDelta} pts).`
      : `Shadow reads ${absDelta} pts ${direction === "higher" ? "higher" : "lower"} — two systems disagree, worth a look.`;

  const pct = Math.round(rate * 100);
  const evidence = `Shadow has won ${calibration.shadowWonDisagreementCount} of ${calibration.disagreementCount} historical disagreements with the rule scorer (${pct}%).`;

  return {
    tone,
    direction,
    deltaPts: absDelta,
    headline,
    evidence,
  };
}
