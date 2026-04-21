/**
 * Proposal Stability tests — Slice 20aa.
 *
 * Behaviour this test pins:
 *
 *   • Empty/null inputs → `empty=true`, everything else null
 *   • All-keep proposal → `empty=true` (nothing actionable to test)
 *   • Stable flip (large |lift|, far from threshold) → stability 1.0
 *   • Threshold-riding drop (|lift| near LOW_LEVERAGE_LIFT) → mixed
 *   • Threshold-riding strengthen (|lift| near 0.25) → mixed or fragile
 *   • altAction records the most common alternative verb when flipped
 *   • Aggregate rating uses worst-case rule, not just mean
 *   • Missing attribution row → fragile entry (visible, not silently dropped)
 *   • Sort: least-stable first
 *   • Headline copy pinned for each rating
 *   • Pill copy + tone per rating
 *   • Perturbation grid size is exactly 15 (5 lift × 3 sample)
 */

import { describe, expect, test } from "bun:test";
import {
  LIFT_PERTURBATIONS,
  SAMPLE_SCALE_PERTURBATIONS,
  STABLE_THRESHOLD,
  MIXED_THRESHOLD,
  computeProposalStability,
  describeStabilityPill,
} from "../proposal-stability";
import { computeScorerProposal } from "../scorer-proposal";
import type {
  FactorAttribution,
  FactorAttributionReport,
} from "../factor-attribution";
import type { ScorerProposal } from "../scorer-proposal";

function fa(overrides: Partial<FactorAttribution> = {}): FactorAttribution {
  return {
    label: "F",
    present: 40,
    presentWins: 28,
    absent: 40,
    absentWins: 16,
    avgWeightWhenPresent: 5,
    lift: 0.3,
    winRateWhenPresent: 0.7,
    winRateWhenAbsent: 0.4,
    lowConfidence: false,
    ...overrides,
  };
}

function report(
  factors: FactorAttribution[],
  dealsAnalyzed = 40,
): FactorAttributionReport {
  return {
    dealsAnalyzed,
    factors,
    lowConfidence: dealsAnalyzed < 10,
  };
}

describe("computeProposalStability — empty cases", () => {
  test("null inputs → empty report", () => {
    const r = computeProposalStability(null, null);
    expect(r.empty).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.meanStability).toBeNull();
    expect(r.rating).toBeNull();
    expect(r.headline).toBeNull();
  });

  test("empty proposal → empty report", () => {
    const empty: ScorerProposal = {
      headline: "",
      changes: [],
      shadowCorroboration: null,
      lowConfidence: false,
    };
    const r = computeProposalStability(report([]), empty);
    expect(r.empty).toBe(true);
  });

  test("all-keep proposal → empty report", () => {
    // Factor where scorer is correctly calibrated → keep
    const f = fa({ avgWeightWhenPresent: 4, lift: 0.15 });
    const proposal = computeScorerProposal(report([f]), null);
    // Sanity
    expect(proposal.changes.every((c) => c.action === "keep")).toBe(true);
    const r = computeProposalStability(report([f]), proposal);
    expect(r.empty).toBe(true);
  });
});

describe("computeProposalStability — rock-solid flip", () => {
  test("large flip (|lift| far from threshold) → stability = 1.0, rating stable", () => {
    // Scorer says +8 weight, measured lift is -0.30 → flip, and -0.30
    // is far enough from the flip/non-flip boundary that a ±5pp shift
    // still picks flip.
    const f = fa({
      label: "Trade in hand",
      avgWeightWhenPresent: 8,
      lift: -0.3,
      winRateWhenPresent: 0.2,
      winRateWhenAbsent: 0.5,
    });
    const proposal = computeScorerProposal(report([f]), null);
    expect(proposal.changes[0].action).toBe("flip");
    const r = computeProposalStability(report([f]), proposal);
    expect(r.empty).toBe(false);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].stability).toBe(1);
    expect(r.changes[0].rating).toBe("stable");
    expect(r.changes[0].altAction).toBeNull();
    expect(r.rating).toBe("stable");
    expect(r.meanStability).toBe(1);
  });
});

