/**
 * Scorer What-If tests — Slice 20p.
 *
 * The point of this slice is that the "preview" number has to be
 * defensible: a manager will argue with it in a PR review, and we
 * will lose that argument fast if the simulation is hand-wavy.
 *
 * Coverage focuses on the things we'd have to explain:
 *
 *   • Action multipliers — each verb produces the exact advertised
 *     delta (no rounding creep, no silent "keep" on unknown verbs).
 *   • Label-miss — audit factors not mentioned in the proposal are
 *     left untouched; NEW factors can't be simulated (we flag that
 *     in the JSDoc, and the test proves the behavior).
 *   • Clamp honesty — proposals whose effect lands above 95 or below
 *     5 don't phantom-move the score; the clamp absorbs the excess.
 *   • Ideal proposal — a hand-crafted "perfect flip" drives Brier
 *     to 0, which is the sanity check that the math is right.
 *   • All-`keep` proposal — flagged via `noActionableChanges` so the
 *     UI can hide the row rather than render "0.00 → 0.00".
 *   • Low-confidence gate at MIN_SIMULATION_SAMPLE.
 *   • Headline copy adapts to better / worse / unchanged / empty.
 */

import { describe, expect, test } from "bun:test";
import {
  simulateProposalCalibration,
  describeWhatIfHeadline,
  ACTION_MULTIPLIERS,
  MIN_SIMULATION_SAMPLE,
} from "../scorer-what-if";
import type {
  ScorerAction,
  ScorerFactorChange,
  ScorerProposal,
} from "../scorer-proposal";
import type { ClosedDealAuditRow } from "../closed-deals-audit";

function change(overrides: Partial<ScorerFactorChange> = {}): ScorerFactorChange {
  return {
    label: "F",
    currentAvgWeight: 10,
    lift: 0.2,
    present: 10,
    absent: 10,
    action: "keep",
    rationale: "r",
    ...overrides,
  };
}

function proposal(changes: ScorerFactorChange[]): ScorerProposal {
  return {
    headline: "h",
    changes,
    shadowCorroboration: null,
    lowConfidence: false,
  };
}

function audit(overrides: Partial<ClosedDealAuditRow> = {}): ClosedDealAuditRow {
  return {
    packageId: overrides.packageId ?? "pkg-1",
    score: 60,
    outcome: "won",
    factors: [{ label: "F", weight: 10 }],
    capturedAt: null,
    ...overrides,
  };
}

function manyAudits(n: number, gen: (i: number) => Partial<ClosedDealAuditRow>): ClosedDealAuditRow[] {
  return Array.from({ length: n }, (_, i) => audit({ packageId: `pkg-${i}`, ...gen(i) }));
}

describe("ACTION_MULTIPLIERS contract", () => {
  test("keep=1, strengthen=1.5, weaken=0.5, flip=-1, drop=0", () => {
    expect(ACTION_MULTIPLIERS.keep).toBe(1);
    expect(ACTION_MULTIPLIERS.strengthen).toBe(1.5);
    expect(ACTION_MULTIPLIERS.weaken).toBe(0.5);
    expect(ACTION_MULTIPLIERS.flip).toBe(-1);
    expect(ACTION_MULTIPLIERS.drop).toBe(0);
  });

  test("every ScorerAction has a defined multiplier", () => {
    const actions: ScorerAction[] = ["keep", "strengthen", "weaken", "flip", "drop"];
    for (const a of actions) {
      expect(typeof ACTION_MULTIPLIERS[a]).toBe("number");
      expect(Number.isFinite(ACTION_MULTIPLIERS[a])).toBe(true);
    }
  });
});

