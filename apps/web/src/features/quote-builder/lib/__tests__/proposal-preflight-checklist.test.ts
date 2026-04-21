/**
 * Proposal Pre-Apply Checklist tests — Slice 20ac.
 *
 * Behaviour this test pins:
 *
 *   • Empty / null proposal → empty checklist
 *   • All-keep proposal → empty checklist (nothing to pre-flight)
 *   • Seven check rows emitted in stable order (sample, confidence,
 *     verdict, stability, what_if, call_flips, calibration_trend)
 *   • Each check emits pass/warn/fail/skipped based on its input
 *   • Readiness derivation: failCount>0 → hold; warnCount≥2 → review;
 *     else ready. Skipped never contributes to readiness.
 *   • Headline copy pinned ("Ready to apply —" / "Review recommended —"
 *     / "Not ready —" + counts)
 *   • Pill copy + tone pinned for each readiness band
 *   • Determinism: same input → same output
 */

import { describe, expect, test } from "bun:test";
import {
  CONFIDENCE_PASS_THRESHOLD,
  CONFIDENCE_WARN_THRESHOLD,
  SAMPLE_PASS_THRESHOLD,
  computeProposalPreflightChecklist,
  describeReadinessPill,
  type PreflightInput,
} from "../proposal-preflight-checklist";
import type {
  ScorerFactorChange,
  ScorerProposal,
} from "../scorer-proposal";
import type { ProposalConfidenceResult } from "../proposal-confidence";
import type { ProposalApplyVerdict } from "../proposal-apply-verdict";
import type {
  ChangeStability,
  ProposalStabilityReport,
} from "../proposal-stability";
import type { ScorerWhatIfResult } from "../scorer-what-if";
import type { ProposalCallFlipReport } from "../proposal-call-flips";
import type { CalibrationDriftReport } from "../calibration-drift";

// ---------------------------------------------------------------------------
// Builders — keep tests concise + signal-over-noise.
// ---------------------------------------------------------------------------

function change(overrides: Partial<ScorerFactorChange>): ScorerFactorChange {
  return {
    label: "F",
    currentAvgWeight: 5,
    lift: 0.3,
    present: 20,
    absent: 20,
    action: "strengthen",
    rationale: "test",
    ...overrides,
  };
}

function proposalFrom(changes: ScorerFactorChange[]): ScorerProposal {
  return {
    headline: "",
    changes,
    shadowCorroboration: null,
    lowConfidence: false,
  };
}

function confidenceAt(score: number): ProposalConfidenceResult {
  const band: ProposalConfidenceResult["band"] =
    score >= CONFIDENCE_PASS_THRESHOLD
      ? "high"
      : score >= CONFIDENCE_WARN_THRESHOLD
        ? "medium"
        : "low";
  return {
    confidence: score,
    band,
    drivers: [],
    rationale: "",
  };
}

function verdictAt(
  v: ProposalApplyVerdict["verdict"],
): ProposalApplyVerdict {
  return { verdict: v, headline: "", reasons: [] };
}

function stabilityReport(
  overrides: Partial<ProposalStabilityReport> = {},
): ProposalStabilityReport {
  const changes: ChangeStability[] = overrides.changes ?? [];
  return {
    changes,
    meanStability: 0.9,
    rating: "stable",
    headline: "",
    empty: false,
    ...overrides,
  };
}

function whatIfAt(
  brierDelta: number,
  overrides: Partial<ScorerWhatIfResult> = {},
): ScorerWhatIfResult {
  return {
    dealsSimulated: 25,
    currentBrier: 0.2,
    simulatedBrier: 0.2 + brierDelta,
    brierDelta,
    currentHitRate: 0.6,
    simulatedHitRate: 0.62,
    hitRateDelta: 0.02,
    perDeal: [],
    lowConfidence: false,
    noActionableChanges: false,
    ...overrides,
  };
}