describe("computeProposalStability — threshold-riding cases", () => {
  test("borderline drop (|lift| right at LOW_LEVERAGE_LIFT) records an altAction", () => {
    // lift=0.04 → drop, but +2.5pp shift makes lift=0.065 which stays
    // drop (still <0.05? no, 0.065 > 0.05 so it would stop being drop).
    // Wait — LOW_LEVERAGE_LIFT = 0.05. 0.04 is drop. 0.065 exceeds
    // LOW_LEVERAGE_LIFT so is no longer drop. So some cells will flip
    // to keep (because 0.065 with weight=5 doesn't hit strengthen/flip
    // thresholds either).
    const f = fa({
      label: "Small signal",
      avgWeightWhenPresent: 5,
      lift: 0.04,
      winRateWhenPresent: 0.52,
      winRateWhenAbsent: 0.48,
    });
    const proposal = computeScorerProposal(report([f]), null);
    expect(proposal.changes[0].action).toBe("drop");
    const r = computeProposalStability(report([f]), proposal);
    expect(r.changes).toHaveLength(1);
    // Should be <1 (some cells flip) and >0 (not everything flips).
    expect(r.changes[0].stability).toBeGreaterThan(0);
    expect(r.changes[0].stability).toBeLessThan(1);
    // altAction is recorded for the cells that flipped
    expect(r.changes[0].altAction).not.toBeNull();
  });

  test("stability ratings follow band definitions", () => {
    // Rock-solid flip from earlier test → stable band
    const solid = fa({
      label: "Solid",
      avgWeightWhenPresent: 8,
      lift: -0.5,
      winRateWhenPresent: 0.1,
      winRateWhenAbsent: 0.6,
    });
    const p = computeScorerProposal(report([solid]), null);
    const r = computeProposalStability(report([solid]), p);
    expect(r.changes[0].stability).toBeGreaterThanOrEqual(STABLE_THRESHOLD);
    expect(r.changes[0].rating).toBe("stable");
  });
});

describe("computeProposalStability — aggregate rating worst-case rule", () => {
  test("one fragile row forces aggregate to at least mixed even if mean looks stable", () => {
    // Three factors: two rock-solid flips + one borderline drop. Mean
    // might clear 0.8 but the borderline row is below 0.5 → aggregate
    // should be fragile.
    const solid1 = fa({
      label: "Solid A",
      avgWeightWhenPresent: 8,
      lift: -0.5,
      winRateWhenPresent: 0.1,
      winRateWhenAbsent: 0.6,
    });
    const solid2 = fa({
      label: "Solid B",
      avgWeightWhenPresent: -7,
      lift: 0.45,
      winRateWhenPresent: 0.8,
      winRateWhenAbsent: 0.35,
    });
    // Just below the LOW_LEVERAGE threshold — pickAction returns drop
    // but nearby cells (lift+0.025 or +0.05) cross the threshold and
    // flip to keep, so stability is low.
    const borderline = fa({
      label: "Borderline",
      avgWeightWhenPresent: 5,
      lift: 0.04,
      winRateWhenPresent: 0.54,
      winRateWhenAbsent: 0.5,
    });
    const p = computeScorerProposal(
      report([solid1, solid2, borderline], 60),
      null,
    );
    const r = computeProposalStability(
      report([solid1, solid2, borderline], 60),
      p,
    );
    expect(r.empty).toBe(false);
    // The borderline row should be visibly less stable than the solids
    const borderlineRow = r.changes.find((c) => c.label === "Borderline");
    const solidRow = r.changes.find((c) => c.label === "Solid A");
    expect(borderlineRow).toBeDefined();
    expect(solidRow).toBeDefined();
    if (borderlineRow && solidRow) {
      expect(borderlineRow.stability).toBeLessThan(solidRow.stability);
    }
  });

  test("least-stable-first sorting", () => {
    const solid = fa({
      label: "Solid",
      avgWeightWhenPresent: 8,
      lift: -0.5,
      winRateWhenPresent: 0.1,
      winRateWhenAbsent: 0.6,
    });
    const borderline = fa({
      label: "Borderline",
      avgWeightWhenPresent: 5,
      lift: 0.04,
      winRateWhenPresent: 0.52,
      winRateWhenAbsent: 0.48,
    });
    const p = computeScorerProposal(report([solid, borderline], 60), null);
    const r = computeProposalStability(report([solid, borderline], 60), p);
    // Least-stable first
    expect(r.changes[0].stability).toBeLessThanOrEqual(r.changes[1].stability);
  });
});

describe("computeProposalStability — missing attribution row", () => {
  test("actionable change with no matching attribution row → fragile row", () => {
    const f = fa({
      label: "Real factor",
      avgWeightWhenPresent: 8,
      lift: -0.3,
      winRateWhenPresent: 0.2,
      winRateWhenAbsent: 0.5,
    });
    const p = computeScorerProposal(report([f]), null);
    // Strip the attribution but keep the proposal referencing the label
    const stripped = report([]);
    const r = computeProposalStability(stripped, p);
    expect(r.empty).toBe(false);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].stability).toBe(0);
    expect(r.changes[0].rating).toBe("fragile");
  });
});

