/**
 * Ensemble Win Probability tests — Slice 20q.
 *
 * The tests pressure every branch of the decision tree because this
 * module is the one that DECIDES which number the rep sees. If we
 * quietly promote a coin-flip shadow over a 70%-accurate rule scorer,
 * that's a silent accuracy regression with no incident to investigate
 * — the ensemble must refuse to do that.
 *
 * Coverage:
 *
 *   • Branch 1 (no shadow): rule-only fallback, no explanation noise.
 *   • Branch 1' (shadow lowConfidence): same — we don't blend signal
 *     with its own abstention flag.
 *   • Branch 2 (null summary / low-confidence summary): `calibration-
 *     thin` with a "blend pending" explanation so the UI can show
 *     something honest instead of hiding the shadow entirely.
 *   • Branch 3 (both below chance): rule-only, explanation names the
 *     accuracies so a reviewer can see why.
 *   • Branch 4a (only rule qualifies): rule-only + "shadow hasn't
 *     earned weight" copy.
 *   • Branch 4b (only shadow qualifies): shadow-only, rare but handled.
 *   • Branch 5 (both qualify): skill-proportional weights; ensemble
 *     math checks out to the integer; explanation cites the split.
 *   • Clamp honesty: blended score that math would put at 97 clamps
 *     to 95, matching the scorer's ceiling.
 *   • Headline copy adapts per reason.
 */

import { describe, expect, test } from "bun:test";
import {
  computeEnsembleWinProbability,
  describeEnsembleHeadline,
  MIN_SKILL_FOR_ENSEMBLE,
} from "../ensemble-win-probability";
import type { ShadowScoreResult } from "../shadow-score";
import type { ShadowAgreementSummary } from "../retrospective-shadow";

function shadow(overrides: Partial<ShadowScoreResult> = {}): ShadowScoreResult {
  return {
    shadowScore: 60,
    kUsed: 10,
    meanDistance: 3,
    lowConfidence: false,
    reason: "ok",
    neighbors: [],
    ...overrides,
  };
}

function summary(
  overrides: Partial<ShadowAgreementSummary> = {},
): ShadowAgreementSummary {
  return {
    totalDeals: 30,
    shadowAbstainCount: 0,
    scorableDeals: 30,
    ruleAgreedCount: 21,
    shadowAgreedCount: 18,
    ruleAgreementRate: 0.7,
    shadowAgreementRate: 0.6,
    disagreementCount: 10,
    shadowWonDisagreementCount: 5,
    shadowDisagreementWinRate: 0.5,
    lowConfidence: false,
    ...overrides,
  };
}

describe("computeEnsembleWinProbability — branch 1: no / low-confidence shadow", () => {
  test("null shadow → rule-only, no explanation", () => {
    const r = computeEnsembleWinProbability(72, null, summary());
    expect(r.reason).toBe("rule-only");
    expect(r.ensembleScore).toBe(72);
    expect(r.ruleWeight).toBe(1);
    expect(r.shadowWeight).toBe(0);
    expect(r.explanation).toBe(null);
    expect(r.lowConfidence).toBe(true);
  });

  test("shadow.lowConfidence → rule-only, no explanation", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow({ lowConfidence: true, reason: "sparse-sample" }),
      summary(),
    );
    expect(r.reason).toBe("rule-only");
    expect(r.ensembleScore).toBe(72);
    expect(r.explanation).toBe(null);
  });

  test("live score is clamped even in rule-only fallback", () => {
    // Live score above the 95 ceiling gets brought down; a consumer
    // passing raw/unclamped shouldn't be able to surface 100+ through
    // the ensemble.
    const r = computeEnsembleWinProbability(120, null, summary());
    expect(r.ensembleScore).toBe(95);
  });
});

describe("computeEnsembleWinProbability — branch 2: thin calibration", () => {
  test("null summary → calibration-thin with explanation naming the shadow score", () => {
    const r = computeEnsembleWinProbability(72, shadow({ shadowScore: 58 }), null);
    expect(r.reason).toBe("calibration-thin");
    expect(r.ensembleScore).toBe(72);
    expect(r.explanation).toContain("58");
    expect(r.explanation?.toLowerCase()).toContain("calibration");
    expect(r.lowConfidence).toBe(true);
  });

  test("lowConfidence summary → calibration-thin", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow({ shadowScore: 58 }),
      summary({ lowConfidence: true, scorableDeals: 6 }),
    );
    expect(r.reason).toBe("calibration-thin");
    expect(r.ensembleScore).toBe(72);
  });

  test("summary with null agreement rates → calibration-thin", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow(),
      summary({ ruleAgreementRate: null, shadowAgreementRate: null, scorableDeals: 0 }),
    );
    expect(r.reason).toBe("calibration-thin");
  });
});