describe("simulateProposalCalibration — input gates", () => {
  test("null proposal → empty shape, no crash", () => {
    const r = simulateProposalCalibration(null, [audit()]);
    expect(r.dealsSimulated).toBe(1);
    expect(r.noActionableChanges).toBe(true);
    // No proposal → every deal's simulated == predicted → zero deltas
    expect(r.brierDelta).toBe(0);
    expect(r.hitRateDelta).toBe(0);
  });

  test("null audits → dealsSimulated=0, all metrics null", () => {
    const r = simulateProposalCalibration(proposal([]), null);
    expect(r.dealsSimulated).toBe(0);
    expect(r.currentBrier).toBe(null);
    expect(r.simulatedBrier).toBe(null);
    expect(r.brierDelta).toBe(null);
    expect(r.currentHitRate).toBe(null);
    expect(r.simulatedHitRate).toBe(null);
    expect(r.hitRateDelta).toBe(null);
    expect(r.perDeal).toEqual([]);
    expect(r.lowConfidence).toBe(false);
  });

  test("empty audits array → same empty shape as null", () => {
    const r = simulateProposalCalibration(proposal([]), []);
    expect(r.dealsSimulated).toBe(0);
    expect(r.currentBrier).toBe(null);
  });

  test("malformed audit rows are filtered", () => {
    const rows = [
      audit({ packageId: "" }), // bad id
      audit({ score: Number.NaN }), // bad score
      // @ts-expect-error malformed outcome
      audit({ outcome: "skipped" }),
      // @ts-expect-error malformed factors
      audit({ factors: null }),
      audit({ packageId: "good", score: 50 }),
    ];
    const r = simulateProposalCalibration(proposal([]), rows);
    expect(r.dealsSimulated).toBe(1);
    expect(r.perDeal[0].packageId).toBe("good");
  });
});

describe("simulateProposalCalibration — noActionableChanges flag", () => {
  test("proposal with only keeps → noActionableChanges=true", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "keep" })]),
      [audit()],
    );
    expect(r.noActionableChanges).toBe(true);
  });

  test("proposal with one non-keep → noActionableChanges=false", () => {
    const r = simulateProposalCalibration(
      proposal([
        change({ label: "F", action: "keep" }),
        change({ label: "G", action: "flip" }),
      ]),
      [audit()],
    );
    expect(r.noActionableChanges).toBe(false);
  });
});

describe("simulateProposalCalibration — action application", () => {
  test("drop removes the factor's contribution (−w)", () => {
    // Deal: stored score=60, has factor F with weight=10, proposal drops F.
    // Expected simulated = 60 + (0 - 1) * 10 = 50
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "drop" })]),
      [audit({ score: 60, factors: [{ label: "F", weight: 10 }] })],
    );
    expect(r.perDeal[0].predicted).toBe(60);
    expect(r.perDeal[0].simulated).toBe(50);
    expect(r.perDeal[0].delta).toBe(-10);
  });

  test("flip inverts the factor's contribution (−2w)", () => {
    // stored=60, weight=10, flip → simulated = 60 + (-1 - 1) * 10 = 40
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "flip" })]),
      [audit({ score: 60, factors: [{ label: "F", weight: 10 }] })],
    );
    expect(r.perDeal[0].simulated).toBe(40);
  });

  test("weaken halves the factor's contribution (−0.5w)", () => {
    // stored=60, weight=10, weaken → simulated = 60 + (0.5 - 1) * 10 = 55
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "weaken" })]),
      [audit({ score: 60, factors: [{ label: "F", weight: 10 }] })],
    );
    expect(r.perDeal[0].simulated).toBe(55);
  });

  test("strengthen boosts the contribution (+0.5w)", () => {
    // stored=60, weight=10, strengthen → simulated = 60 + (1.5 - 1) * 10 = 65
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "strengthen" })]),
      [audit({ score: 60, factors: [{ label: "F", weight: 10 }] })],
    );
    expect(r.perDeal[0].simulated).toBe(65);
  });

  test("keep leaves the score exactly as stored", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "keep" })]),
      [audit({ score: 62 })],
    );
    expect(r.perDeal[0].simulated).toBe(62);
    expect(r.perDeal[0].delta).toBe(0);
  });

  test("factor not in proposal → untouched", () => {
    // Proposal affects "G" but audit only has "F" — simulation == stored
    const r = simulateProposalCalibration(
      proposal([change({ label: "G", action: "flip" })]),
      [audit({ score: 55, factors: [{ label: "F", weight: 10 }] })],
    );
    expect(r.perDeal[0].simulated).toBe(55);
  });

  test("multiple factors with mixed actions sum correctly", () => {
    // stored=50, factors F=+10 (flip → -20), G=-5 (drop → +5) → sim=35
    const r = simulateProposalCalibration(
      proposal([
        change({ label: "F", action: "flip" }),
        change({ label: "G", action: "drop" }),
      ]),
      [
        audit({
          score: 50,
          factors: [
            { label: "F", weight: 10 },
            { label: "G", weight: -5 },
          ],
        }),
      ],
    );
    expect(r.perDeal[0].simulated).toBe(35);
  });

  test("malformed factor rows inside an audit are skipped, not thrown", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "drop" })]),
      [
        audit({
          score: 60,
          factors: [
            { label: "F", weight: 10 },
            // @ts-expect-error testing defensive skip
            { label: null, weight: 5 },
            { label: "X", weight: Number.NaN },
          ],
        }),
      ],
    );
    // Only F drops: 60 - 10 = 50
    expect(r.perDeal[0].simulated).toBe(50);
  });
});

