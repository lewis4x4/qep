/**
 * Shadow Callout tests — Slice 20l.
 *
 * Exhaustive around the gating logic: the whole value of this slice
 * is that it DOES NOT promote a signal when it shouldn't. Suppression
 * rules matter as much as display rules. Coverage:
 *
 *   • Gate: missing shadow → null
 *   • Gate: shadow lowConfidence → null
 *   • Gate: missing calibration → null
 *   • Gate: calibration lowConfidence → null
 *   • Gate: |delta| < threshold → null
 *   • Gate: no historical disagreements (rate=null) → null
 *   • Gate: rate < SUPPRESS_RATE → null (shadow has losing track record)
 *   • Tone: rate >= STRONG_RATE → "strong"
 *   • Tone: SUPPRESS_RATE <= rate < STRONG_RATE → "neutral"
 *   • Direction: shadow > live → "higher" + "more often" copy
 *   • Direction: shadow < live → "lower" + "less often" copy
 *   • Custom thresholds work via opts
 */

import { describe, expect, test } from "bun:test";
import {
  computeShadowCallout,
  CALLOUT_DELTA_THRESHOLD,
  STRONG_DISAGREEMENT_RATE,
  SUPPRESS_DISAGREEMENT_RATE,
} from "../shadow-callout";
import type { ShadowScoreResult } from "../shadow-score";
import type { ShadowAgreementSummary } from "../retrospective-shadow";

function shadow(overrides: Partial<ShadowScoreResult> = {}): ShadowScoreResult {
  return {
    shadowScore: 80,
    kUsed: 10,
    meanDistance: 3,
    lowConfidence: false,
    reason: "ok",
    ...overrides,
  };
}

function calibration(
  overrides: Partial<ShadowAgreementSummary> = {},
): ShadowAgreementSummary {
  return {
    totalDeals: 30,
    shadowAbstainCount: 0,
    scorableDeals: 30,
    ruleAgreedCount: 18,
    shadowAgreedCount: 20,
    ruleAgreementRate: 18 / 30,
    shadowAgreementRate: 20 / 30,
    disagreementCount: 10,
    shadowWonDisagreementCount: 7,
    shadowDisagreementWinRate: 0.7,
    lowConfidence: false,
    ...overrides,
  };
}

describe("computeShadowCallout — gates", () => {
  test("null shadow → null", () => {
    expect(computeShadowCallout(60, null, calibration())).toBe(null);
  });

  test("shadow.lowConfidence → null", () => {
    expect(
      computeShadowCallout(60, shadow({ lowConfidence: true, reason: "sparse-sample" }), calibration()),
    ).toBe(null);
  });

  test("null calibration → null", () => {
    expect(computeShadowCallout(60, shadow(), null)).toBe(null);
  });

  test("calibration.lowConfidence → null", () => {
    expect(
      computeShadowCallout(60, shadow(), calibration({ lowConfidence: true })),
    ).toBe(null);
  });

  test("|delta| < threshold → null", () => {
    // liveScore 75, shadow 85 → delta 10, below default 15
    expect(
      computeShadowCallout(75, shadow({ shadowScore: 85 }), calibration()),
    ).toBe(null);
  });

  test("disagreement-win-rate null (no history) → null", () => {
    expect(
      computeShadowCallout(
        50,
        shadow(),
        calibration({
          disagreementCount: 0,
          shadowWonDisagreementCount: 0,
          shadowDisagreementWinRate: null,
        }),
      ),
    ).toBe(null);
  });

  test("rate below suppress threshold → null", () => {
    expect(
      computeShadowCallout(
        50,
        shadow(),
        calibration({
          disagreementCount: 10,
          shadowWonDisagreementCount: 3,
          shadowDisagreementWinRate: 0.3,
        }),
      ),
    ).toBe(null);
  });

  test("rate exactly at suppress threshold → allowed through (>=)", () => {
    // rate = 0.4 → >= SUPPRESS_RATE 0.4; below STRONG 0.6 → neutral
    const c = computeShadowCallout(
      50,
      shadow(),
      calibration({
        disagreementCount: 10,
        shadowWonDisagreementCount: 4,
        shadowDisagreementWinRate: SUPPRESS_DISAGREEMENT_RATE,
      }),
    );
    expect(c).not.toBe(null);
    expect(c!.tone).toBe("neutral");
  });
});