describe("computeEnsembleWinProbability — branch 3: neither model above chance", () => {
  test("both 50% accurate → rule-only, explanation cites both rates", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow({ shadowScore: 58 }),
      summary({ ruleAgreementRate: 0.5, shadowAgreementRate: 0.5 }),
    );
    expect(r.reason).toBe("rule-only");
    expect(r.ensembleScore).toBe(72);
    expect(r.explanation).toContain("50%");
    expect(r.explanation?.toLowerCase()).toContain("coin-flip");
  });

  test("both below chance → rule-only (still show rule even if it's bad)", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow(),
      summary({ ruleAgreementRate: 0.45, shadowAgreementRate: 0.48 }),
    );
    expect(r.reason).toBe("rule-only");
    expect(r.ensembleScore).toBe(72);
  });
});

describe("computeEnsembleWinProbability — branch 4: exactly one qualifies", () => {
  test("rule above, shadow at chance → rule wins outright", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow({ shadowScore: 40 }),
      summary({ ruleAgreementRate: 0.7, shadowAgreementRate: 0.5 }),
    );
    expect(r.reason).toBe("rule-only");
    expect(r.ensembleScore).toBe(72);
    expect(r.ruleWeight).toBe(1);
    expect(r.shadowWeight).toBe(0);
    expect(r.lowConfidence).toBe(false);
    expect(r.explanation).toContain("70%");
    expect(r.explanation).toContain("50%");
  });

  test("shadow above, rule at chance → shadow wins outright", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow({ shadowScore: 40 }),
      summary({ ruleAgreementRate: 0.5, shadowAgreementRate: 0.7 }),
    );
    expect(r.reason).toBe("shadow-only");
    expect(r.ensembleScore).toBe(40);
    expect(r.ruleWeight).toBe(0);
    expect(r.shadowWeight).toBe(1);
    expect(r.explanation?.toLowerCase()).toContain("shadow");
  });

  test("shadow just above chance threshold qualifies", () => {
    // shadowSkill = 0.5 + MIN_SKILL_FOR_ENSEMBLE - 0.5 = MIN_SKILL_FOR_ENSEMBLE
    const r = computeEnsembleWinProbability(
      50,
      shadow({ shadowScore: 80 }),
      summary({
        ruleAgreementRate: 0.5,
        shadowAgreementRate: 0.5 + MIN_SKILL_FOR_ENSEMBLE,
      }),
    );
    expect(r.reason).toBe("shadow-only");
    expect(r.ensembleScore).toBe(80);
  });
});