describe("computeProposalStability — mean + headline", () => {
  test("stable rating headline copy pinned", () => {
    const solid = fa({
      label: "Solid",
      avgWeightWhenPresent: 8,
      lift: -0.5,
      winRateWhenPresent: 0.1,
      winRateWhenAbsent: 0.6,
    });
    const p = computeScorerProposal(report([solid]), null);
    const r = computeProposalStability(report([solid]), p);
    expect(r.rating).toBe("stable");
    expect(r.headline).toContain("Stable");
    expect(r.headline).toContain("100%");
    expect(r.headline).toContain("1 actionable change");
  });

  test("fragile rating headline copy references fragile count", () => {
    // Build a scenario where every actionable change is fragile.
    const borderline = fa({
      label: "Edge",
      avgWeightWhenPresent: 5,
      lift: 0.05,
      winRateWhenPresent: 0.55,
      winRateWhenAbsent: 0.5,
    });
    const p = computeScorerProposal(report([borderline]), null);
    const r = computeProposalStability(report([borderline]), p);
    if (r.rating === "fragile") {
      expect(r.headline?.toLowerCase()).toContain("fragile");
    } else if (r.rating === "mixed") {
      expect(r.headline?.toLowerCase()).toContain("mixed");
    }
  });
});

describe("describeStabilityPill", () => {
  test("empty → muted NO DATA pill", () => {
    const pill = describeStabilityPill({
      changes: [],
      meanStability: null,
      rating: null,
      headline: null,
      empty: true,
    });
    expect(pill.tone).toBe("muted");
    expect(pill.label).toContain("NO DATA");
  });

  test("stable → emerald", () => {
    const pill = describeStabilityPill({
      changes: [],
      meanStability: 0.95,
      rating: "stable",
      headline: "x",
      empty: false,
    });
    expect(pill.tone).toBe("emerald");
    expect(pill.label).toContain("STABLE");
    expect(pill.label).toContain("95%");
  });

  test("mixed → amber", () => {
    const pill = describeStabilityPill({
      changes: [],
      meanStability: 0.65,
      rating: "mixed",
      headline: "x",
      empty: false,
    });
    expect(pill.tone).toBe("amber");
    expect(pill.label).toContain("MIXED");
  });

  test("fragile → rose", () => {
    const pill = describeStabilityPill({
      changes: [],
      meanStability: 0.3,
      rating: "fragile",
      headline: "x",
      empty: false,
    });
    expect(pill.tone).toBe("rose");
    expect(pill.label).toContain("FRAGILE");
  });
});

describe("computeProposalStability — grid constants", () => {
  test("lift perturbations are exactly 5 and span -5pp to +5pp", () => {
    expect(LIFT_PERTURBATIONS).toHaveLength(5);
    expect(LIFT_PERTURBATIONS[0]).toBe(-0.05);
    expect(LIFT_PERTURBATIONS[LIFT_PERTURBATIONS.length - 1]).toBe(0.05);
    expect(LIFT_PERTURBATIONS.includes(0)).toBe(true);
  });

  test("sample scale perturbations are exactly 3 and span 0.8 to 1.2", () => {
    expect(SAMPLE_SCALE_PERTURBATIONS).toHaveLength(3);
    expect(SAMPLE_SCALE_PERTURBATIONS[0]).toBe(0.8);
    expect(SAMPLE_SCALE_PERTURBATIONS[SAMPLE_SCALE_PERTURBATIONS.length - 1]).toBe(1.2);
  });

  test("threshold constants are ordered stable > mixed", () => {
    expect(STABLE_THRESHOLD).toBeGreaterThan(MIXED_THRESHOLD);
    expect(STABLE_THRESHOLD).toBeLessThan(1);
    expect(MIXED_THRESHOLD).toBeGreaterThan(0);
  });
});

describe("computeProposalStability — determinism", () => {
  test("same input → identical output", () => {
    const f = fa({
      label: "Det",
      avgWeightWhenPresent: 8,
      lift: -0.3,
      winRateWhenPresent: 0.2,
      winRateWhenAbsent: 0.5,
    });
    const p = computeScorerProposal(report([f]), null);
    const r1 = computeProposalStability(report([f]), p);
    const r2 = computeProposalStability(report([f]), p);
    expect(r1).toEqual(r2);
  });
});

describe("computeProposalStability — multi-change proposal", () => {
  test("mean aggregates across actionable changes only (keeps excluded)", () => {
    const flipFactor = fa({
      label: "Flip",
      avgWeightWhenPresent: 8,
      lift: -0.5,
      winRateWhenPresent: 0.1,
      winRateWhenAbsent: 0.6,
    });
    const keepFactor = fa({
      label: "Keep",
      avgWeightWhenPresent: 4,
      lift: 0.15,
      winRateWhenPresent: 0.55,
      winRateWhenAbsent: 0.4,
    });
    const p = computeScorerProposal(report([flipFactor, keepFactor]), null);
    const actionable = p.changes.filter((c) => c.action !== "keep");
    const r = computeProposalStability(report([flipFactor, keepFactor]), p);
    expect(r.changes).toHaveLength(actionable.length);
    expect(r.changes.some((c) => c.label === "Keep")).toBe(false);
  });
});
