/**
 * Factor Verdict tests — Slice 20i.
 *
 * Verdicts are what reps see on the live scorer — if the rules here
 * are wrong we'll mislead them in real time, not just in a dashboard.
 * Cover: every isFactorSurprising case, every low-confidence case,
 * null-lift case, and the wire round-trip.
 */

import { describe, expect, test } from "bun:test";
import {
  computeFactorVerdicts,
  verdictFor,
  verdictsFromWire,
  verdictsToWire,
  type FactorVerdict,
} from "../factor-verdict";
import type { FactorAttribution } from "../factor-attribution";

function f(overrides: Partial<FactorAttribution> = {}): FactorAttribution {
  return {
    label: "F",
    present: 10,
    presentWins: 7,
    absent: 10,
    absentWins: 3,
    avgWeightWhenPresent: 5,
    lift: 0.4,
    winRateWhenPresent: 0.7,
    winRateWhenAbsent: 0.3,
    lowConfidence: false,
    ...overrides,
  };
}

describe("verdictFor", () => {
  test("positive weight + positive lift → proven", () => {
    expect(verdictFor(f({ avgWeightWhenPresent: 5, lift: 0.4 }))).toBe("proven");
  });

  test("negative weight + negative lift → proven (sign agrees)", () => {
    expect(verdictFor(f({ avgWeightWhenPresent: -4, lift: -0.3 }))).toBe("proven");
  });

  test("positive weight + negative lift → suspect", () => {
    expect(verdictFor(f({ avgWeightWhenPresent: 6, lift: -0.2 }))).toBe("suspect");
  });

  test("negative weight + positive lift → suspect", () => {
    expect(verdictFor(f({ avgWeightWhenPresent: -3, lift: 0.2 }))).toBe("suspect");
  });

  test("lowConfidence factor → unknown (even if sign agrees)", () => {
    expect(
      verdictFor(f({ avgWeightWhenPresent: 5, lift: 0.4, lowConfidence: true })),
    ).toBe("unknown");
  });

  test("null lift → unknown (not enough absent-side data)", () => {
    expect(verdictFor(f({ avgWeightWhenPresent: 5, lift: null }))).toBe("unknown");
  });

  test("weight below |1| threshold but signs agree → proven (signal still present)", () => {
    // Scorer weights are always integers ≥ ±1 in practice, but if one
    // ever lands below 1, we still want to call it proven when lift
    // has a real signal.
    expect(verdictFor(f({ avgWeightWhenPresent: 0.5, lift: 0.4 }))).toBe("proven");
  });

  test("weight near zero with disagreeing sign but |weight| < 1 → proven", () => {
    // isFactorSurprising requires |weight| >= 1 to fire, so weight 0.4
    // with negative lift is NOT surprising — verdict is proven by
    // default signal sufficiency.
    expect(verdictFor(f({ avgWeightWhenPresent: 0.4, lift: -0.2 }))).toBe("proven");
  });
});

describe("computeFactorVerdicts", () => {
  test("builds map keyed by label", () => {
    const v = computeFactorVerdicts([
      f({ label: "A", avgWeightWhenPresent: 5, lift: 0.3 }),
      f({ label: "B", avgWeightWhenPresent: 5, lift: -0.3 }),
      f({ label: "C", lowConfidence: true }),
    ]);
    expect(v.get("A")).toBe("proven");
    expect(v.get("B")).toBe("suspect");
    expect(v.get("C")).toBe("unknown");
  });

  test("drops blank-label rows", () => {
    const v = computeFactorVerdicts([
      // deno-lint-ignore no-explicit-any
      f({ label: "" }),
      f({ label: "Real" }),
    ]);
    expect(v.has("")).toBe(false);
    expect(v.get("Real")).toBe("proven");
  });

  test("empty input → empty map", () => {
    expect(computeFactorVerdicts([]).size).toBe(0);
  });
});

describe("wire round-trip", () => {
  test("toWire + fromWire preserves entries", () => {
    const original = new Map<string, FactorVerdict>([
      ["A", "proven"],
      ["B", "suspect"],
      ["C", "unknown"],
    ]);
    const wire = verdictsToWire(original);
    const parsed = verdictsFromWire(wire);
    expect(parsed.size).toBe(3);
    expect(parsed.get("A")).toBe("proven");
    expect(parsed.get("B")).toBe("suspect");
    expect(parsed.get("C")).toBe("unknown");
  });

  test("fromWire rejects non-array input", () => {
    expect(verdictsFromWire(null).size).toBe(0);
    expect(verdictsFromWire("whoops").size).toBe(0);
    expect(verdictsFromWire({ oh: "no" }).size).toBe(0);
  });

  test("fromWire drops rows with missing label or bad verdict", () => {
    const wire = [
      { label: "Good", verdict: "proven" },
      { label: "", verdict: "proven" },
      { verdict: "proven" },
      { label: "Bad", verdict: "maybe" },
      { label: "Empty" },
      null,
      "lol",
    ];
    const parsed = verdictsFromWire(wire);
    expect(parsed.size).toBe(1);
    expect(parsed.get("Good")).toBe("proven");
  });
});