function callFlipsAt(
  corr: number,
  reg: number,
  overrides: Partial<ProposalCallFlipReport> = {},
): ProposalCallFlipReport {
  const mk = (n: number, kind: "corroborating" | "regressing") =>
    Array.from({ length: n }, (_, i) => ({
      packageId: `${kind}-${i}`,
      customerName: `c${i}`,
      kind,
      prediction: {
        beforeScore: 50,
        afterScore: 50,
        beforeCall: "win" as const,
        afterCall: "lose" as const,
      },
      outcome: "won" as const,
      rationale: "",
    }));
  return {
    // biome-ignore lint: test fixture intentionally loose
    corroborating: mk(corr, "corroborating") as any,
    // biome-ignore lint: test fixture intentionally loose
    regressing: mk(reg, "regressing") as any,
    totalDeals: corr + reg,
    flipDeals: corr + reg,
    refinementDeals: 0,
    netPositive: corr - reg,
    headline: "",
    lowConfidence: false,
    empty: false,
    noActionableChanges: false,
    ...overrides,
  };
}

function calibrationAt(
  direction: CalibrationDriftReport["direction"],
  overrides: Partial<CalibrationDriftReport> = {},
): CalibrationDriftReport {
  return {
    referenceDate: "2026-04-20T00:00:00Z",
    windowDays: 30,
    recentN: 20,
    priorN: 20,
    recentAccuracy: 0.6,
    priorAccuracy: 0.6,
    accuracyDelta: 0,
    recentBrier: 0.2,
    priorBrier: 0.2,
    brierDelta: 0,
    direction,
    lowConfidence: false,
    ...overrides,
  };
}

function inputFrom(overrides: Partial<PreflightInput>): PreflightInput {
  return {
    proposal: proposalFrom([change({ action: "strengthen" })]),
    confidence: confidenceAt(80),
    verdict: verdictAt("apply"),
    stability: stabilityReport(),
    whatIf: whatIfAt(-0.01),
    callFlips: callFlipsAt(3, 1),
    calibrationDrift: calibrationAt("improving"),
    dealsAnalyzed: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeProposalPreflightChecklist — empty cases", () => {
  test("null proposal → empty checklist", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ proposal: null }),
    );
    expect(r.empty).toBe(true);
    expect(r.items).toEqual([]);
    expect(r.headline).toBeNull();
  });

  test("empty changes → empty checklist", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ proposal: proposalFrom([]) }),
    );
    expect(r.empty).toBe(true);
  });

  test("all-keep proposal → empty checklist", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        proposal: proposalFrom([
          change({ label: "A", action: "keep" }),
          change({ label: "B", action: "keep" }),
        ]),
      }),
    );
    expect(r.empty).toBe(true);
  });
});

describe("computeProposalPreflightChecklist — row structure", () => {
  test("actionable proposal → exactly 7 rows in stable order", () => {
    const r = computeProposalPreflightChecklist(inputFrom({}));
    expect(r.items).toHaveLength(7);
    expect(r.items.map((i) => i.id)).toEqual([
      "sample",
      "confidence",
      "verdict",
      "stability",
      "what_if",
      "call_flips",
      "calibration_trend",
    ]);
  });

  test("every row has a non-empty label + evidence", () => {
    const r = computeProposalPreflightChecklist(inputFrom({}));
    for (const item of r.items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("checkSample", () => {
  test("≥ threshold → pass with deal count evidence", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ dealsAnalyzed: SAMPLE_PASS_THRESHOLD }),
    );
    const row = r.items.find((i) => i.id === "sample")!;
    expect(row.status).toBe("pass");
    expect(row.evidence).toContain(`${SAMPLE_PASS_THRESHOLD}`);
  });

  test("< threshold → fail", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ dealsAnalyzed: SAMPLE_PASS_THRESHOLD - 1 }),
    );
    const row = r.items.find((i) => i.id === "sample")!;
    expect(row.status).toBe("fail");
  });

  test("null dealsAnalyzed → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ dealsAnalyzed: null }),
    );
    const row = r.items.find((i) => i.id === "sample")!;
    expect(row.status).toBe("skipped");
  });
});

