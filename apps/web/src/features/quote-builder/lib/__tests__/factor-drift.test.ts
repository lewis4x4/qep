/**
 * Factor Drift tests — Slice 20r.
 *
 * The drift math is the feedback loop that keeps the rule scorer honest
 * over time. If these numbers lie, a manager acts on a phantom signal,
 * so every branch of the windowing + classification tree gets pinned
 * here with deterministic fixtures. Reference "now" is injected via
 * `referenceDateMs` so the tests don't drift with the wall clock.
 */

import { describe, expect, test } from "bun:test";
import {
  computeFactorDrift,
  describeDriftHeadline,
  describeDriftRationale,
  DEFAULT_DRIFT_WINDOW_DAYS,
  MIN_DRIFT_DELTA,
  MIN_DEALS_PER_WINDOW,
  type FactorDrift,
} from "../factor-drift";
import type { ClosedDealAuditRow } from "../closed-deals-audit";

/** Deterministic reference "now" — 2026-01-01T00:00:00Z. */
const REF_MS = Date.parse("2026-01-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function row(
  packageId: string,
  daysAgo: number,
  outcome: "won" | "lost" | "expired",
  factors: Array<{ label: string; weight: number }>,
  score = 60,
): ClosedDealAuditRow {
  return {
    packageId,
    score,
    outcome,
    factors,
    capturedAt: new Date(REF_MS - daysAgo * DAY).toISOString(),
  };
}

function f(label: string, weight: number) {
  return { label, weight };
}

/**
 * Build a block of N rows all on the same `daysAgo` offset, alternating
 * between "factor present + outcome" and "factor absent + outcome" so
 * factor-attribution can compute lift meaningfully.
 */
function block(
  prefix: string,
  daysAgo: number,
  specs: Array<{
    present: boolean;
    outcome: "won" | "lost" | "expired";
    count: number;
    label: string;
    weight?: number;
  }>,
): ClosedDealAuditRow[] {
  const out: ClosedDealAuditRow[] = [];
  let i = 0;
  for (const s of specs) {
    for (let k = 0; k < s.count; k++) {
      out.push(
        row(
          `${prefix}-${i++}`,
          daysAgo,
          s.outcome,
          s.present ? [f(s.label, s.weight ?? 5)] : [],
        ),
      );
    }
  }
  return out;
}

describe("computeFactorDrift — constants", () => {
  test("exports the documented defaults", () => {
    expect(DEFAULT_DRIFT_WINDOW_DAYS).toBe(90);
    expect(MIN_DRIFT_DELTA).toBeCloseTo(0.1, 10);
    expect(MIN_DEALS_PER_WINDOW).toBe(10);
  });
});

describe("computeFactorDrift — empty / malformed input", () => {
  test("empty input returns zero-drift, lowConfidence report", () => {
    const r = computeFactorDrift([], { referenceDateMs: REF_MS });
    expect(r.drifts).toHaveLength(0);
    expect(r.recentN).toBe(0);
    expect(r.priorN).toBe(0);
    expect(r.lowConfidence).toBe(true);
    expect(r.windowDays).toBe(DEFAULT_DRIFT_WINDOW_DAYS);
  });

  test("null / undefined input is safe", () => {
    // deno-lint-ignore no-explicit-any
    const a = computeFactorDrift(null as any, { referenceDateMs: REF_MS });
    // deno-lint-ignore no-explicit-any
    const b = computeFactorDrift(undefined as any, { referenceDateMs: REF_MS });
    expect(a.drifts).toHaveLength(0);
    expect(b.drifts).toHaveLength(0);
    expect(a.lowConfidence).toBe(true);
    expect(b.lowConfidence).toBe(true);
  });

  test("rows with null / unparseable capturedAt are excluded from windowing", () => {
    const rows: ClosedDealAuditRow[] = [
      { packageId: "a", score: 60, outcome: "won", factors: [f("A", 5)], capturedAt: null },
      { packageId: "b", score: 60, outcome: "lost", factors: [f("A", 5)], capturedAt: "not-a-date" },
      { packageId: "c", score: 60, outcome: "won", factors: [f("A", 5)], capturedAt: "" },
    ];
    const r = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(r.recentN).toBe(0);
    expect(r.priorN).toBe(0);
  });

  test("rows with non-array factors or unknown outcomes are excluded", () => {
    const rows: ClosedDealAuditRow[] = [
      // deno-lint-ignore no-explicit-any
      { packageId: "a", score: 60, outcome: "won", factors: null as any, capturedAt: new Date(REF_MS - 5 * DAY).toISOString() },
      // deno-lint-ignore no-explicit-any
      { packageId: "b", score: 60, outcome: "skipped" as any, factors: [f("A", 5)], capturedAt: new Date(REF_MS - 5 * DAY).toISOString() },
      { packageId: "c", score: 60, outcome: "won", factors: [f("A", 5)], capturedAt: new Date(REF_MS - 5 * DAY).toISOString() },
    ];
    const r = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(r.recentN).toBe(1);
    expect(r.priorN).toBe(0);
  });
});

