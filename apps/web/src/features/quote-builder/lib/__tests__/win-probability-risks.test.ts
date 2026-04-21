/**
 * Win-Probability Risk tests — Slice 20n.
 *
 * The risks surface is the rep's downside x-ray: what is the deal
 * currently resting on? If the tests pass we know:
 *
 *   • Only positive-weight factors show up (negatives help removal).
 *   • MIN_RISK_DELTA filters out cosmetic support.
 *   • MAX_RISKS truncates.
 *   • Sort is by deltaPts desc.
 *   • Clamp absorption is honored — at rawScore=105 (ceiling 95),
 *     removing a +10 factor produces deltaPts=0 (→ filtered) rather
 *     than a phantom "-10" nobody feels.
 *   • Floor-edge parity: at rawScore=5 (floor), removing negative
 *     drag doesn't confuse the risks list (it's not a risk anyway).
 *   • Headline copy adapts to 0/1/many risks.
 */

import { describe, expect, test } from "bun:test";
import {
  computeWinProbabilityRisks,
  describeRisksHeadline,
  MAX_RISKS,
  MIN_RISK_DELTA,
} from "../win-probability-risks";
import type {
  WinProbabilityFactor,
  WinProbabilityResult,
} from "../win-probability-scorer";

function factor(overrides: Partial<WinProbabilityFactor> = {}): WinProbabilityFactor {
  return {
    label: "F",
    weight: 10,
    rationale: "r",
    kind: "relationship",
    ...overrides,
  };
}

function result(overrides: Partial<WinProbabilityResult> = {}): WinProbabilityResult {
  const factors = overrides.factors ?? [];
  const rawFromFactors = 40 + factors.reduce((a, f) => a + f.weight, 0);
  const rawScore = overrides.rawScore ?? rawFromFactors;
  const clamped = Math.max(5, Math.min(95, Math.round(rawScore)));
  return {
    score: overrides.score ?? clamped,
    band:
      overrides.band ??
      (clamped >= 70 ? "strong" : clamped >= 55 ? "healthy" : clamped >= 35 ? "mixed" : "at_risk"),
    headline: overrides.headline ?? "h",
    factors,
    rawScore,
  };
}

describe("computeWinProbabilityRisks — filtering", () => {
  test("empty factors → empty risks", () => {
    expect(computeWinProbabilityRisks(result({ factors: [] }))).toEqual([]);
  });

  test("all negative factors → no risks (negatives aren't supporting)", () => {
    const r = result({
      factors: [
        factor({ label: "Dormant", weight: -10 }),
        factor({ label: "Below baseline", weight: -8 }),
      ],
    });
    expect(computeWinProbabilityRisks(r)).toEqual([]);
  });

  test("all zero-weight factors → no risks", () => {
    const r = result({
      factors: [factor({ label: "Neutral", weight: 0 })],
    });
    expect(computeWinProbabilityRisks(r)).toEqual([]);
  });

  test("positive factor below MIN_RISK_DELTA → filtered", () => {
    const r = result({
      factors: [factor({ label: "Tiny", weight: MIN_RISK_DELTA - 1 })],
    });
    expect(computeWinProbabilityRisks(r)).toEqual([]);
  });

  test("single positive factor at threshold → included", () => {
    const r = result({
      factors: [factor({ label: "Edge", weight: MIN_RISK_DELTA })],
    });
    const risks = computeWinProbabilityRisks(r);
    expect(risks).toHaveLength(1);
    expect(risks[0].deltaPts).toBe(MIN_RISK_DELTA);
  });
});

describe("computeWinProbabilityRisks — sort + truncation", () => {
  test("sorted by deltaPts descending", () => {
    const r = result({
      factors: [
        factor({ label: "Small", weight: 5 }),
        factor({ label: "Big", weight: 25 }),
        factor({ label: "Mid", weight: 12 }),
      ],
    });
    const risks = computeWinProbabilityRisks(r);
    expect(risks.map((x) => x.label)).toEqual(["Big", "Mid", "Small"]);
  });

  test("truncates to MAX_RISKS", () => {
    const factors = Array.from({ length: MAX_RISKS + 2 }, (_, i) =>
      factor({ label: `F${i}`, weight: 10 + i }),
    );
    const r = result({ factors });
    const risks = computeWinProbabilityRisks(r);
    expect(risks).toHaveLength(MAX_RISKS);
  });

  test("negatives interleaved with positives → only positives kept, sort stable", () => {
    const r = result({
      factors: [
        factor({ label: "Drag", weight: -10 }),
        factor({ label: "Support A", weight: 15 }),
        factor({ label: "Support B", weight: 8 }),
      ],
    });
    const risks = computeWinProbabilityRisks(r);
    expect(risks.map((x) => x.label)).toEqual(["Support A", "Support B"]);
  });
});

