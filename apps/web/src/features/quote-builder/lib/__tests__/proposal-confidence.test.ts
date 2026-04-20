/**
 * Proposal Confidence tests — Slice 20v.
 *
 * Every driver branch + every band boundary gets pinned here. The
 * confidence number is what a manager reads at the moment of action,
 * so copy is tested verbatim where it appears in the rationale.
 */

import { describe, expect, test } from "bun:test";
import {
  computeProposalConfidence,
  describeProposalConfidencePill,
  CONFIDENCE_BASE,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
  type ProposalConfidenceInputs,
} from "../proposal-confidence";
import type { ScorerProposal } from "../scorer-proposal";
import type { CalibrationDriftReport } from "../calibration-drift";
import type { FactorDriftReport } from "../factor-drift";
import type { ScorerWhatIfResult } from "../scorer-what-if";
import type { ShadowAgreementSummary } from "../retrospective-shadow";

// ── Factories ──────────────────────────────────────────────────────────

function proposal(overrides: Partial<ScorerProposal> = {}): ScorerProposal {
  return {
    headline: "Test proposal",
    changes: [],
    shadowCorroboration: null,
    lowConfidence: false,
    ...overrides,
  };
}

function emptyInputs(): ProposalConfidenceInputs {
  return {
    calibrationDrift: null,
    factorDrift: null,
    whatIf: null,
    shadowAgreement: null,
    auditCount: 0,
  };
}

function drift(overrides: Partial<CalibrationDriftReport> = {}): CalibrationDriftReport {
  return {
    referenceDate: "2026-04-01T00:00:00.000Z",
    windowDays: 90,
    recentN: 20,
    priorN: 25,
    recentAccuracy: 0.7,
    priorAccuracy: 0.65,
    accuracyDelta: 0.05,
    recentBrier: 0.2,
    priorBrier: 0.21,
    brierDelta: -0.01,
    direction: "stable",
    lowConfidence: false,
    ...overrides,
  };
}

function factorDrift(overrides: Partial<FactorDriftReport> = {}): FactorDriftReport {
  return {
    referenceDate: "2026-04-01T00:00:00.000Z",
    windowDays: 90,
    recentN: 20,
    priorN: 25,
    drifts: [],
    lowConfidence: false,
    ...overrides,
  };
}

function whatIf(overrides: Partial<ScorerWhatIfResult> = {}): ScorerWhatIfResult {
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

function shadow(overrides: Partial<ShadowAgreementSummary> = {}): ShadowAgreementSummary {
  return {
    totalDeals: 30,
    shadowAbstainCount: 0,
    scorableDeals: 30,
    ruleAgreedCount: 18,
    shadowAgreedCount: 20,
    ruleAgreementRate: 0.6,
    shadowAgreementRate: 0.67,
    disagreementCount: 10,
    shadowWonDisagreementCount: 7,
    shadowDisagreementWinRate: 0.7,
    lowConfidence: false,
    ...overrides,
  };
}

// ── Constants ─────────────────────────────────────────────────────────

describe("computeProposalConfidence — constants", () => {
  test("base is 50", () => {
    expect(CONFIDENCE_BASE).toBe(50);
  });
  test("thresholds are ordered", () => {
    expect(MEDIUM_CONFIDENCE_THRESHOLD).toBeLessThan(HIGH_CONFIDENCE_THRESHOLD);
    expect(MEDIUM_CONFIDENCE_THRESHOLD).toBe(45);
    expect(HIGH_CONFIDENCE_THRESHOLD).toBe(70);
  });
});

// ── Empty-signal prior ────────────────────────────────────────────────

describe("computeProposalConfidence — empty signal set", () => {
  test("nothing to say → stays at base 50, medium band, no drivers", () => {
    const r = computeProposalConfidence(proposal(), emptyInputs());
    expect(r.confidence).toBe(50);
    expect(r.band).toBe("medium");
    expect(r.drivers).toEqual([]);
    expect(r.rationale).toContain("Neutral prior");
    expect(r.dampenedByThinSample).toBe(false);
  });
});

// ── Sample size driver ────────────────────────────────────────────────

describe("computeProposalConfidence — sample size", () => {
  test("0 audits: silent (no driver row)", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      auditCount: 0,
    });
    expect(r.drivers.find((d) => d.signal === "sample_size")).toBeUndefined();
  });

  test("1 audit: -5 drag + 'below the 11-deal minimum'", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      auditCount: 1,
    });
    const d = r.drivers.find((x) => x.signal === "sample_size")!;
    expect(d.contribution).toBe(-5);
    expect(d.rationale).toBe("Only 1 closed-deal audit — below the 11-deal minimum for trustworthy attribution.");
    expect(r.confidence).toBe(45);
  });

  test("10 audits → still drags -5 (below minimum)", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      auditCount: 10,
    });
    expect(r.drivers.find((d) => d.signal === "sample_size")?.contribution).toBe(-5);
  });

  test("11 audits → +5 boundary", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      auditCount: 11,
    });
    expect(r.drivers.find((d) => d.signal === "sample_size")?.contribution).toBe(5);
    expect(r.confidence).toBe(55);
  });

  test("26 audits → +12", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      auditCount: 26,
    });
    expect(r.drivers.find((d) => d.signal === "sample_size")?.contribution).toBe(12);
  });

  test("51+ audits → full +20", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      auditCount: 51,
    });
    expect(r.drivers.find((d) => d.signal === "sample_size")?.contribution).toBe(20);
    expect(r.confidence).toBe(70);
    expect(r.band).toBe("high");
  });
});

