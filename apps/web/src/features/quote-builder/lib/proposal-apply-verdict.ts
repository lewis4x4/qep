/**
 * Proposal Apply Verdict — Slice 20y.
 *
 * 20m–20x built a full evidence chain for the scorer-evolution
 * proposal: the proposal body, what-if Brier delta, calibration drift,
 * factor drift, urgency, a composed meta-confidence score, per-deal
 * call flips, and a clipboard-ready markdown ticket that carries all
 * of it. A manager looking at the card has every receipt they need.
 *
 * What they DON'T have is a verdict.
 *
 * The evidence cards answer:
 *   • Why now?       (urgency)
 *   • What moved?    (drift)
 *   • What to change? (proposal)
 *   • Would it help?  (what-if)
 *   • How sure?      (confidence)
 *   • Which deals?   (call flips)
 *
 * A thoughtful manager can read all that and arrive at "apply it" or
 * "hold off." But most managers aren't thoughtful — they're busy. The
 * evidence chain is the HONEST view; the verdict is the USABLE view.
 * Move-2 needs both: transparent under the hood, decisive at the top.
 *
 * This module composes every upstream signal into one of four
 * recommendations and a ranked list of the reasons that drove it:
 *
 *   • `apply`   — high confidence, net-positive flips, no regressions,
 *                 sample meets the bar. "Pull the trigger."
 *   • `review`  — passable but with warnings. Confidence medium, or
 *                 regressions present, or sample is thin. "Eyeball the
 *                 specific deals before applying."
 *   • `hold`    — critical failures. Confidence low, or net-negative
 *                 flips, or confidence is actively saying stop.
 *                 "Don't apply — gather more evidence first."
 *   • `defer`   — nothing to apply. No actionable changes, or no
 *                 proposal, or no what-if to validate against. This is
 *                 distinct from `hold` because there's no decision to
 *                 make, not a decision to say no.
 *
 * The reasons list is ordered by weight — the strongest positive or
 * negative signal first — so a reader can stop reading after the first
 * one and still have the gist.
 *
 * Move-2 relevance: commodity CRMs either hide the evidence and show
 * only the verdict ("the model says apply") or drown the user in
 * metrics and force them to verdict it themselves. QEP does both:
 * surfaces every receipt, THEN hands over the verdict. The honesty tax
 * is paid upstream; this slice just reads back the answer.
 *
 * Pure function — no I/O.
 */

import type { ScorerProposal } from "./scorer-proposal";
import type { ProposalConfidenceResult } from "./proposal-confidence";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
} from "./proposal-confidence";
import type { ProposalCallFlipReport } from "./proposal-call-flips";
import type { ScorerWhatIfResult } from "./scorer-what-if";
import type { ProposalUrgencyResult } from "./proposal-urgency";

export type ProposalVerdict = "apply" | "review" | "hold" | "defer";

/**
 * A structured reason for the verdict. `polarity` drives the UI
 * icon/color: positive → ✓, negative → ⚠, neutral → ·. `kind`
 * categorizes the source so the UI can weight or de-duplicate.
 */
export interface VerdictReason {
  kind:
    | "confidence"
    | "flips"
    | "sample"
    | "urgency"
    | "drift"
    | "what_if"
    | "actionable";
  polarity: "positive" | "negative" | "neutral";
  rationale: string;
}

export interface ProposalApplyVerdict {
  verdict: ProposalVerdict;
  /** One-sentence headline — the thing a manager reads first. */
  headline: string;
  /** Ranked strongest-first. UI renders as a bulleted list. Always
   *  non-empty except for the `defer` case where there's no decision
   *  to justify. */
  reasons: VerdictReason[];
}

export interface ProposalApplyVerdictInput {
  proposal: ScorerProposal | null;
  confidence: ProposalConfidenceResult | null;
  callFlips: ProposalCallFlipReport | null;
  whatIf: ScorerWhatIfResult | null;
  urgency: ProposalUrgencyResult | null;
}

/**
 * Compose the verdict from the full evidence chain. Priority:
 *   1. defer  — nothing actionable
 *   2. hold   — low confidence OR net-negative flips
 *   3. review — any warning (regressing > 0, medium confidence,
 *               dampened, thin what-if sample)
 *   4. apply  — everything green
 *
 * Order matters — a deal with one regressing flip AND low confidence
 * should land in `hold`, not `review`, because the low confidence is
 * the decisive signal.
 */
