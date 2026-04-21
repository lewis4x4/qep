/**
 * Proposal Apply Verdict tests — Slice 20y.
 *
 * Verdict priority (defer > hold > review > apply) pinned across
 * every branch. Headline copy strings pinned verbatim because they're
 * the actual text a manager reads; if we change them we want the test
 * to fail loudly, not silently.
 */

import { describe, expect, test } from "bun:test";
import {
  computeProposalApplyVerdict,
  describeProposalVerdictPill,
  type ProposalApplyVerdictInput,
} from "../proposal-apply-verdict";
import type { ScorerProposal } from "../scorer-proposal";
import type { ProposalConfidenceResult } from "../proposal-confidence";
import type { ProposalCallFlipReport } from "../proposal-call-flips";
import type { ScorerWhatIfResult } from "../scorer-what-if";
import type { ProposalUrgencyResult } from "../proposal-urgency";

// ── Fixture factories ─────────────────────────────────────────────────

function proposalOf(
  overrides: Partial<ScorerProposal> = {},
): ScorerProposal {
  return {
    headline: "Scorer evolution proposal",
    changes: [
      {
        label: "Vertical: Construction",
        action: "strengthen",
        rationale: "Construction deals win 72% vs 54% baseline.",
        lift: 0.18,
        observations: 22,
      },
    ],
    shadowCorroboration: null,
    lowConfidence: false,
    ...overrides,
  };
}

function confidenceOf(
  overrides: Partial<ProposalConfidenceResult> = {},
): ProposalConfidenceResult {
  return {
    confidence: 75,
    band: "high",
    drivers: [],
    rationale: "Signals align.",
    dampenedByThinSample: false,
    ...overrides,
  };
}

function callFlipsOf(
  overrides: Partial<ProposalCallFlipReport> = {},
): ProposalCallFlipReport {
  return {
    corroborating: [],
    regressing: [],
    alignedUnchangedCount: 0,
    misalignedUnchangedCount: 0,
    expiredCount: 0,
    resolvedCount: 0,
    netImprovement: 0,
    totalFlips: 0,
    lowConfidence: false,
    empty: false,
    noActionableChanges: false,
    ...overrides,
  };
}

function whatIfOf(
  overrides: Partial<ScorerWhatIfResult> = {},
): ScorerWhatIfResult {
  return {
    dealsSimulated: 30,
    currentBrier: 0.25,
    simulatedBrier: 0.22,
    brierDelta: -0.03,
    currentHitRate: 0.6,
    simulatedHitRate: 0.68,
    hitRateDelta: 0.08,
    perDeal: [],
    lowConfidence: false,
    noActionableChanges: false,
    ...overrides,
  };
}

function urgencyOf(
  overrides: Partial<ProposalUrgencyResult> = {},
): ProposalUrgencyResult {
  return { urgency: "medium", rationale: null, ...overrides };
}

function baseGreenInput(): ProposalApplyVerdictInput {
  return {
    proposal: proposalOf(),
    confidence: confidenceOf(),
    callFlips: callFlipsOf({
      corroborating: [
        {
          packageId: "a",
          outcome: "won",
          previousCall: "miss",
          proposedCall: "win",
          previous: 40,
          proposed: 70,
          delta: 30,
          kind: "corroborating",
        },
      ],
      netImprovement: 1,
      totalFlips: 1,
      resolvedCount: 1,
    }),
    whatIf: whatIfOf(),
    urgency: urgencyOf(),
  };
}

// ── defer: nothing to apply ───────────────────────────────────────────

describe("computeProposalApplyVerdict — defer", () => {
  test("proposal=null → defer, empty reasons, pinned headline", () => {
    const r = computeProposalApplyVerdict({
      proposal: null,
      confidence: null,
      callFlips: null,
      whatIf: null,
      urgency: null,
    });
    expect(r.verdict).toBe("defer");
    expect(r.headline).toBe("No proposal available.");
    expect(r.reasons).toEqual([]);
  });

  test("proposal with all 'keep' changes → defer", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      proposal: proposalOf({
        changes: [
          { label: "f1", action: "keep", rationale: "ok", lift: 0, observations: 10 },
          { label: "f2", action: "keep", rationale: "ok", lift: 0, observations: 10 },
        ],
      }),
    });
    expect(r.verdict).toBe("defer");
    expect(r.headline).toBe("No actionable changes — nothing to apply.");
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe("actionable");
  });

  test("proposal with empty changes array → defer", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      proposal: proposalOf({ changes: [] }),
    });
    expect(r.verdict).toBe("defer");
  });
});

// ── hold: critical failures ───────────────────────────────────────────