describe("computeShadowCallout — tone + direction", () => {
  test("strong tone when rate >= STRONG_RATE (0.6) and direction=higher", () => {
    // liveScore 50, shadow 80 → delta +30
    const c = computeShadowCallout(
      50,
      shadow({ shadowScore: 80 }),
      calibration({ shadowDisagreementWinRate: 0.7 }),
    );
    expect(c).not.toBe(null);
    expect(c!.tone).toBe("strong");
    expect(c!.direction).toBe("higher");
    expect(c!.deltaPts).toBe(30);
    expect(c!.headline.toLowerCase()).toContain("more often");
  });

  test("strong tone at exactly STRONG_RATE", () => {
    const c = computeShadowCallout(
      50,
      shadow({ shadowScore: 70 }),
      calibration({ shadowDisagreementWinRate: STRONG_DISAGREEMENT_RATE }),
    );
    expect(c!.tone).toBe("strong");
  });

  test("neutral tone when SUPPRESS <= rate < STRONG and direction=lower", () => {
    // liveScore 80, shadow 50 → delta -30
    const c = computeShadowCallout(
      80,
      shadow({ shadowScore: 50 }),
      calibration({ shadowDisagreementWinRate: 0.5 }),
    );
    expect(c).not.toBe(null);
    expect(c!.tone).toBe("neutral");
    expect(c!.direction).toBe("lower");
    expect(c!.headline.toLowerCase()).toContain("disagree");
  });

  test("evidence cites measured win rate", () => {
    const c = computeShadowCallout(
      50,
      shadow({ shadowScore: 80 }),
      calibration({
        disagreementCount: 10,
        shadowWonDisagreementCount: 7,
        shadowDisagreementWinRate: 0.7,
      }),
    );
    expect(c!.evidence).toContain("7 of 10");
    expect(c!.evidence).toContain("70%");
  });

  test("delta just over threshold is honored", () => {
    // Force exactly at threshold — 15 is >= 15, should fire
    const c = computeShadowCallout(
      50,
      shadow({ shadowScore: 50 + CALLOUT_DELTA_THRESHOLD }),
      calibration(),
    );
    expect(c).not.toBe(null);
    expect(c!.deltaPts).toBe(CALLOUT_DELTA_THRESHOLD);
  });
});

describe("computeShadowCallout — custom thresholds", () => {
  test("caller can tighten deltaThreshold to 5", () => {
    // delta = 7; would be null with default 15, but with 5 it fires
    const c = computeShadowCallout(
      70,
      shadow({ shadowScore: 77 }),
      calibration(),
      { deltaThreshold: 5 },
    );
    expect(c).not.toBe(null);
    expect(c!.deltaPts).toBe(7);
  });

  test("caller can require stricter strongRate", () => {
    // rate = 0.7, default strong = 0.6 → strong. With strongRate 0.8 → neutral.
    const c = computeShadowCallout(
      50,
      shadow({ shadowScore: 80 }),
      calibration({ shadowDisagreementWinRate: 0.7 }),
      { strongRate: 0.8 },
    );
    expect(c!.tone).toBe("neutral");
  });

  test("caller can tighten suppressRate", () => {
    // rate = 0.5, default suppress = 0.4 → neutral. With suppressRate 0.6 → null.
    const c = computeShadowCallout(
      50,
      shadow({ shadowScore: 80 }),
      calibration({ shadowDisagreementWinRate: 0.5 }),
      { suppressRate: 0.6 },
    );
    expect(c).toBe(null);
  });
});