// ── Calibration drift driver ──────────────────────────────────────────

describe("computeProposalConfidence — calibration drift", () => {
  test("degrading + trusted → +15", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      calibrationDrift: drift({ direction: "degrading", accuracyDelta: -0.1 }),
    });
    const d = r.drivers.find((x) => x.signal === "calibration_drift")!;
    expect(d.contribution).toBe(15);
    expect(d.rationale).toContain("dulling");
    expect(d.rationale).toContain("-10pp");
  });

  test("improving + trusted → -5 (less urgent)", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      calibrationDrift: drift({ direction: "improving", accuracyDelta: 0.09 }),
    });
    const d = r.drivers.find((x) => x.signal === "calibration_drift")!;
    expect(d.contribution).toBe(-5);
    expect(d.rationale).toContain("sharpening");
  });

  test("stable → silent", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      calibrationDrift: drift({ direction: "stable" }),
    });
    expect(r.drivers.find((d) => d.signal === "calibration_drift")).toBeUndefined();
  });

  test("degrading + lowConfidence → silent (don't reward thin drift signal)", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      calibrationDrift: drift({
        direction: "degrading",
        accuracyDelta: -0.1,
        lowConfidence: true,
      }),
    });
    expect(r.drivers.find((d) => d.signal === "calibration_drift")).toBeUndefined();
  });

  test("zero recentN → silent", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      calibrationDrift: drift({ recentN: 0, direction: "degrading" }),
    });
    expect(r.drivers.find((d) => d.signal === "calibration_drift")).toBeUndefined();
  });
});

// ── What-if driver ────────────────────────────────────────────────────