describe("checkConfidence", () => {
  test("≥ pass threshold → pass with band evidence", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ confidence: confidenceAt(CONFIDENCE_PASS_THRESHOLD) }),
    );
    const row = r.items.find((i) => i.id === "confidence")!;
    expect(row.status).toBe("pass");
    expect(row.evidence).toContain(`${CONFIDENCE_PASS_THRESHOLD}/100`);
  });

  test("between thresholds → warn", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ confidence: confidenceAt(CONFIDENCE_WARN_THRESHOLD) }),
    );
    const row = r.items.find((i) => i.id === "confidence")!;
    expect(row.status).toBe("warn");
  });

  test("< warn threshold → fail", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ confidence: confidenceAt(CONFIDENCE_WARN_THRESHOLD - 1) }),
    );
    const row = r.items.find((i) => i.id === "confidence")!;
    expect(row.status).toBe("fail");
  });

  test("null → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ confidence: null }),
    );
    const row = r.items.find((i) => i.id === "confidence")!;
    expect(row.status).toBe("skipped");
  });
});

describe("checkVerdict", () => {
  test("apply → pass", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ verdict: verdictAt("apply") }),
    );
    const row = r.items.find((i) => i.id === "verdict")!;
    expect(row.status).toBe("pass");
    expect(row.evidence).toBe("apply");
  });

  test("review → warn", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ verdict: verdictAt("review") }),
    );
    const row = r.items.find((i) => i.id === "verdict")!;
    expect(row.status).toBe("warn");
  });

  test("hold → fail", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ verdict: verdictAt("hold") }),
    );
    const row = r.items.find((i) => i.id === "verdict")!;
    expect(row.status).toBe("fail");
  });

  test("defer → fail", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ verdict: verdictAt("defer") }),
    );
    const row = r.items.find((i) => i.id === "verdict")!;
    expect(row.status).toBe("fail");
  });

  test("null → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ verdict: null }),
    );
    const row = r.items.find((i) => i.id === "verdict")!;
    expect(row.status).toBe("skipped");
  });
});

describe("checkStability", () => {
  test("stable rating → pass", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        stability: stabilityReport({
          rating: "stable",
          meanStability: 0.92,
        }),
      }),
    );
    const row = r.items.find((i) => i.id === "stability")!;
    expect(row.status).toBe("pass");
  });

  test("mixed rating → warn", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        stability: stabilityReport({
          rating: "mixed",
          meanStability: 0.65,
        }),
      }),
    );
    const row = r.items.find((i) => i.id === "stability")!;
    expect(row.status).toBe("warn");
  });

  test("fragile rating → fail", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        stability: stabilityReport({
          rating: "fragile",
          meanStability: 0.3,
        }),
      }),
    );
    const row = r.items.find((i) => i.id === "stability")!;
    expect(row.status).toBe("fail");
  });

  test("empty stability report → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        stability: stabilityReport({
          empty: true,
          rating: null,
          meanStability: null,
        }),
      }),
    );
    const row = r.items.find((i) => i.id === "stability")!;
    expect(row.status).toBe("skipped");
  });

  test("null → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ stability: null }),
    );
    const row = r.items.find((i) => i.id === "stability")!;
    expect(row.status).toBe("skipped");
  });
});