export function computeProposalApplyVerdict(
  input: ProposalApplyVerdictInput,
): ProposalApplyVerdict {
  const { proposal, confidence, callFlips, whatIf, urgency } = input;

  // ── Step 1: defer — nothing to apply. ─────────────────────────────
  if (!proposal) {
    return {
      verdict: "defer",
      headline: "No proposal available.",
      reasons: [],
    };
  }

  const actionable = proposal.changes.filter((c) => c.action !== "keep").length;
  if (actionable === 0) {
    return {
      verdict: "defer",
      headline: "No actionable changes — nothing to apply.",
      reasons: [
        {
          kind: "actionable",
          polarity: "neutral",
          rationale:
            "The proposal has no actionable changes — the scorer is already aligned with observed outcomes.",
        },
      ],
    };
  }

  const reasons: VerdictReason[] = [];
  let hold = false;
  let review = false;

  // ── Step 2: confidence signals. ───────────────────────────────────
  if (confidence) {
    if (confidence.confidence < MEDIUM_CONFIDENCE_THRESHOLD) {
      hold = true;
      reasons.push({
        kind: "confidence",
        polarity: "negative",
        rationale: `Meta-confidence is ${confidence.confidence}/100 (LOW band) — signals don't yet support applying.`,
      });
    } else if (confidence.confidence < HIGH_CONFIDENCE_THRESHOLD) {
      review = true;
      reasons.push({
        kind: "confidence",
        polarity: "neutral",
        rationale: `Meta-confidence is ${confidence.confidence}/100 (MEDIUM band) — evidence is suggestive, not decisive.`,
      });
    } else {
      reasons.push({
        kind: "confidence",
        polarity: "positive",
        rationale: `Meta-confidence is ${confidence.confidence}/100 (HIGH band) — signals align.`,
      });
    }
    if (confidence.dampenedByThinSample) {
      review = true;
      reasons.push({
        kind: "sample",
        polarity: "negative",
        rationale:
          "Confidence was dampened because the attribution sample is thin — treat as directional.",
      });
    }
  } else {
    // No confidence result at all — we can't vouch for the proposal.
    review = true;
    reasons.push({
      kind: "confidence",
      polarity: "neutral",
      rationale:
        "No confidence score available — can't independently vouch for the proposal's signal quality.",
    });
  }

  // ── Step 3: call-flip signals. ────────────────────────────────────
  if (callFlips && !callFlips.empty && !callFlips.noActionableChanges) {
    if (callFlips.netImprovement < 0) {
      hold = true;
      reasons.push({
        kind: "flips",
        polarity: "negative",
        rationale: `${callFlips.regressing.length} deals would regress vs. ${callFlips.corroborating.length} that would corroborate — net ${callFlips.netImprovement} against correctness.`,
      });
    } else if (callFlips.regressing.length > 0) {
      review = true;
      reasons.push({
        kind: "flips",
        polarity: "negative",
        rationale: `${callFlips.regressing.length} deal${callFlips.regressing.length === 1 ? "" : "s"} would regress — review the specific flips before applying.`,
      });
      if (callFlips.corroborating.length > 0) {
        reasons.push({
          kind: "flips",
          polarity: "positive",
          rationale: `${callFlips.corroborating.length} corroborating flip${callFlips.corroborating.length === 1 ? "" : "s"} offset the regression risk partially.`,
        });
      }
    } else if (callFlips.corroborating.length > 0) {
      reasons.push({
        kind: "flips",
        polarity: "positive",
        rationale: `${callFlips.corroborating.length} call${callFlips.corroborating.length === 1 ? "" : "s"} would flip toward the right answer, none in the wrong direction.`,
      });
    } else {
      // Zero flips, no regressions — refinement only.
      reasons.push({
        kind: "flips",
        polarity: "neutral",
        rationale:
          "No calls would flip — the proposal refines scores without changing verdicts.",
      });
    }
    if (callFlips.lowConfidence) {
      review = true;
      reasons.push({
        kind: "sample",
        polarity: "negative",
        rationale:
          "Call-flip evidence is thin — the sample size limits how much weight to give the per-deal signal.",
      });
    }
  }

  // ── Step 4: what-if signals. ──────────────────────────────────────
  if (whatIf && !whatIf.noActionableChanges && whatIf.dealsSimulated > 0) {
    if (whatIf.brierDelta !== null && whatIf.brierDelta > 0) {
      // Brier got worse.
      hold = true;
      reasons.push({
        kind: "what_if",
        polarity: "negative",
        rationale: `Simulated Brier regresses by ${whatIf.brierDelta.toFixed(3)} on ${whatIf.dealsSimulated} closed deal${whatIf.dealsSimulated === 1 ? "" : "s"} — the proposal makes the scorer less accurate.`,
      });
    } else if (whatIf.brierDelta !== null && whatIf.brierDelta < 0) {
      reasons.push({
        kind: "what_if",
        polarity: "positive",
        rationale: `Simulated Brier improves by ${Math.abs(whatIf.brierDelta).toFixed(3)} on ${whatIf.dealsSimulated} closed deal${whatIf.dealsSimulated === 1 ? "" : "s"}.`,
      });
    }
    if (whatIf.lowConfidence) {
      review = true;
      reasons.push({
        kind: "sample",
        polarity: "negative",
        rationale: `What-if sample is ${whatIf.dealsSimulated} deal${whatIf.dealsSimulated === 1 ? "" : "s"} — below the ${5} threshold for anything more than directional confidence.`,
      });
    }
  } else if (!whatIf || whatIf.dealsSimulated === 0) {
    // No what-if at all — can't validate improvement.
    review = true;
    reasons.push({
      kind: "what_if",
      polarity: "neutral",
      rationale:
        "No what-if simulation available — can't independently confirm the proposal would improve accuracy.",
    });
  }

  // ── Step 5: urgency as a tiebreaker. ──────────────────────────────
  if (urgency && urgency.urgency === "high" && urgency.rationale) {
    reasons.push({
      kind: "urgency",
      polarity: "negative",
      rationale: `Urgency is HIGH: ${urgency.rationale}`,
    });
  }

  // Rank reasons: positive signals first when verdict is apply;
  // negative signals first otherwise. Within each polarity preserve
  // insertion order (which reflects our step priority).
  const verdict: ProposalVerdict = hold ? "hold" : review ? "review" : "apply";
  const rankedReasons = rankReasons(reasons, verdict);

  return {
    verdict,
    headline: composeHeadline(verdict, rankedReasons, {
      confidence,
      callFlips,
      whatIf,
    }),
    reasons: rankedReasons,
  };
}