describe("computeProposalConfidence — what-if", () => {
  test("Brier improves ≥0.02 AND hit rate up → +25 strongest signal", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      whatIf: whatIf({ brierDelta: -0.03, hitRateDelta: 0.08 }),
    });
    const d = r.drivers.find((x) => x.signal === "what_if")!;
    expect(d.contribution).toBe(25);
    expect(d.rationale).toContain("Brier improves by 0.030");
    expect(d.rationale).toContain("+8pp");
  });

  test("Brier boundary exactly -0.02 + hit rate up → +25", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      whatIf: whatIf({ brierDelta: -0.02, hitRateDelta: 0.05 }),
    });
    expect(r.drivers.find((d) => d.signal === "what_if")?.contribution).toBe(25);
  });

  test("Brier improves below threshold → +12 directional", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      whatIf: whatIf({ brierDelta: -0.005, hitRateDelta: -0.01 }),
    });
    const d = r.drivers.find((x) => x.signal === "what_if")!;
    expect(d.contribution).toBe(12);
    expect(d.rationale).toContain("directional gain");
  });

  test("Brier worsens > 0.005 → -15 loud honesty signal", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      whatIf: whatIf({ brierDelta: 0.03, hitRateDelta: -0.05 }),
    });
    const d = r.drivers.find((x) => x.signal === "what_if")!;
    expect(d.contribution).toBe(-15);
    expect(d.rationale).toContain("worsens");
    expect(d.rationale).toContain("hurt accuracy");
  });

  test("Brier flat (between -0.005 and +0.005) → silent", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      whatIf: whatIf({ brierDelta: 0.001, hitRateDelta: -0.005 }),
    });
    expect(r.drivers.find((d) => d.signal === "what_if")).toBeUndefined();
  });

  test("thin what-if sample halves a +25 → +13 (rounded)", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      whatIf: whatIf({ brierDelta: -0.03, hitRateDelta: 0.08, lowConfidence: true }),
    });
    const d = r.drivers.find((x) => x.signal === "what_if")!;
    expect(d.contribution).toBe(13);
    expect(d.rationale).toContain("Thin simulation sample");
  });

  test("noActionableChanges → silent (can't simulate)", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      whatIf: whatIf({ noActionableChanges: true, brierDelta: 0 }),
    });
    expect(r.drivers.find((d) => d.signal === "what_if")).toBeUndefined();
  });

  test("null brierDelta → silent", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      whatIf: whatIf({ brierDelta: null }),
    });
    expect(r.drivers.find((d) => d.signal === "what_if")).toBeUndefined();
  });
});

// ── Shadow agreement driver ───────────────────────────────────────────

describe("computeProposalConfidence — shadow agreement", () => {
  test("shadow wins ≥60% of disagreements → +10", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      shadowAgreement: shadow({ shadowDisagreementWinRate: 0.7 }),
    });
    const d = r.drivers.find((x) => x.signal === "shadow_agreement")!;
    expect(d.contribution).toBe(10);
    expect(d.rationale).toContain("70%");
  });

  test("0.6 boundary → +10", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      shadowAgreement: shadow({ shadowDisagreementWinRate: 0.6 }),
    });
    expect(r.drivers.find((d) => d.signal === "shadow_agreement")?.contribution).toBe(10);
  });

  test("shadow < 40% of disagreements → -5", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      shadowAgreement: shadow({ shadowDisagreementWinRate: 0.3 }),
    });
    expect(r.drivers.find((d) => d.signal === "shadow_agreement")?.contribution).toBe(-5);
  });

  test("middle band 0.4-0.6 → silent coin-flip", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      shadowAgreement: shadow({ shadowDisagreementWinRate: 0.5 }),
    });
    expect(r.drivers.find((d) => d.signal === "shadow_agreement")).toBeUndefined();
  });

  test("lowConfidence → silent", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      shadowAgreement: shadow({ shadowDisagreementWinRate: 0.9, lowConfidence: true }),
    });
    expect(r.drivers.find((d) => d.signal === "shadow_agreement")).toBeUndefined();
  });

  test("zero disagreements → silent", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      shadowAgreement: shadow({
        disagreementCount: 0,
        shadowWonDisagreementCount: 0,
        shadowDisagreementWinRate: null,
      }),
    });
    expect(r.drivers.find((d) => d.signal === "shadow_agreement")).toBeUndefined();
  });
});

// ── Factor-drift coherence ────────────────────────────────────────────

