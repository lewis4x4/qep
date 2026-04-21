/**
 * Factor Attribution tests — Slice 20g.
 *
 * Same test philosophy as scorer-calibration: the attribution math is
 * the ground truth that will drive scorer evolution PRs. If it's wrong,
 * every weight-tuning decision downstream is wrong. Cover happy paths,
 * edge cases, and all the "silently plausible but wrong" traps.
 */

import { describe, expect, test } from "bun:test";
import {
  computeFactorAttribution,
  isFactorSurprising,
  type DealFactorObservation,
  type FactorAttribution,
} from "../factor-attribution";

function factor(label: string, weight: number) {
  return { label, weight };
}

describe("computeFactorAttribution — empty + malformed inputs", () => {
  test("empty input produces empty report with lowConfidence", () => {
    const r = computeFactorAttribution([]);
    expect(r.dealsAnalyzed).toBe(0);
    expect(r.factors).toHaveLength(0);
    expect(r.lowConfidence).toBe(true);
  });

  test("rows without factor arrays are filtered out", () => {
    const deals: DealFactorObservation[] = [
      // deno-lint-ignore no-explicit-any
      { factors: null as any, outcome: "won" },
      // deno-lint-ignore no-explicit-any
      { factors: "not-an-array" as any, outcome: "lost" },
      { factors: [factor("A", 5)], outcome: "won" },
    ];
    const r = computeFactorAttribution(deals);
    expect(r.dealsAnalyzed).toBe(1);
  });

  test("unknown outcomes are filtered out (skipped rows especially)", () => {
    const deals: DealFactorObservation[] = [
      // deno-lint-ignore no-explicit-any
      { factors: [factor("A", 5)], outcome: "skipped" as any },
      { factors: [factor("A", 5)], outcome: "won" },
    ];
    const r = computeFactorAttribution(deals);
    expect(r.dealsAnalyzed).toBe(1);
  });

  test("blank-label factors are ignored but the deal itself still counts", () => {
    const deals: DealFactorObservation[] = [
      { factors: [factor("", 5), factor("A", 3)], outcome: "won" },
      { factors: [factor("A", 3)], outcome: "lost" },
    ];
    const r = computeFactorAttribution(deals);
    expect(r.dealsAnalyzed).toBe(2);
    expect(r.factors.map((f) => f.label)).toEqual(["A"]);
  });
});

describe("computeFactorAttribution — per-factor correctness", () => {
  test("present / absent counts are correct when a factor fires in some deals", () => {
    const deals: DealFactorObservation[] = [
      { factors: [factor("Trade in hand", 10)], outcome: "won" },
      { factors: [factor("Trade in hand", 10)], outcome: "won" },
      { factors: [factor("Trade in hand", 10)], outcome: "lost" },
      { factors: [], outcome: "lost" },
      { factors: [], outcome: "lost" },
    ];
    const r = computeFactorAttribution(deals);
    const trade = r.factors.find((f) => f.label === "Trade in hand")!;
    expect(trade.present).toBe(3);
    expect(trade.presentWins).toBe(2);
    expect(trade.absent).toBe(2);
    expect(trade.absentWins).toBe(0);
    expect(trade.winRateWhenPresent).toBeCloseTo(2 / 3, 5);
    expect(trade.winRateWhenAbsent).toBe(0);
    expect(trade.lift).toBeCloseTo(2 / 3, 5);
  });

  test("lift is null when one side has zero observations (factor fires on every deal)", () => {
    const deals: DealFactorObservation[] = [
      { factors: [factor("Always", 5)], outcome: "won" },
      { factors: [factor("Always", 5)], outcome: "lost" },
      { factors: [factor("Always", 5)], outcome: "won" },
    ];
    const r = computeFactorAttribution(deals);
    const always = r.factors.find((f) => f.label === "Always")!;
    expect(always.absent).toBe(0);
    expect(always.winRateWhenAbsent).toBeNull();
    expect(always.lift).toBeNull();
  });

  test("avg weight when present is the signed mean of observed weights", () => {
    const deals: DealFactorObservation[] = [
      { factors: [factor("F", 6)], outcome: "won" },
      { factors: [factor("F", 2)], outcome: "lost" },
      { factors: [factor("F", 4)], outcome: "won" },
      { factors: [], outcome: "lost" },
    ];
    const r = computeFactorAttribution(deals);
    const f = r.factors.find((f) => f.label === "F")!;
    expect(f.avgWeightWhenPresent).toBe((6 + 2 + 4) / 3);
  });
});