/**
 * Rank reasons by polarity for the verdict — negatives first for
 * hold/review (the blockers), positives first for apply (the
 * supports). Neutrals always last.
 */
function rankReasons(
  reasons: VerdictReason[],
  verdict: ProposalVerdict,
): VerdictReason[] {
  const polarityOrder =
    verdict === "apply"
      ? { positive: 0, negative: 1, neutral: 2 }
      : { negative: 0, positive: 1, neutral: 2 };
  // Stable sort — preserve insertion order within same polarity.
  const withIdx = reasons.map((r, i) => ({ r, i }));
  withIdx.sort((a, b) => {
    const pa = polarityOrder[a.r.polarity];
    const pb = polarityOrder[b.r.polarity];
    if (pa !== pb) return pa - pb;
    return a.i - b.i;
  });
  return withIdx.map((x) => x.r);
}

/**
 * Pinned headline copy per verdict. The headline is the one-liner a
 * busy manager will read, so it must be actionable and specific.
 */
function composeHeadline(
  verdict: ProposalVerdict,
  reasons: VerdictReason[],
  ctx: {
    confidence: ProposalConfidenceResult | null;
    callFlips: ProposalCallFlipReport | null;
    whatIf: ScorerWhatIfResult | null;
  },
): string {
  if (verdict === "apply") {
    const pieces: string[] = [];
    if (ctx.confidence) pieces.push(`confidence ${ctx.confidence.confidence}/100`);
    if (
      ctx.callFlips &&
      !ctx.callFlips.empty &&
      !ctx.callFlips.noActionableChanges
    ) {
      if (ctx.callFlips.corroborating.length > 0) {
        pieces.push(
          `${ctx.callFlips.corroborating.length} corroborating flip${ctx.callFlips.corroborating.length === 1 ? "" : "s"}`,
        );
      } else if (ctx.callFlips.totalFlips === 0) {
        pieces.push("refinement only");
      }
    }
    if (
      ctx.whatIf &&
      ctx.whatIf.brierDelta !== null &&
      ctx.whatIf.brierDelta < 0
    ) {
      pieces.push(`Brier −${Math.abs(ctx.whatIf.brierDelta).toFixed(3)}`);
    }
    const suffix = pieces.length > 0 ? ` (${pieces.join(", ")})` : "";
    return `Apply — evidence is aligned${suffix}.`;
  }
  if (verdict === "review") {
    // Surface the first negative reason if any, else the first
    // neutral — the manager wants to know WHY they're being asked to
    // review.
    const first =
      reasons.find((r) => r.polarity === "negative") ??
      reasons.find((r) => r.polarity === "neutral");
    return first
      ? `Review before applying — ${firstSentence(first.rationale).toLowerCase()}`
      : "Review before applying.";
  }
  if (verdict === "hold") {
    const first = reasons.find((r) => r.polarity === "negative");
    return first
      ? `Hold — ${firstSentence(first.rationale).toLowerCase()}`
      : "Hold — evidence doesn't support applying.";
  }
  // defer
  return "No actionable changes — nothing to apply.";
}

/** Slice the rationale at its first sentence for headline embedding. */
function firstSentence(s: string): string {
  const m = s.match(/^[^.!?]+[.!?]?/);
  return (m ? m[0] : s).trim();
}

/** Pinned pill copy per verdict. */
export function describeProposalVerdictPill(v: ProposalVerdict): string {
  switch (v) {
    case "apply":
      return "✓ APPLY";
    case "review":
      return "⚠ REVIEW";
    case "hold":
      return "✗ HOLD";
    case "defer":
      return "— DEFER";
  }
}