describe("computeWinProbabilityRisks — clamp edges", () => {
  test("ceiling absorption: rawScore=105 (clamp→95), removing +10 factor deltaPts=0 → filtered", () => {
    // Rep-visible score stays at 95 whether the +10 factor is there or not,
    // so there's nothing to warn about — removing it doesn't dent the deal.
    const r = result({
      factors: [factor({ label: "Phantom", weight: 10 })],
      rawScore: 105,
      score: 95,
    });
    expect(computeWinProbabilityRisks(r)).toEqual([]);
  });

  test("ceiling partial absorption: rawScore=100, removing +10 → delta 5 (95 → 90)", () => {
    const r = result({
      factors: [factor({ label: "Trade", weight: 10 })],
      rawScore: 100,
      score: 95,
    });
    const risks = computeWinProbabilityRisks(r);
    expect(risks).toHaveLength(1);
    // rawWithout = 90 → clamp = 90 → delta = 95 - 90 = 5
    expect(risks[0].deltaPts).toBe(5);
  });

  test("floor: negatives don't register as risks even at the floor", () => {
    // rawScore dragged well below 5, clamp to 5. Positive factor contribution
    // is fully visible because removing it would lower rawScore further
    // (still clamped at 5) — deltaPts=0 → filtered.
    const r = result({
      factors: [
        factor({ label: "Warm", weight: 8 }),
        factor({ label: "Cold", weight: -30 }),
      ],
      rawScore: -20, // 40 + 8 - 30 + extra drag; test uses explicit rawScore
      score: 5,
    });
    const risks = computeWinProbabilityRisks(r);
    // Warm's +8 is absorbed by the floor, so no risk surfaces — the score
    // is already at the floor, removing warmth wouldn't lower it further.
    expect(risks).toEqual([]);
  });
});

describe("computeWinProbabilityRisks — payload shape", () => {
  test("carries label, kind, rationale citing the deltaPts + baseline", () => {
    const r = result({
      factors: [factor({ label: "Warm customer", weight: 25, kind: "relationship" })],
    });
    const risks = computeWinProbabilityRisks(r);
    expect(risks[0].label).toBe("Warm customer");
    expect(risks[0].kind).toBe("relationship");
    expect(risks[0].deltaPts).toBe(25);
    expect(risks[0].rationale.toLowerCase()).toContain("warm customer");
    expect(risks[0].rationale).toContain("25");
  });

  test("rationale includes baseline score for context", () => {
    const r = result({
      factors: [factor({ label: "Trade in hand", weight: 10 })],
    });
    const risks = computeWinProbabilityRisks(r);
    // baselineScore defaults from factors: 40 + 10 = 50 → clamped 50
    expect(risks[0].rationale).toContain("50");
  });
});

describe("describeRisksHeadline", () => {
  test("empty risks → null (UI hides row)", () => {
    expect(describeRisksHeadline([])).toBe(null);
  });

  test("single risk → lowercases label inline + cites its delta", () => {
    const r = result({ factors: [factor({ label: "Warm customer", weight: 25 })] });
    const risks = computeWinProbabilityRisks(r);
    const headline = describeRisksHeadline(risks)!;
    expect(headline).not.toBe(null);
    expect(headline).toContain("warm customer");
    expect(headline).toContain("25");
    expect(headline.toLowerCase()).toContain("slips");
  });

  test("multiple risks → cites count + total exposure", () => {
    const r = result({
      factors: [
        factor({ label: "Warm customer", weight: 25 }),
        factor({ label: "Trade in hand", weight: 10 }),
        factor({ label: "Above baseline margin", weight: 5 }),
      ],
    });
    const risks = computeWinProbabilityRisks(r);
    const headline = describeRisksHeadline(risks)!;
    expect(headline).toContain("3");
    // Total exposure = 25 + 10 + 5 = 40 (no clamp absorption here — raw = 80)
    expect(headline).toContain("40");
  });
});