describe("checkWhatIf", () => {
  test("brier delta < -0.005 → pass", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ whatIf: whatIfAt(-0.02) }),
    );
    const row = r.items.find((i) => i.id === "what_if")!;
    expect(row.status).toBe("pass");
  });

  test("|brier delta| ≤ 0.005 → warn (neutral)", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ whatIf: whatIfAt(0.002) }),
    );
    const row = r.items.find((i) => i.id === "what_if")!;
    expect(row.status).toBe("warn");
  });

  test("brier delta > 0.005 → fail", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ whatIf: whatIfAt(0.02) }),
    );
    const row = r.items.find((i) => i.id === "what_if")!;
    expect(row.status).toBe("fail");
  });

  test("noActionableChanges → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        whatIf: whatIfAt(-0.02, { noActionableChanges: true }),
      }),
    );
    const row = r.items.find((i) => i.id === "what_if")!;
    expect(row.status).toBe("skipped");
  });

  test("null → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ whatIf: null }),
    );
    const row = r.items.find((i) => i.id === "what_if")!;
    expect(row.status).toBe("skipped");
  });
});

describe("checkCallFlips", () => {
  test("corr > reg → pass", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ callFlips: callFlipsAt(5, 1) }),
    );
    const row = r.items.find((i) => i.id === "call_flips")!;
    expect(row.status).toBe("pass");
    expect(row.evidence).toContain("5");
    expect(row.evidence).toContain("1");
  });

  test("corr == reg (both > 0) → warn", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ callFlips: callFlipsAt(2, 2) }),
    );
    const row = r.items.find((i) => i.id === "call_flips")!;
    expect(row.status).toBe("warn");
  });

  test("corr < reg → fail", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ callFlips: callFlipsAt(1, 4) }),
    );
    const row = r.items.find((i) => i.id === "call_flips")!;
    expect(row.status).toBe("fail");
  });

  test("no flips either way (corr=0, reg=0) → warn", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ callFlips: callFlipsAt(0, 0) }),
    );
    const row = r.items.find((i) => i.id === "call_flips")!;
    expect(row.status).toBe("warn");
  });

  test("empty report → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        callFlips: callFlipsAt(0, 0, { empty: true }),
      }),
    );
    const row = r.items.find((i) => i.id === "call_flips")!;
    expect(row.status).toBe("skipped");
  });

  test("noActionableChanges → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        callFlips: callFlipsAt(0, 0, { noActionableChanges: true }),
      }),
    );
    const row = r.items.find((i) => i.id === "call_flips")!;
    expect(row.status).toBe("skipped");
  });

  test("null → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ callFlips: null }),
    );
    const row = r.items.find((i) => i.id === "call_flips")!;
    expect(row.status).toBe("skipped");
  });
});

describe("checkCalibrationTrend", () => {
  test("improving → pass", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ calibrationDrift: calibrationAt("improving") }),
    );
    const row = r.items.find((i) => i.id === "calibration_trend")!;
    expect(row.status).toBe("pass");
    expect(row.evidence).toContain("improving");
  });

  test("stable → pass", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ calibrationDrift: calibrationAt("stable") }),
    );
    const row = r.items.find((i) => i.id === "calibration_trend")!;
    expect(row.status).toBe("pass");
    expect(row.evidence).toContain("stable");
  });

  test("degrading → warn", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ calibrationDrift: calibrationAt("degrading") }),
    );
    const row = r.items.find((i) => i.id === "calibration_trend")!;
    expect(row.status).toBe("warn");
    expect(row.evidence).toContain("degrading");
  });

  test("empty calibration windows → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        calibrationDrift: calibrationAt("stable", {
          recentN: 0,
          priorN: 0,
        }),
      }),
    );
    const row = r.items.find((i) => i.id === "calibration_trend")!;
    expect(row.status).toBe("skipped");
  });

  test("null → skipped", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ calibrationDrift: null }),
    );
    const row = r.items.find((i) => i.id === "calibration_trend")!;
    expect(row.status).toBe("skipped");
  });
});