describe("computeProposalApplyVerdict — hold", () => {
  test("LOW confidence (< 45) → hold, headline cites confidence", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      confidence: confidenceOf({ confidence: 30, band: "low" }),
    });
    expect(r.verdict).toBe("hold");
    expect(r.headline.startsWith("Hold — ")).toBe(true);
    expect(r.headline.toLowerCase()).toContain("meta-confidence is 30/100");
  });

  test("net-negative call flips → hold", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      callFlips: callFlipsOf({
        corroborating: [],
        regressing: [
          {
            packageId: "r1",
            outcome: "won",
            previousCall: "win",
            proposedCall: "miss",
            previous: 62,
            proposed: 40,
            delta: -22,
            kind: "regressing",
          },
        ],
        netImprovement: -1,
        totalFlips: 1,
        resolvedCount: 1,
      }),
    });
    expect(r.verdict).toBe("hold");
    const negs = r.reasons.filter((rr) => rr.polarity === "negative");
    expect(negs.length).toBeGreaterThanOrEqual(1);
    expect(negs[0].kind).toBe("flips");
  });

  test("simulated Brier regresses (> 0) → hold, cites what_if", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      whatIf: whatIfOf({
        currentBrier: 0.2,
        simulatedBrier: 0.24,
        brierDelta: 0.04,
      }),
    });
    expect(r.verdict).toBe("hold");
    const whatIf = r.reasons.find((rr) => rr.kind === "what_if");
    expect(whatIf?.polarity).toBe("negative");
    expect(whatIf?.rationale).toContain("regresses by 0.040");
  });

  test("hold dominates review — LOW confidence + regressing flips still = hold", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      confidence: confidenceOf({ confidence: 20, band: "low" }),
      callFlips: callFlipsOf({
        regressing: [
          {
            packageId: "r",
            outcome: "won",
            previousCall: "win",
            proposedCall: "miss",
            previous: 60,
            proposed: 40,
            delta: -20,
            kind: "regressing",
          },
        ],
        corroborating: [
          {
            packageId: "c",
            outcome: "won",
            previousCall: "miss",
            proposedCall: "win",
            previous: 40,
            proposed: 60,
            delta: 20,
            kind: "corroborating",
          },
        ],
        netImprovement: 0,
        totalFlips: 2,
        resolvedCount: 2,
      }),
    });
    expect(r.verdict).toBe("hold");
  });
});

// ── review: passable but with warnings ────────────────────────────────

describe("computeProposalApplyVerdict — review", () => {
  test("MEDIUM confidence (45-69) → review", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      confidence: confidenceOf({ confidence: 55, band: "medium" }),
    });
    expect(r.verdict).toBe("review");
    expect(r.headline.startsWith("Review before applying — ")).toBe(true);
  });

  test("HIGH confidence but one regressing flip → review", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      callFlips: callFlipsOf({
        corroborating: [
          {
            packageId: "c",
            outcome: "won",
            previousCall: "miss",
            proposedCall: "win",
            previous: 40,
            proposed: 70,
            delta: 30,
            kind: "corroborating",
          },
          {
            packageId: "c2",
            outcome: "won",
            previousCall: "miss",
            proposedCall: "win",
            previous: 42,
            proposed: 65,
            delta: 23,
            kind: "corroborating",
          },
        ],
        regressing: [
          {
            packageId: "r",
            outcome: "won",
            previousCall: "win",
            proposedCall: "miss",
            previous: 60,
            proposed: 40,
            delta: -20,
            kind: "regressing",
          },
        ],
        netImprovement: 1, // still positive
        totalFlips: 3,
        resolvedCount: 3,
      }),
    });
    expect(r.verdict).toBe("review");
    // Negative reason (regression) ranked first for review verdict.
    expect(r.reasons[0].polarity).toBe("negative");
    expect(r.reasons[0].kind).toBe("flips");
  });

  test("dampened confidence → review even at HIGH", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      confidence: confidenceOf({
        confidence: 82,
        band: "high",
        dampenedByThinSample: true,
      }),
    });
    expect(r.verdict).toBe("review");
    const sample = r.reasons.find((rr) => rr.kind === "sample");
    expect(sample?.polarity).toBe("negative");
    expect(sample?.rationale).toContain("thin");
  });

  test("low-confidence what-if (< 5 deals) → review", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      whatIf: whatIfOf({
        dealsSimulated: 3,
        lowConfidence: true,
      }),
    });
    expect(r.verdict).toBe("review");
    const sample = r.reasons.find(
      (rr) => rr.kind === "sample" && rr.rationale.includes("What-if sample"),
    );
    expect(sample?.rationale).toContain("3 deals");
  });

  test("no what-if at all → review (can't verify improvement)", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      whatIf: null,
    });
    expect(r.verdict).toBe("review");
    const wi = r.reasons.find((rr) => rr.kind === "what_if");
    expect(wi?.polarity).toBe("neutral");
  });

  test("no confidence at all → review (can't vouch for proposal)", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      confidence: null,
    });
    expect(r.verdict).toBe("review");
    const c = r.reasons.find((rr) => rr.kind === "confidence");
    expect(c?.polarity).toBe("neutral");
    expect(c?.rationale).toContain("independently vouch");
  });

  test("low-confidence call flips → review", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      callFlips: callFlipsOf({
        corroborating: [
          {
            packageId: "c",
            outcome: "won",
            previousCall: "miss",
            proposedCall: "win",
            previous: 40,
            proposed: 70,
            delta: 30,
            kind: "corroborating",
          },
        ],
        netImprovement: 1,
        totalFlips: 1,
        resolvedCount: 1,
        lowConfidence: true,
      }),
    });
    expect(r.verdict).toBe("review");
  });
});