describe("simulateProposalCalibration — clamp honesty", () => {
  test("simulated score above 95 is clamped (not phantom-moved)", () => {
    // stored=90, strengthen +15 → raw 105 → clamp 95
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "strengthen" })]),
      [audit({ score: 90, factors: [{ label: "F", weight: 30 }] })],
    );
    expect(r.perDeal[0].simulated).toBe(95);
  });

  test("simulated score below 5 is clamped", () => {
    // stored=10, flip sign of a -30 factor → +60 bonus (!). Actually: flip means
    // delta = (-1 - 1) * -30 = +60 → raw 70. Let's do opposite: drop a +30 factor.
    // stored=10 with a +30 factor → raw without = 10 - 30 = -20 → clamp 5
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "drop" })]),
      [audit({ score: 10, factors: [{ label: "F", weight: 30 }] })],
    );
    expect(r.perDeal[0].simulated).toBe(5);
  });
});

describe("simulateProposalCalibration — Brier + hit-rate math", () => {
  test("perfect flip drives Brier → 0", () => {
    // Constructed case: scorer predicted 100% on a deal that lost, and
    // 0% on a deal that won. Flipping the one factor with |w|=50 inverts
    // the prediction perfectly, so simulated Brier = 0.
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "flip" })]),
      [
        // stored score clamps to 95 (from raw 100). Factor weight = 50.
        // simulated raw = 95 + (-2)*50 = -5 → clamp 5. predProb=0.05, realized=0 (lost) → err 0.0025
        audit({ packageId: "a", score: 100, outcome: "lost", factors: [{ label: "F", weight: 50 }] }),
        // stored 0 clamps to 5; weight -50; sim raw = 5 + (-2)*(-50) = 105 → clamp 95. predProb=0.95, realized=1 → err 0.0025
        audit({ packageId: "b", score: 0, outcome: "won", factors: [{ label: "F", weight: -50 }] }),
      ],
    );
    // Current Brier: ((0.95-0)² + (0.05-1)²)/2 = (0.9025 + 0.9025)/2 = 0.9025
    expect(r.currentBrier).toBeCloseTo(0.9025, 3);
    // Simulated Brier: ((0.05-0)² + (0.95-1)²)/2 = (0.0025 + 0.0025)/2 = 0.0025
    expect(r.simulatedBrier).toBeCloseTo(0.0025, 3);
    expect(r.brierDelta).toBeLessThan(0); // proposal improves
  });

  test("proposal that makes scorer worse → positive brierDelta", () => {
    // Scorer correctly said 90 on a won deal; we flip the +40 factor
    // that earned it → crater. Simulated = 90 + (-2)*40 = 10 → clamp 10.
    // Current Brier: (0.9-1)² = 0.01
    // Simulated Brier: (0.1-1)² = 0.81 → delta +0.80
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "flip" })]),
      [
        audit({ score: 90, outcome: "won", factors: [{ label: "F", weight: 40 }] }),
      ],
    );
    expect(r.currentBrier).toBeCloseTo(0.01, 3);
    expect(r.simulatedBrier).toBeCloseTo(0.81, 3);
    expect(r.brierDelta).toBeGreaterThan(0);
  });

  test("hit-rate uses same band threshold as calibration (≥55 predicts win)", () => {
    // Stored 54 with won deal = miss (predicted loss). Drop a +6 factor →
    // simulated = 54 - 6 = 48 → still predicts loss → still miss.
    // But if we STRENGTHEN instead, +0.5*6 = +3 → 57 → predicts win → hit.
    const base = [
      audit({ packageId: "x", score: 54, outcome: "won", factors: [{ label: "F", weight: 6 }] }),
    ];
    const rDrop = simulateProposalCalibration(
      proposal([change({ label: "F", action: "drop" })]),
      base,
    );
    expect(rDrop.currentHitRate).toBe(0);
    expect(rDrop.simulatedHitRate).toBe(0);

    const rStrengthen = simulateProposalCalibration(
      proposal([change({ label: "F", action: "strengthen" })]),
      base,
    );
    expect(rStrengthen.currentHitRate).toBe(0);
    expect(rStrengthen.simulatedHitRate).toBe(1);
    expect(rStrengthen.hitRateDelta).toBe(1);
  });

  test("expired outcome is treated as loss (matches scorer-calibration)", () => {
    // Expired should roll into the "didn't win" bucket — scoring 90 on
    // an expired deal is just as wrong as scoring 90 on a loss.
    const r = simulateProposalCalibration(
      proposal([]),
      [audit({ score: 90, outcome: "expired", factors: [] })],
    );
    // predProb=0.9, realized=0 → err = 0.81
    expect(r.currentBrier).toBeCloseTo(0.81, 3);
  });

  test("all-keep proposal → brierDelta = 0 exactly", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "keep" })]),
      manyAudits(8, (i) => ({
        score: 40 + i * 5,
        outcome: i % 2 === 0 ? "won" : "lost",
      })),
    );
    expect(r.brierDelta).toBe(0);
    expect(r.hitRateDelta).toBe(0);
  });
});