describe("computeFactorDrift — windowing", () => {
  test("rows within windowDays go into recent, older rows into prior", () => {
    const rows = [
      row("a", 10, "won", [f("A", 5)]),
      row("b", 60, "lost", [f("A", 5)]),
      row("c", 100, "won", [f("A", 5)]),
      row("d", 200, "lost", [f("A", 5)]),
    ];
    const r = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(r.recentN).toBe(2);
    expect(r.priorN).toBe(2);
  });

  test("row exactly at cutoff (windowDays days ago) is classified as recent", () => {
    // cutoff = REF_MS - windowDays*DAY; ms >= cutoff → recent.
    const rows = [row("boundary", DEFAULT_DRIFT_WINDOW_DAYS, "won", [f("A", 5)])];
    const r = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(r.recentN).toBe(1);
    expect(r.priorN).toBe(0);
  });

  test("custom windowDays narrows the recent window", () => {
    const rows = [
      row("a", 10, "won", [f("A", 5)]),
      row("b", 60, "lost", [f("A", 5)]),
    ];
    const r = computeFactorDrift(rows, { referenceDateMs: REF_MS, windowDays: 30 });
    expect(r.recentN).toBe(1);
    expect(r.priorN).toBe(1);
    expect(r.windowDays).toBe(30);
  });

  test("referenceDate is echoed back as ISO", () => {
    const r = computeFactorDrift([], { referenceDateMs: REF_MS });
    expect(r.referenceDate).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("computeFactorDrift — direction classification", () => {
  // Shared "prior window is neutral for A" helper:
  // 5 with A won, 5 with A lost → present wr = 0.5
  // 5 no-factor won, 5 no-factor lost → absent wr = 0.5
  // → prior A lift = 0
  function priorNeutralA(): ClosedDealAuditRow[] {
    return [
      ...block("prior-n", 120, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: true, outcome: "lost", count: 5, label: "A" },
        { present: false, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
    ];
  }

  test("rising: recent has strong tailwind, prior was neutral", () => {
    const rows = [
      // Recent: 5 A-won + 5 no-factor-lost → A lift = 1.0 - 0.0 = 1.0
      ...block("r", 20, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
      ...priorNeutralA(),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.drifts).toHaveLength(1);
    const d = report.drifts[0];
    expect(d.label).toBe("A");
    expect(d.direction).toBe("rising");
    expect(d.recentLift).toBeCloseTo(1.0, 5);
    expect(d.priorLift).toBeCloseTo(0.0, 5);
    expect(d.drift).toBeCloseTo(1.0, 5);
  });

  test("falling: recent is neutral, prior was a tailwind", () => {
    const rows = [
      // Recent neutral: 5 A-won, 5 A-lost, 5 no-factor-won, 5 no-factor-lost
      ...block("r", 20, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: true, outcome: "lost", count: 5, label: "A" },
        { present: false, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
      // Prior strong tailwind: lift = 1.0
      ...block("p", 120, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.drifts).toHaveLength(1);
    const d = report.drifts[0];
    expect(d.direction).toBe("falling");
    expect(d.recentLift).toBeCloseTo(0.0, 5);
    expect(d.priorLift).toBeCloseTo(1.0, 5);
    expect(d.drift).toBeCloseTo(-1.0, 5);
  });

  test("flipped: tailwind → headwind (sign change) takes precedence over falling", () => {
    const rows = [
      // Recent headwind: lift = 0.0 - 1.0 = -1.0
      ...block("r", 20, [
        { present: true, outcome: "lost", count: 5, label: "A" },
        { present: false, outcome: "won", count: 5, label: "A" },
      ]),
      // Prior tailwind: lift = 1.0
      ...block("p", 120, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.drifts).toHaveLength(1);
    const d = report.drifts[0];
    expect(d.direction).toBe("flipped");
    expect(d.drift).toBeCloseTo(-2.0, 5);
  });

  test("flipped (reverse): headwind → tailwind still classifies as flipped", () => {
    const rows = [
      // Recent tailwind
      ...block("r", 20, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
      // Prior headwind
      ...block("p", 120, [
        { present: true, outcome: "lost", count: 5, label: "A" },
        { present: false, outcome: "won", count: 5, label: "A" },
      ]),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.drifts).toHaveLength(1);
    expect(report.drifts[0].direction).toBe("flipped");
    expect(report.drifts[0].drift).toBeCloseTo(2.0, 5);
  });

  test("stable: drift below MIN_DRIFT_DELTA is filtered out", () => {
    // Recent lift = 0.2 (present wr 0.6 vs absent wr 0.4)
    // Prior  lift = 0.2 (same)
    // drift = 0 → stable → not in output
    const makeLift02 = (prefix: string, daysAgo: number) =>
      block(prefix, daysAgo, [
        { present: true, outcome: "won", count: 3, label: "A" },
        { present: true, outcome: "lost", count: 2, label: "A" },
        { present: false, outcome: "won", count: 2, label: "A" },
        { present: false, outcome: "lost", count: 3, label: "A" },
      ]);
    const rows = [...makeLift02("r", 20), ...makeLift02("p", 120)];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.drifts).toHaveLength(0);
  });

  test("custom minDriftDelta tightens the threshold", () => {
    // drift ~ 0.2 should qualify at default 0.1 but not at 0.25.
    const rows = [
      // Recent: 4 A-won + 1 A-lost + 2 absent-won + 3 absent-lost → present wr 0.8, absent wr 0.4, lift 0.4
      ...block("r", 20, [
        { present: true, outcome: "won", count: 4, label: "A" },
        { present: true, outcome: "lost", count: 1, label: "A" },
        { present: false, outcome: "won", count: 2, label: "A" },
        { present: false, outcome: "lost", count: 3, label: "A" },
      ]),
      // Prior: 3 A-won + 2 A-lost + 3 absent-won + 2 absent-lost → present wr 0.6, absent wr 0.6, lift 0.0
      ...block("p", 120, [
        { present: true, outcome: "won", count: 3, label: "A" },
        { present: true, outcome: "lost", count: 2, label: "A" },
        { present: false, outcome: "won", count: 3, label: "A" },
        { present: false, outcome: "lost", count: 2, label: "A" },
      ]),
    ];
    const report1 = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report1.drifts).toHaveLength(1); // 0.4 >= default 0.1
    const report2 = computeFactorDrift(rows, { referenceDateMs: REF_MS, minDriftDelta: 0.5 });
    expect(report2.drifts).toHaveLength(0); // 0.4 < 0.5
  });
});

describe("computeFactorDrift — sorting", () => {
  test("drifts are sorted by |drift| descending", () => {
    const rows: ClosedDealAuditRow[] = [
      // Factor B: recent lift 0.2, prior lift 0.0 → drift 0.2
      ...block("rB", 20, [
        { present: true, outcome: "won", count: 3, label: "B" },
        { present: true, outcome: "lost", count: 2, label: "B" },
        { present: false, outcome: "won", count: 2, label: "B" },
        { present: false, outcome: "lost", count: 3, label: "B" },
      ]),
      ...block("pB", 120, [
        { present: true, outcome: "won", count: 3, label: "B" },
        { present: true, outcome: "lost", count: 2, label: "B" },
        { present: false, outcome: "won", count: 3, label: "B" },
        { present: false, outcome: "lost", count: 2, label: "B" },
      ]),
      // Factor A: recent lift 1.0, prior lift 0.0 → drift 1.0 (should sort first)
      ...block("rA", 25, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
      ...block("pA", 125, [
        { present: true, outcome: "won", count: 3, label: "A" },
        { present: true, outcome: "lost", count: 2, label: "A" },
        { present: false, outcome: "won", count: 3, label: "A" },
        { present: false, outcome: "lost", count: 2, label: "A" },
      ]),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.drifts.map((d) => d.label)).toEqual(["A", "B"]);
    expect(Math.abs(report.drifts[0].drift!)).toBeGreaterThan(Math.abs(report.drifts[1].drift!));
  });
});

describe("computeFactorDrift — confidence flags", () => {
  test("thin recent window flags report AND each row as lowConfidence", () => {
    // Only 4 rows in recent, far below MIN_DEALS_PER_WINDOW (10).
    const rows = [
      ...block("r", 20, [
        { present: true, outcome: "won", count: 2, label: "A" },
        { present: false, outcome: "lost", count: 2, label: "A" },
      ]),
      // Prior with 20 rows, strong tailwind vs neutral.
      ...block("p", 120, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: true, outcome: "lost", count: 5, label: "A" },
        { present: false, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.lowConfidence).toBe(true);
    for (const d of report.drifts) {
      expect(d.lowConfidence).toBe(true);
    }
  });

  test("thin prior window flags report AND each row as lowConfidence", () => {
    const rows = [
      // Recent: 20 rows.
      ...block("r", 20, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
        { present: true, outcome: "lost", count: 5, label: "A" },
        { present: false, outcome: "won", count: 5, label: "A" },
      ]),
      // Prior: only 4.
      ...block("p", 120, [
        { present: true, outcome: "won", count: 2, label: "A" },
        { present: false, outcome: "lost", count: 2, label: "A" },
      ]),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.lowConfidence).toBe(true);
    for (const d of report.drifts) {
      expect(d.lowConfidence).toBe(true);
    }
  });

  test("both windows healthy → report not lowConfidence", () => {
    const rows = [
      // Recent 10, strong tailwind
      ...block("r", 20, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
      // Prior 20, neutral
      ...block("p", 120, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: true, outcome: "lost", count: 5, label: "A" },
        { present: false, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.lowConfidence).toBe(false);
    // Per-row lowConfidence can still be true if per-factor sides are
    // thin, but at least one of the drifting rows should be confident
    // given the clean 5/5 split on each side.
    const confident = report.drifts.find((d) => !d.lowConfidence);
    expect(confident).toBeDefined();
  });

  test("per-row recentAvgWeight reflects the signed weight used in recent deals", () => {
    const rows = [
      ...block("r", 20, [
        { present: true, outcome: "won", count: 5, label: "A", weight: 8 },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
      ...block("p", 120, [
        { present: true, outcome: "won", count: 5, label: "A", weight: 2 },
        { present: true, outcome: "lost", count: 5, label: "A", weight: 2 },
        { present: false, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    expect(report.drifts[0].recentAvgWeight).toBeCloseTo(8, 5);
  });

  test("factor present in only one window does not surface as drift", () => {
    // "NewFactor" only appears in recent. No measurable prior lift →
    // drift null → direction stable → filtered out.
    const rows = [
      // Give factor "A" some presence on both sides so the report isn't empty
      // for unrelated reasons; we're asserting specifically about NewFactor.
      ...block("r-A", 20, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
      ...block("p-A", 120, [
        { present: true, outcome: "won", count: 5, label: "A" },
        { present: false, outcome: "lost", count: 5, label: "A" },
      ]),
      // NewFactor only in recent
      row("nf1", 15, "won", [f("NewFactor", 5)]),
      row("nf2", 15, "lost", []),
    ];
    const report = computeFactorDrift(rows, { referenceDateMs: REF_MS });
    const labels = report.drifts.map((d) => d.label);
    expect(labels).not.toContain("NewFactor");
  });
});

describe("describeDriftHeadline", () => {
  test("zero drifts → 'no drift detected' with deal count", () => {
    const headline = describeDriftHeadline({
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 12,
      priorN: 20,
      drifts: [],
      lowConfidence: false,
    });
    expect(headline).toBe("No factor drift detected across 32 closed deals.");
  });

  test("single flipped factor", () => {
    const drift: FactorDrift = {
      label: "Trade in hand",
      recentLift: -0.1,
      priorLift: 0.4,
      drift: -0.5,
      direction: "flipped",
      recentPresent: 7,
      priorPresent: 12,
      recentAvgWeight: 6,
      lowConfidence: false,
    };
    const headline = describeDriftHeadline({
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 40,
      priorN: 60,
      drifts: [drift],
      lowConfidence: false,
    });
    expect(headline).toBe(
      "1 factor drifting (1 flipped) over the last 90 days.",
    );
  });

  test("multiple drift directions listed in flipped/falling/rising order", () => {
    const make = (direction: "flipped" | "falling" | "rising"): FactorDrift => ({
      label: direction,
      recentLift: 0.1,
      priorLift: 0.4,
      drift: -0.3,
      direction,
      recentPresent: 5,
      priorPresent: 10,
      recentAvgWeight: 4,
      lowConfidence: false,
    });
    const headline = describeDriftHeadline({
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 50,
      priorN: 80,
      drifts: [make("flipped"), make("falling"), make("rising")],
      lowConfidence: false,
    });
    expect(headline).toBe(
      "3 factors drifting (1 flipped, 1 falling, 1 rising) over the last 90 days.",
    );
  });

  test("lowConfidence appends directional-only note with window counts", () => {
    const drift: FactorDrift = {
      label: "A",
      recentLift: 0.3,
      priorLift: 0.1,
      drift: 0.2,
      direction: "rising",
      recentPresent: 3,
      priorPresent: 4,
      recentAvgWeight: 5,
      lowConfidence: true,
    };
    const headline = describeDriftHeadline({
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 45,
      recentN: 6,
      priorN: 4,
      drifts: [drift],
      lowConfidence: true,
    });
    expect(headline).toBe(
      "1 factor drifting (1 rising) over the last 45 days — directional only (6 recent, 4 prior).",
    );
  });
});

describe("describeDriftRationale", () => {
  test("flipped rationale includes both lifts and 'flipped direction'", () => {
    const d: FactorDrift = {
      label: "Trade in hand",
      recentLift: -0.04,
      priorLift: 0.23,
      drift: -0.27,
      direction: "flipped",
      recentPresent: 14,
      priorPresent: 38,
      recentAvgWeight: 5,
      lowConfidence: false,
    };
    expect(describeDriftRationale(d)).toBe(
      "Trade in hand: was +23%, now -4% — flipped direction across 14 recent × 38 prior presences.",
    );
  });

  test("rising rationale: neutral prior formats without '+' sign, positive recent carries '+'", () => {
    const d: FactorDrift = {
      label: "Margin above baseline",
      recentLift: 0.3,
      priorLift: 0,
      drift: 0.3,
      direction: "rising",
      recentPresent: 9,
      priorPresent: 11,
      recentAvgWeight: 4,
      lowConfidence: false,
    };
    expect(describeDriftRationale(d)).toBe(
      "Margin above baseline: was 0%, now +30% — rising across 9 recent × 11 prior presences.",
    );
  });

  test("falling rationale uses 'falling' wording", () => {
    const d: FactorDrift = {
      label: "Repeat buyer",
      recentLift: 0.05,
      priorLift: 0.35,
      drift: -0.3,
      direction: "falling",
      recentPresent: 12,
      priorPresent: 22,
      recentAvgWeight: 3,
      lowConfidence: false,
    };
    expect(describeDriftRationale(d)).toBe(
      "Repeat buyer: was +35%, now +5% — falling across 12 recent × 22 prior presences.",
    );
  });

  test("null lifts render as 'n/a'", () => {
    const d: FactorDrift = {
      label: "Sparse",
      recentLift: null,
      priorLift: null,
      drift: null,
      direction: "stable",
      recentPresent: 0,
      priorPresent: 0,
      recentAvgWeight: 0,
      lowConfidence: true,
    };
    expect(describeDriftRationale(d)).toBe(
      "Sparse: was n/a, now n/a — stable across 0 recent × 0 prior presences.",
    );
  });
});