// ── apply: all green ─────────────────────────────────────────────────

describe("computeProposalApplyVerdict — apply", () => {
  test("all signals green → apply, headline lists supports", () => {
    const r = computeProposalApplyVerdict(baseGreenInput());
    expect(r.verdict).toBe("apply");
    expect(r.headline.startsWith("Apply — evidence is aligned")).toBe(true);
    expect(r.headline).toContain("confidence 75/100");
    expect(r.headline).toContain("1 corroborating flip");
    expect(r.headline).toContain("Brier −0.030");
  });

  test("apply ranks positive reasons first", () => {
    const r = computeProposalApplyVerdict(baseGreenInput());
    expect(r.verdict).toBe("apply");
    expect(r.reasons[0].polarity).toBe("positive");
  });

  test("zero-flip refinement on HIGH confidence + improving Brier → apply", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      callFlips: callFlipsOf({
        alignedUnchangedCount: 8,
        resolvedCount: 8,
        netImprovement: 0,
        totalFlips: 0,
      }),
    });
    expect(r.verdict).toBe("apply");
    expect(r.headline).toContain("refinement only");
    const flips = r.reasons.find((rr) => rr.kind === "flips");
    expect(flips?.polarity).toBe("neutral");
  });

  test("high urgency is surfaced as a negative signal but doesn't flip verdict", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      urgency: urgencyOf({
        urgency: "high",
        rationale: "Hit rate dropped 12pp in the last 30 days.",
      }),
    });
    expect(r.verdict).toBe("apply");
    const urg = r.reasons.find((rr) => rr.kind === "urgency");
    expect(urg?.polarity).toBe("negative");
    expect(urg?.rationale).toContain("Hit rate dropped 12pp");
  });

  test("apply headline omits missing what-if delta cleanly", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      whatIf: whatIfOf({
        currentBrier: 0.22,
        simulatedBrier: 0.22,
        brierDelta: 0, // no change
      }),
    });
    // Brier 0 change means no positive what-if reason is pushed,
    // but also no regression. Green elsewhere → apply.
    expect(r.verdict).toBe("apply");
    expect(r.headline).not.toContain("Brier −");
  });
});

// ── Edge + coverage ─────────────────────────────────────────────────

describe("computeProposalApplyVerdict — edge cases", () => {
  test("empty call-flip report (empty=true) is skipped, not a negative signal", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      callFlips: callFlipsOf({ empty: true }),
    });
    // Still apply — all other signals green.
    expect(r.verdict).toBe("apply");
    const flips = r.reasons.find((rr) => rr.kind === "flips");
    expect(flips).toBeUndefined();
  });

  test("boundary: confidence exactly at MEDIUM_CONFIDENCE_THRESHOLD (45) → review", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      confidence: confidenceOf({ confidence: 45, band: "medium" }),
    });
    expect(r.verdict).toBe("review");
  });

  test("boundary: confidence exactly at HIGH_CONFIDENCE_THRESHOLD (70) → apply", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      confidence: confidenceOf({ confidence: 70, band: "high" }),
    });
    expect(r.verdict).toBe("apply");
  });

  test("boundary: confidence at 44 → hold (below MEDIUM threshold)", () => {
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      confidence: confidenceOf({ confidence: 44, band: "low" }),
    });
    expect(r.verdict).toBe("hold");
  });

  test("noActionableChanges call-flip report is skipped (defer path uses proposal actionable count)", () => {
    // A well-behaved caller won't emit a callFlips report with
    // noActionableChanges=true when the proposal itself has changes,
    // but we guard anyway.
    const r = computeProposalApplyVerdict({
      ...baseGreenInput(),
      callFlips: callFlipsOf({ noActionableChanges: true }),
    });
    // Still apply — flips are skipped rather than counted against.
    expect(r.verdict).toBe("apply");
  });
});

// ── Pill copy ───────────────────────────────────────────────────────

describe("describeProposalVerdictPill", () => {
  test("pinned copy per verdict", () => {
    expect(describeProposalVerdictPill("apply")).toBe("✓ APPLY");
    expect(describeProposalVerdictPill("review")).toBe("⚠ REVIEW");
    expect(describeProposalVerdictPill("hold")).toBe("✗ HOLD");
    expect(describeProposalVerdictPill("defer")).toBe("— DEFER");
  });
});