describe("computeProposalConfidence — factor-drift coherence", () => {
  test("≥50% of actionable changes match drifting factors → +10", () => {
    const r = computeProposalConfidence(
      proposal({
        changes: [
          {
            label: "Warm customer",
            action: "flip",
            currentAvgWeight: 25,
            lift: -0.2,
            present: 10,
            absent: 20,
            rationale: "x",
          },
          {
            label: "Trade in hand",
            action: "strengthen",
            currentAvgWeight: 10,
            lift: 0.35,
            present: 15,
            absent: 15,
            rationale: "x",
          },
        ],
      }),
      {
        ...emptyInputs(),
        factorDrift: factorDrift({
          drifts: [
            {
              label: "Warm customer",
              direction: "flipped",
              drift: -0.3,
              priorLift: 0.1,
              recentLift: -0.2,
              priorPresent: 20,
              recentPresent: 10,
              recentAvgWeight: 25,
              lowConfidence: false,
            },
            {
              label: "Trade in hand",
              direction: "rising",
              drift: 0.2,
              priorLift: 0.15,
              recentLift: 0.35,
              priorPresent: 15,
              recentPresent: 15,
              recentAvgWeight: 10,
              lowConfidence: false,
            },
          ],
        }),
      },
    );
    const d = r.drivers.find((x) => x.signal === "factor_drift_coherence")!;
    expect(d.contribution).toBe(10);
    expect(d.rationale).toContain("2 of 2");
  });

  test("25-49% match → +5 partial corroboration", () => {
    const r = computeProposalConfidence(
      proposal({
        changes: [
          { label: "A", action: "flip", currentAvgWeight: 0, lift: 0, present: 0, absent: 0, rationale: "" },
          { label: "B", action: "drop", currentAvgWeight: 0, lift: 0, present: 0, absent: 0, rationale: "" },
          { label: "C", action: "weaken", currentAvgWeight: 0, lift: 0, present: 0, absent: 0, rationale: "" },
          { label: "D", action: "strengthen", currentAvgWeight: 0, lift: 0, present: 0, absent: 0, rationale: "" },
        ],
      }),
      {
        ...emptyInputs(),
        factorDrift: factorDrift({
          drifts: [
            {
              label: "A",
              direction: "rising",
              drift: 0.15,
              priorLift: 0,
              recentLift: 0.15,
              priorPresent: 20,
              recentPresent: 20,
              recentAvgWeight: 5,
              lowConfidence: false,
            },
          ],
        }),
      },
    );
    expect(r.drivers.find((d) => d.signal === "factor_drift_coherence")?.contribution).toBe(5);
  });

  test("no matches → silent", () => {
    const r = computeProposalConfidence(
      proposal({
        changes: [
          { label: "Z", action: "flip", currentAvgWeight: 0, lift: 0, present: 0, absent: 0, rationale: "" },
        ],
      }),
      {
        ...emptyInputs(),
        factorDrift: factorDrift({
          drifts: [
            {
              label: "OtherLabel",
              direction: "rising",
              drift: 0.1,
              priorLift: 0,
              recentLift: 0.1,
              priorPresent: 10,
              recentPresent: 10,
              recentAvgWeight: 5,
              lowConfidence: false,
            },
          ],
        }),
      },
    );
    expect(r.drivers.find((d) => d.signal === "factor_drift_coherence")).toBeUndefined();
  });

  test("all 'keep' actions → no actionable denominator → silent", () => {
    const r = computeProposalConfidence(
      proposal({
        changes: [
          { label: "A", action: "keep", currentAvgWeight: 0, lift: 0, present: 0, absent: 0, rationale: "" },
        ],
      }),
      {
        ...emptyInputs(),
        factorDrift: factorDrift({
          drifts: [
            {
              label: "A",
              direction: "rising",
              drift: 0.1,
              priorLift: 0,
              recentLift: 0.1,
              priorPresent: 10,
              recentPresent: 10,
              recentAvgWeight: 5,
              lowConfidence: false,
            },
          ],
        }),
      },
    );
    expect(r.drivers.find((d) => d.signal === "factor_drift_coherence")).toBeUndefined();
  });
});

// ── Thin-sample damping ───────────────────────────────────────────────