describe("simulateProposalCalibration — sample size + ordering", () => {
  test("perDeal sorted by |delta| descending", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "flip" })]),
      [
        audit({ packageId: "small", score: 50, factors: [{ label: "F", weight: 2 }] }),
        audit({ packageId: "big", score: 50, factors: [{ label: "F", weight: 20 }] }),
        audit({ packageId: "mid", score: 50, factors: [{ label: "F", weight: 10 }] }),
      ],
    );
    expect(r.perDeal.map((d) => d.packageId)).toEqual(["big", "mid", "small"]);
  });

  test("lowConfidence true below MIN_SIMULATION_SAMPLE", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "drop" })]),
      manyAudits(MIN_SIMULATION_SAMPLE - 1, () => ({})),
    );
    expect(r.lowConfidence).toBe(true);
  });

  test("lowConfidence false at MIN_SIMULATION_SAMPLE", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "drop" })]),
      manyAudits(MIN_SIMULATION_SAMPLE, () => ({})),
    );
    expect(r.lowConfidence).toBe(false);
  });
});

describe("describeWhatIfHeadline", () => {
  test("empty result → null (UI hides row)", () => {
    const r = simulateProposalCalibration(proposal([]), []);
    expect(describeWhatIfHeadline(r)).toBe(null);
  });

  test("all-keep result → null (no preview to show)", () => {
    const r = simulateProposalCalibration(
      proposal([change({ action: "keep" })]),
      manyAudits(8, () => ({})),
    );
    expect(describeWhatIfHeadline(r)).toBe(null);
  });

  test("improving proposal → 'improves' verb", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "flip" })]),
      [
        audit({ score: 100, outcome: "lost", factors: [{ label: "F", weight: 50 }] }),
        audit({ score: 0, outcome: "won", factors: [{ label: "F", weight: -50 }] }),
        audit({ score: 90, outcome: "lost", factors: [{ label: "F", weight: 40 }] }),
        audit({ score: 10, outcome: "won", factors: [{ label: "F", weight: -40 }] }),
        audit({ score: 85, outcome: "lost", factors: [{ label: "F", weight: 30 }] }),
      ],
    );
    expect(describeWhatIfHeadline(r)).toContain("improves");
    expect(describeWhatIfHeadline(r)).toContain("5 closed deals");
  });

  test("regressing proposal → 'regresses' verb", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "flip" })]),
      manyAudits(6, (i) => ({
        score: 90,
        outcome: "won",
        factors: [{ label: "F", weight: 40 }],
        packageId: `reg-${i}`,
      })),
    );
    expect(describeWhatIfHeadline(r)).toContain("regresses");
  });

  test("low-confidence notes the sample size", () => {
    const r = simulateProposalCalibration(
      proposal([change({ label: "F", action: "flip" })]),
      manyAudits(3, (i) => ({
        score: 90,
        outcome: "won",
        factors: [{ label: "F", weight: 40 }],
        packageId: `lc-${i}`,
      })),
    );
    const headline = describeWhatIfHeadline(r);
    expect(headline).toContain("directional only");
    expect(headline).toContain("3 deals");
  });
});