describe("computeEnsembleWinProbability — branch 5: both qualify (blended)", () => {
  test("70/60 → 2/3 weight on rule, 1/3 on shadow", () => {
    // ruleSkill = 0.20, shadowSkill = 0.10 → total 0.30
    // ruleWeight = 0.20/0.30 = 0.6667, shadowWeight = 0.3333
    const r = computeEnsembleWinProbability(
      72,
      shadow({ shadowScore: 45 }),
      summary({ ruleAgreementRate: 0.7, shadowAgreementRate: 0.6 }),
    );
    expect(r.reason).toBe("blended");
    expect(r.ruleWeight).toBeCloseTo(2 / 3, 3);
    expect(r.shadowWeight).toBeCloseTo(1 / 3, 3);
    // raw = 72 * 2/3 + 45 * 1/3 = 48 + 15 = 63
    expect(r.ensembleScore).toBe(63);
  });

  test("equal above-chance skill → 50/50 blend", () => {
    // ruleSkill = shadowSkill = 0.15 → weights 0.5 each
    const r = computeEnsembleWinProbability(
      80,
      shadow({ shadowScore: 60 }),
      summary({ ruleAgreementRate: 0.65, shadowAgreementRate: 0.65 }),
    );
    expect(r.reason).toBe("blended");
    expect(r.ruleWeight).toBeCloseTo(0.5, 3);
    expect(r.shadowWeight).toBeCloseTo(0.5, 3);
    expect(r.ensembleScore).toBe(70); // (80 + 60) / 2
  });

  test("explanation cites the 100-point split + sample size", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow({ shadowScore: 45 }),
      summary({
        ruleAgreementRate: 0.7,
        shadowAgreementRate: 0.6,
        scorableDeals: 30,
      }),
    );
    expect(r.explanation).toContain("67/33");
    expect(r.explanation).toContain("70%");
    expect(r.explanation).toContain("60%");
    expect(r.explanation).toContain("30");
  });

  test("blend clamps at ceiling [5, 95]", () => {
    // live=99 (inside clamp), shadow=99, any weights → ensemble ~99 → clamp 95
    const r = computeEnsembleWinProbability(
      99,
      shadow({ shadowScore: 99 }),
      summary({ ruleAgreementRate: 0.7, shadowAgreementRate: 0.6 }),
    );
    expect(r.ensembleScore).toBe(95);
  });

  test("blend clamps at floor [5, 95]", () => {
    const r = computeEnsembleWinProbability(
      1,
      shadow({ shadowScore: 1 }),
      summary({ ruleAgreementRate: 0.7, shadowAgreementRate: 0.6 }),
    );
    expect(r.ensembleScore).toBe(5);
  });

  test("ensemble is the integer rounded correctly (no off-by-one drift)", () => {
    // ruleSkill = 0.15, shadowSkill = 0.05 → weights 0.75 / 0.25
    // 80*0.75 + 50*0.25 = 60 + 12.5 = 72.5 → Math.round → 73
    const r = computeEnsembleWinProbability(
      80,
      shadow({ shadowScore: 50 }),
      summary({ ruleAgreementRate: 0.65, shadowAgreementRate: 0.55 }),
    );
    expect(r.ensembleScore).toBe(73);
  });
});

describe("describeEnsembleHeadline", () => {
  test("blended → 'Consensus N'", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow({ shadowScore: 45 }),
      summary({ ruleAgreementRate: 0.7, shadowAgreementRate: 0.6 }),
    );
    expect(describeEnsembleHeadline(r)).toBe(`Consensus ${r.ensembleScore}`);
  });

  test("shadow-only → 'Shadow-led N'", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow({ shadowScore: 40 }),
      summary({ ruleAgreementRate: 0.5, shadowAgreementRate: 0.7 }),
    );
    expect(describeEnsembleHeadline(r)).toBe(`Shadow-led 40`);
  });

  test("rule-only with shadow → 'Rule-led N'", () => {
    const r = computeEnsembleWinProbability(
      72,
      shadow(),
      summary({ ruleAgreementRate: 0.7, shadowAgreementRate: 0.5 }),
    );
    expect(describeEnsembleHeadline(r)).toBe(`Rule-led 72`);
  });

  test("rule-only without shadow → 'Rule-led N'", () => {
    const r = computeEnsembleWinProbability(72, null, summary());
    expect(describeEnsembleHeadline(r)).toBe(`Rule-led 72`);
  });

  test("calibration-thin → 'Blend pending'", () => {
    const r = computeEnsembleWinProbability(72, shadow(), null);
    expect(describeEnsembleHeadline(r)).toBe("Blend pending");
  });
});

describe("computeEnsembleWinProbability — defensive", () => {
  test("NaN liveScore falls back to 50 via clamp", () => {
    const r = computeEnsembleWinProbability(Number.NaN, null, summary());
    expect(r.ensembleScore).toBe(50);
  });

  test("weights always sum to 1 (invariant)", () => {
    const inputs: Array<[number, ShadowScoreResult | null, ShadowAgreementSummary | null]> = [
      [72, null, summary()],
      [72, shadow({ lowConfidence: true }), summary()],
      [72, shadow(), null],
      [72, shadow(), summary({ ruleAgreementRate: 0.5, shadowAgreementRate: 0.5 })],
      [72, shadow(), summary({ ruleAgreementRate: 0.7, shadowAgreementRate: 0.5 })],
      [72, shadow(), summary({ ruleAgreementRate: 0.5, shadowAgreementRate: 0.7 })],
      [72, shadow(), summary({ ruleAgreementRate: 0.7, shadowAgreementRate: 0.6 })],
    ];
    for (const [live, s, sum] of inputs) {
      const r = computeEnsembleWinProbability(live, s, sum);
      expect(r.ruleWeight + r.shadowWeight).toBeCloseTo(1, 6);
    }
  });
});