describe("computeProposalPreflightChecklist — readiness derivation", () => {
  test("all passes → ready", () => {
    const r = computeProposalPreflightChecklist(inputFrom({}));
    expect(r.failCount).toBe(0);
    expect(r.warnCount).toBe(0);
    expect(r.readiness).toBe("ready");
  });

  test("1 warn, 0 fail → ready (single warning isn't a blocker)", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        confidence: confidenceAt(CONFIDENCE_WARN_THRESHOLD), // warn
      }),
    );
    expect(r.warnCount).toBe(1);
    expect(r.failCount).toBe(0);
    expect(r.readiness).toBe("ready");
  });

  test("2 warns, 0 fail → review", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        confidence: confidenceAt(CONFIDENCE_WARN_THRESHOLD), // warn
        verdict: verdictAt("review"), // warn
      }),
    );
    expect(r.warnCount).toBe(2);
    expect(r.failCount).toBe(0);
    expect(r.readiness).toBe("review");
  });

  test("1 fail → hold (regardless of other rows)", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        verdict: verdictAt("hold"), // fail
      }),
    );
    expect(r.failCount).toBeGreaterThanOrEqual(1);
    expect(r.readiness).toBe("hold");
  });

  test("skipped rows never contribute to readiness", () => {
    // Skip everything skippable; keep sample + verdict passing.
    const r = computeProposalPreflightChecklist(
      inputFrom({
        confidence: null,
        stability: null,
        whatIf: null,
        callFlips: null,
        calibrationDrift: null,
      }),
    );
    expect(r.skippedCount).toBe(5);
    expect(r.warnCount).toBe(0);
    expect(r.failCount).toBe(0);
    expect(r.readiness).toBe("ready");
  });

  test("failCount dominates warnCount", () => {
    // 2 warns + 1 fail → still hold, not review
    const r = computeProposalPreflightChecklist(
      inputFrom({
        confidence: confidenceAt(CONFIDENCE_WARN_THRESHOLD),
        verdict: verdictAt("hold"), // fail
        callFlips: callFlipsAt(2, 2), // warn
      }),
    );
    expect(r.failCount).toBeGreaterThanOrEqual(1);
    expect(r.readiness).toBe("hold");
  });
});

describe("computeProposalPreflightChecklist — headline copy", () => {
  test("ready headline references 'Ready to apply'", () => {
    const r = computeProposalPreflightChecklist(inputFrom({}));
    expect(r.headline).toContain("Ready to apply");
    expect(r.headline).toContain("passed");
  });

  test("review headline references 'Review recommended'", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({
        confidence: confidenceAt(CONFIDENCE_WARN_THRESHOLD),
        verdict: verdictAt("review"),
      }),
    );
    expect(r.headline).toContain("Review recommended");
    expect(r.headline).toContain("warn");
  });

  test("hold headline references 'Not ready'", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ verdict: verdictAt("hold") }),
    );
    expect(r.headline).toContain("Not ready");
    expect(r.headline).toContain("failed");
  });

  test("skipped count surfaces in headline when present", () => {
    const r = computeProposalPreflightChecklist(
      inputFrom({ confidence: null, stability: null }),
    );
    expect(r.headline).toContain("skipped");
  });
});

describe("describeReadinessPill", () => {
  test("ready → ✓ READY emerald", () => {
    expect(describeReadinessPill("ready")).toEqual({
      label: "✓ READY",
      tone: "emerald",
    });
  });

  test("review → ⚠ REVIEW amber", () => {
    expect(describeReadinessPill("review")).toEqual({
      label: "⚠ REVIEW",
      tone: "amber",
    });
  });

  test("hold → ✗ HOLD rose", () => {
    expect(describeReadinessPill("hold")).toEqual({
      label: "✗ HOLD",
      tone: "rose",
    });
  });
});

describe("computeProposalPreflightChecklist — determinism", () => {
  test("same input → identical output", () => {
    const input = inputFrom({
      confidence: confidenceAt(62),
      verdict: verdictAt("review"),
      whatIf: whatIfAt(-0.012),
      callFlips: callFlipsAt(4, 2),
      calibrationDrift: calibrationAt("degrading"),
    });
    const r1 = computeProposalPreflightChecklist(input);
    const r2 = computeProposalPreflightChecklist(input);
    expect(r1).toEqual(r2);
  });
});
