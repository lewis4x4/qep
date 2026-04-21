/**
 * Scorer Proposal tests — Slice 20m.
 *
 * The proposal is the first artifact that directly recommends a code
 * change, so the picker's matrix matters:
 *
 *   • Surprising factor (sign disagrees w/ lift, big weight) → flip
 *   • Lift near zero w/ enough obs → drop
 *   • Weight big, lift small → weaken
 *   • Weight tiny, lift big → strengthen
 *   • Matched → keep
 *   • Low-confidence → keep + "insufficient observations" rationale
 *
 * Also pin: sort order, shadow corroboration copy, markdown renderer.
 */

import { describe, expect, test } from "bun:test";
import {
  computeScorerProposal,
  renderScorerProposalMarkdown,
  LOW_LEVERAGE_LIFT,
} from "../scorer-proposal";
import type {
  FactorAttribution,
  FactorAttributionReport,
} from "../factor-attribution";
import type { ShadowAgreementSummary } from "../retrospective-shadow";

function fa(overrides: Partial<FactorAttribution> = {}): FactorAttribution {
  return {
    label: "F",
    present: 20,
    presentWins: 14,
    absent: 20,
    absentWins: 8,
    avgWeightWhenPresent: 5,
    lift: 0.3,
    winRateWhenPresent: 0.7,
    winRateWhenAbsent: 0.4,
    lowConfidence: false,
    ...overrides,
  };
}

function report(factors: FactorAttribution[], dealsAnalyzed = 30): FactorAttributionReport {
  return {
    dealsAnalyzed,
    factors,
    lowConfidence: dealsAnalyzed < 10,
  };
}

describe("computeScorerProposal — picker matrix", () => {
  test("surprising factor → flip", () => {
    const f = fa({
      label: "Trade in hand",
      avgWeightWhenPresent: 8,
      lift: -0.3, // scorer says +, reality says -
      winRateWhenPresent: 0.2,
      winRateWhenAbsent: 0.5,
    });
    const p = computeScorerProposal(report([f]), null);
    expect(p.changes[0].action).toBe("flip");
    expect(p.changes[0].rationale.toLowerCase()).toContain("anti-predictive");
  });

  test("low-leverage factor (|lift| < LOW_LEVERAGE_LIFT) → drop", () => {
    const f = fa({
      label: "Tiny signal",
      avgWeightWhenPresent: 5,
      lift: LOW_LEVERAGE_LIFT / 2,
      winRateWhenPresent: 0.52,
      winRateWhenAbsent: 0.5,
    });
    const p = computeScorerProposal(report([f]), null);
    expect(p.changes[0].action).toBe("drop");
    expect(p.changes[0].rationale.toLowerCase()).toContain("noise floor");
  });

  test("oversized weight (|w|>5, |lift|<0.1) → weaken", () => {
    const f = fa({
      label: "Heavy hitter",
      avgWeightWhenPresent: 15,
      lift: 0.07,
      winRateWhenPresent: 0.6,
      winRateWhenAbsent: 0.53,
    });
    const p = computeScorerProposal(report([f]), null);
    expect(p.changes[0].action).toBe("weaken");
    expect(p.changes[0].rationale.toLowerCase()).toContain("trim");
  });

  test("undersized weight (|w|<=3, |lift|>0.25) → strengthen", () => {
    const f = fa({
      label: "Underlever",
      avgWeightWhenPresent: 2,
      lift: 0.35,
      winRateWhenPresent: 0.75,
      winRateWhenAbsent: 0.4,
    });
    const p = computeScorerProposal(report([f]), null);
    expect(p.changes[0].action).toBe("strengthen");
    expect(p.changes[0].rationale.toLowerCase()).toContain("raise");
  });

  test("matched direction → keep", () => {
    // weight=4, lift=0.2 — neither over nor under, not low-leverage
    const f = fa({
      label: "Matched",
      avgWeightWhenPresent: 4,
      lift: 0.2,
      winRateWhenPresent: 0.7,
      winRateWhenAbsent: 0.5,
    });
    const p = computeScorerProposal(report([f]), null);
    expect(p.changes[0].action).toBe("keep");
    expect(p.changes[0].rationale.toLowerCase()).toContain("no change");
  });

  test("low-confidence factor → keep with 'insufficient' rationale", () => {
    const f = fa({
      label: "Thin",
      lowConfidence: true,
      present: 2,
      absent: 2,
    });
    const p = computeScorerProposal(report([f]), null);
    expect(p.changes[0].action).toBe("keep");
    expect(p.changes[0].rationale.toLowerCase()).toContain("insufficient");
  });

  test("null lift → keep", () => {
    const f = fa({
      label: "Null lift",
      lift: null,
      lowConfidence: true,
      present: 20,
      absent: 0,
    });
    const p = computeScorerProposal(report([f]), null);
    expect(p.changes[0].action).toBe("keep");
  });
});