describe("computeProposalConfidence — thin-sample damping", () => {
  test("proposal.lowConfidence halves positive contributions but not negative", () => {
    const r = computeProposalConfidence(proposal({ lowConfidence: true }), {
      ...emptyInputs(),
      auditCount: 51, // +20
      whatIf: whatIf({ brierDelta: 0.03, hitRateDelta: -0.05 }), // -15 (should remain)
    });
    const sample = r.drivers.find((d) => d.signal === "sample_size")!;
    const whatIfDriver = r.drivers.find((d) => d.signal === "what_if")!;
    expect(sample.contribution).toBe(10); // halved from 20
    expect(sample.rationale).toContain("Halved");
    expect(whatIfDriver.contribution).toBe(-15); // untouched
    expect(r.dampenedByThinSample).toBe(true);
    expect(r.rationale).toContain("dampened");
  });

  test("without lowConfidence, no damping note", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      auditCount: 51,
    });
    expect(r.dampenedByThinSample).toBe(false);
    expect(r.rationale).not.toContain("dampened");
  });
});

// ── Driver ordering ───────────────────────────────────────────────────

describe("computeProposalConfidence — driver ordering", () => {
  test("drivers sorted by |contribution| descending", () => {
    const r = computeProposalConfidence(proposal(), {
      auditCount: 11, // +5
      calibrationDrift: drift({ direction: "degrading", accuracyDelta: -0.1 }), // +15
      factorDrift: null,
      whatIf: whatIf({ brierDelta: -0.03, hitRateDelta: 0.08 }), // +25
      shadowAgreement: shadow({ shadowDisagreementWinRate: 0.3 }), // -5
    });
    const contribs = r.drivers.map((d) => Math.abs(d.contribution));
    for (let i = 0; i < contribs.length - 1; i++) {
      expect(contribs[i]).toBeGreaterThanOrEqual(contribs[i + 1]);
    }
  });
});

// ── Full composed scenarios ───────────────────────────────────────────

describe("computeProposalConfidence — composed scenarios", () => {
  test("ideal: substantial sample + degrading scorer + big what-if gain + aligned shadow → high, clamped to ≤100", () => {
    const r = computeProposalConfidence(proposal(), {
      auditCount: 60, // +20
      calibrationDrift: drift({ direction: "degrading", accuracyDelta: -0.12 }), // +15
      factorDrift: null,
      whatIf: whatIf({ brierDelta: -0.04, hitRateDelta: 0.09 }), // +25
      shadowAgreement: shadow({ shadowDisagreementWinRate: 0.75 }), // +10
    });
    expect(r.confidence).toBeLessThanOrEqual(100);
    expect(r.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE_THRESHOLD);
    expect(r.band).toBe("high");
    expect(r.rationale).toContain("High confidence");
  });

  test("worst-case: worsening what-if + thin sample + stale shadow → low, clamped to ≥0", () => {
    const r = computeProposalConfidence(proposal(), {
      auditCount: 2, // -5
      calibrationDrift: null,
      factorDrift: null,
      whatIf: whatIf({
        dealsSimulated: 20,
        brierDelta: 0.05,
        hitRateDelta: -0.1,
      }), // -15
      shadowAgreement: shadow({ shadowDisagreementWinRate: 0.2 }), // -5
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThan(MEDIUM_CONFIDENCE_THRESHOLD);
    expect(r.band).toBe("low");
    expect(r.rationale).toContain("Low confidence");
    expect(r.rationale).toContain("Hold");
  });

  test("medium: single +5 driver lifts 50 → 55 but not enough for high", () => {
    const r = computeProposalConfidence(proposal(), {
      ...emptyInputs(),
      auditCount: 11,
    });
    expect(r.confidence).toBe(55);
    expect(r.band).toBe("medium");
    expect(r.rationale).toContain("Medium confidence");
  });
});

// ── Pill copy ─────────────────────────────────────────────────────────

describe("describeProposalConfidencePill", () => {
  test("high → 'HIGH CONFIDENCE'", () => {
    expect(describeProposalConfidencePill("high")).toBe("HIGH CONFIDENCE");
  });
  test("medium → 'MEDIUM CONFIDENCE'", () => {
    expect(describeProposalConfidencePill("medium")).toBe("MEDIUM CONFIDENCE");
  });
  test("low → 'LOW CONFIDENCE'", () => {
    expect(describeProposalConfidencePill("low")).toBe("LOW CONFIDENCE");
  });
});