describe("computeFactorAttribution — sorting + confidence", () => {
  test("factors sort by |lift| descending; null lifts sink", () => {
    const deals: DealFactorObservation[] = [
      // "Big" factor: strong positive lift
      { factors: [factor("Big", 5)], outcome: "won" },
      { factors: [factor("Big", 5)], outcome: "won" },
      { factors: [factor("Big", 5)], outcome: "won" },
      { factors: [], outcome: "lost" },
      { factors: [], outcome: "lost" },
      { factors: [], outcome: "lost" },
      // "Small" factor: weak positive lift, appears on all 6 of above plus
      // one solo loss (absent case exists but small delta)
      { factors: [factor("Small", 1), factor("Big", 5)], outcome: "won" },
      { factors: [factor("Small", 1)], outcome: "lost" },
      // "Ubiquitous" factor: fires on every deal — lift undefined
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        factors: [factor("Ubiquitous", 2)],
        outcome: (i % 2 === 0 ? "won" : "lost") as "won" | "lost",
      })),
    ];
    const r = computeFactorAttribution(deals);
    const bigIdx = r.factors.findIndex((f) => f.label === "Big");
    const smallIdx = r.factors.findIndex((f) => f.label === "Small");
    const ubiqIdx = r.factors.findIndex((f) => f.label === "Ubiquitous");
    expect(bigIdx).toBeLessThan(smallIdx); // Big has larger lift than Small
    expect(smallIdx).toBeLessThan(ubiqIdx); // Ubiquitous has null lift, sinks
  });

  test("aggregate lowConfidence flag fires when dealsAnalyzed < 10", () => {
    const nine: DealFactorObservation[] = Array.from({ length: 9 }, () => ({
      factors: [factor("F", 1)],
      outcome: "won" as const,
    }));
    expect(computeFactorAttribution(nine).lowConfidence).toBe(true);

    const ten: DealFactorObservation[] = Array.from({ length: 10 }, () => ({
      factors: [factor("F", 1)],
      outcome: "won" as const,
    }));
    expect(computeFactorAttribution(ten).lowConfidence).toBe(false);
  });

  test("per-factor lowConfidence fires when either side has fewer than 3 obs", () => {
    // F1 fires on 2 deals, absent on 2 → present=2 < 3 → low confidence
    const deals: DealFactorObservation[] = [
      { factors: [factor("F1", 5)], outcome: "won" },
      { factors: [factor("F1", 5)], outcome: "lost" },
      { factors: [], outcome: "won" },
      { factors: [], outcome: "lost" },
    ];
    const r = computeFactorAttribution(deals);
    const f1 = r.factors.find((f) => f.label === "F1")!;
    expect(f1.present).toBe(2);
    expect(f1.lowConfidence).toBe(true);
  });
});

describe("isFactorSurprising", () => {
  const base: FactorAttribution = {
    label: "F",
    present: 10,
    presentWins: 5,
    absent: 10,
    absentWins: 5,
    avgWeightWhenPresent: 0,
    lift: 0,
    winRateWhenPresent: 0.5,
    winRateWhenAbsent: 0.5,
    lowConfidence: false,
  };

  test("positive weight + negative lift → surprising", () => {
    expect(isFactorSurprising({ ...base, avgWeightWhenPresent: 5, lift: -0.2 })).toBe(true);
  });

  test("negative weight + positive lift → surprising", () => {
    expect(isFactorSurprising({ ...base, avgWeightWhenPresent: -3, lift: 0.3 })).toBe(true);
  });

  test("positive weight + positive lift → not surprising", () => {
    expect(isFactorSurprising({ ...base, avgWeightWhenPresent: 5, lift: 0.2 })).toBe(false);
  });

  test("null lift is never surprising (no data to disagree)", () => {
    expect(isFactorSurprising({ ...base, avgWeightWhenPresent: 5, lift: null })).toBe(false);
  });

  test("low-confidence rows are never surprising (not enough data to trust the disagreement)", () => {
    expect(
      isFactorSurprising({ ...base, avgWeightWhenPresent: 5, lift: -0.5, lowConfidence: true }),
    ).toBe(false);
  });
});