describe("computeScorerProposal — headline + sort", () => {
  test("headline counts actionables", () => {
    const changes = [
      fa({ label: "a", avgWeightWhenPresent: 5, lift: 0.02 }), // drop
      fa({ label: "b", avgWeightWhenPresent: 4, lift: 0.2 }),  // keep
      fa({ label: "c", avgWeightWhenPresent: 15, lift: 0.07 }), // weaken
    ];
    const p = computeScorerProposal(report(changes), null);
    expect(p.headline).toContain("2 of 3");
    expect(p.headline.toLowerCase()).toContain("recommended change");
  });

  test("all-keep headline", () => {
    const changes = [
      fa({ label: "a", avgWeightWhenPresent: 4, lift: 0.2 }),
      fa({ label: "b", avgWeightWhenPresent: 4, lift: 0.2 }),
    ];
    const p = computeScorerProposal(report(changes), null);
    expect(p.headline.toLowerCase()).toContain("within tolerance");
  });

  test("flip sorts above strengthen > weaken > drop > keep", () => {
    const factors = [
      fa({ label: "keep1", avgWeightWhenPresent: 4, lift: 0.2 }),
      fa({ label: "drop1", avgWeightWhenPresent: 5, lift: 0.02 }),
      fa({ label: "weaken1", avgWeightWhenPresent: 15, lift: 0.07 }),
      fa({ label: "strengthen1", avgWeightWhenPresent: 2, lift: 0.35 }),
      fa({
        label: "flip1",
        avgWeightWhenPresent: 8,
        lift: -0.3,
        winRateWhenPresent: 0.2,
        winRateWhenAbsent: 0.5,
      }),
    ];
    const p = computeScorerProposal(report(factors), null);
    const actions = p.changes.map((c) => c.action);
    expect(actions).toEqual(["flip", "strengthen", "weaken", "drop", "keep"]);
  });

  test("empty factors → directional headline, lowConfidence true", () => {
    const p = computeScorerProposal(report([], 0), null);
    expect(p.lowConfidence).toBe(true);
    expect(p.changes).toHaveLength(0);
    expect(p.headline.toLowerCase()).toContain("not enough");
  });
});

describe("shadow corroboration", () => {
  function calib(overrides: Partial<ShadowAgreementSummary> = {}): ShadowAgreementSummary {
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

  test("shadow winning ≥60% → 'corroborated' copy", () => {
    const p = computeScorerProposal(
      report([fa({ avgWeightWhenPresent: 5, lift: 0.3 })]),
      calib(),
    );
    expect(p.shadowCorroboration?.toLowerCase()).toContain("corroborated");
    expect(p.shadowCorroboration).toContain("7/10");
  });

  test("shadow losing ≤40% → 'caveat' copy", () => {
    const p = computeScorerProposal(
      report([fa()]),
      calib({
        shadowWonDisagreementCount: 3,
        shadowDisagreementWinRate: 0.3,
      }),
    );
    expect(p.shadowCorroboration?.toLowerCase()).toContain("caveat");
    expect(p.shadowCorroboration?.toLowerCase()).toContain("lean on");
  });

  test("shadow coin-flip → 'neither corroborates nor undercuts'", () => {
    const p = computeScorerProposal(
      report([fa()]),
      calib({
        shadowWonDisagreementCount: 5,
        shadowDisagreementWinRate: 0.5,
      }),
    );
    expect(p.shadowCorroboration?.toLowerCase()).toContain("neither");
  });

  test("null calibration → null corroboration", () => {
    const p = computeScorerProposal(report([fa()]), null);
    expect(p.shadowCorroboration).toBe(null);
  });

  test("low-confidence calibration → null corroboration", () => {
    const p = computeScorerProposal(report([fa()]), calib({ lowConfidence: true }));
    expect(p.shadowCorroboration).toBe(null);
  });

  test("no disagreements logged → null corroboration", () => {
    const p = computeScorerProposal(
      report([fa()]),
      calib({
        disagreementCount: 0,
        shadowWonDisagreementCount: 0,
        shadowDisagreementWinRate: null,
      }),
    );
    expect(p.shadowCorroboration).toBe(null);
  });
});

describe("renderScorerProposalMarkdown", () => {
  test("emits headline, sections, and low-confidence warning", () => {
    const p = computeScorerProposal(
      report(
        [
          fa({
            label: "Big miss",
            avgWeightWhenPresent: 8,
            lift: -0.3,
            winRateWhenPresent: 0.2,
            winRateWhenAbsent: 0.5,
          }),
          fa({ label: "Matched", avgWeightWhenPresent: 4, lift: 0.2 }),
        ],
        5, // lowConfidence
      ),
      null,
    );
    const md = renderScorerProposalMarkdown(p);
    expect(md).toContain("## Scorer Evolution Proposal");
    expect(md).toContain("### Recommended changes");
    expect(md).toContain("### Keep as-is");
    expect(md).toContain("FLIP");
    expect(md).toContain("`Big miss`");
    expect(md).toContain("⚠");
  });

  test("shadow corroboration renders its own section", () => {
    const p = computeScorerProposal(
      report([fa({ avgWeightWhenPresent: 5, lift: 0.3 })]),
      {
        totalDeals: 30,
        shadowAbstainCount: 0,
        scorableDeals: 30,
        ruleAgreedCount: 18,
        shadowAgreedCount: 20,
        ruleAgreementRate: 0.6,
        shadowAgreementRate: 0.67,
        disagreementCount: 10,
        shadowWonDisagreementCount: 8,
        shadowDisagreementWinRate: 0.8,
        lowConfidence: false,
      },
    );
    const md = renderScorerProposalMarkdown(p);
    expect(md).toContain("### Shadow K-NN corroboration");
    expect(md).toContain("Corroborated");
  });

  test("no actionables → skips Recommended changes section", () => {
    const p = computeScorerProposal(
      report([fa({ avgWeightWhenPresent: 4, lift: 0.2 })]),
      null,
    );
    const md = renderScorerProposalMarkdown(p);
    expect(md).not.toContain("### Recommended changes");
    expect(md).toContain("### Keep as-is");
  });
});
