/**
 * Calibration Drift tests — Slice 20s.
 *
 * This math drives a claim that shows up verbatim on the manager's
 * home screen ("Scorer is sharpening / dulling over the last 90 days").
 * If the direction call is wrong even once, a manager either triages
 * nothing when they should, or churns a PR when they shouldn't — so
 * every branch of the classifier + every edge of the windowing gets
 * pinned with deterministic fixtures.
 */

import { describe, expect, test } from "bun:test";
import {
  computeCalibrationDrift,
  describeCalibrationDriftHeadline,
  formatSignedPct,
  formatBrierDelta,
  DEFAULT_CALIBRATION_DRIFT_WINDOW_DAYS,
  MIN_CALIBRATION_DRIFT_DELTA,
  MIN_DEALS_PER_WINDOW,
  type CalibrationDriftReport,
} from "../calibration-drift";
import type { ClosedDealAuditRow } from "../closed-deals-audit";

/** Deterministic reference "now" — 2026-01-01T00:00:00Z. */
const REF_MS = Date.parse("2026-01-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function row(
  packageId: string,
  daysAgo: number,
  outcome: "won" | "lost" | "expired",
  score: number,
): ClosedDealAuditRow {
  return {
    packageId,
    score,
    outcome,
    factors: [],
    capturedAt: new Date(REF_MS - daysAgo * DAY).toISOString(),
  };
}

/**
 * Produce a block of N deals all on the same daysAgo offset. `spec`
 * is [score, outcome] pairs — scores chosen so the band math from
 * scorer-calibration lands on a known hit-rate. Bands:
 *   • score >= 70 / >= 55  → predicted "likely win"  → agreement if won
 *   • score >=  0 / >= 35  → predicted "likely loss" → agreement if lost|expired
 */
function block(
  prefix: string,
  daysAgo: number,
  spec: Array<[score: number, outcome: "won" | "lost" | "expired"]>,
): ClosedDealAuditRow[] {
  return spec.map(([score, outcome], i) => row(`${prefix}-${i}`, daysAgo, outcome, score));
}

describe("computeCalibrationDrift — constants", () => {
  test("exports the documented defaults", () => {
    expect(DEFAULT_CALIBRATION_DRIFT_WINDOW_DAYS).toBe(90);
    expect(MIN_CALIBRATION_DRIFT_DELTA).toBeCloseTo(0.05, 10);
    expect(MIN_DEALS_PER_WINDOW).toBe(10);
  });
});

describe("computeCalibrationDrift — empty / malformed input", () => {
  test("empty input yields stable, zero-n, lowConfidence report", () => {
    const r = computeCalibrationDrift([], { referenceDateMs: REF_MS });
    expect(r.recentN).toBe(0);
    expect(r.priorN).toBe(0);
    expect(r.direction).toBe("stable");
    expect(r.lowConfidence).toBe(true);
    expect(r.accuracyDelta).toBe(null);
    expect(r.brierDelta).toBe(null);
  });

  test("null / undefined input is safe", () => {
    // deno-lint-ignore no-explicit-any
    const a = computeCalibrationDrift(null as any, { referenceDateMs: REF_MS });
    // deno-lint-ignore no-explicit-any
    const b = computeCalibrationDrift(undefined as any, { referenceDateMs: REF_MS });
    expect(a.direction).toBe("stable");
    expect(b.direction).toBe("stable");
    expect(a.lowConfidence).toBe(true);
    expect(b.lowConfidence).toBe(true);
  });

  test("rows with null / unparseable capturedAt are excluded", () => {
    const rows: ClosedDealAuditRow[] = [
      { packageId: "a", score: 80, outcome: "won", factors: [], capturedAt: null },
      { packageId: "b", score: 20, outcome: "lost", factors: [], capturedAt: "not-a-date" },
    ];
    const r = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(r.recentN).toBe(0);
    expect(r.priorN).toBe(0);
  });

  test("rows with unknown outcomes are excluded", () => {
    const rows: ClosedDealAuditRow[] = [
      // deno-lint-ignore no-explicit-any
      { packageId: "a", score: 80, outcome: "skipped" as any, factors: [], capturedAt: new Date(REF_MS - 5 * DAY).toISOString() },
      { packageId: "b", score: 80, outcome: "won", factors: [], capturedAt: new Date(REF_MS - 5 * DAY).toISOString() },
    ];
    const r = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(r.recentN).toBe(1);
  });
});

describe("computeCalibrationDrift — windowing", () => {
  test("rows within windowDays are recent, older rows are prior", () => {
    const rows = [
      row("a", 10, "won", 80),
      row("b", 60, "lost", 30),
      row("c", 100, "won", 80),
      row("d", 200, "lost", 30),
    ];
    const r = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(r.recentN).toBe(2);
    expect(r.priorN).toBe(2);
  });

  test("row exactly at windowDays boundary is recent (inclusive cutoff)", () => {
    const r = computeCalibrationDrift(
      [row("boundary", DEFAULT_CALIBRATION_DRIFT_WINDOW_DAYS, "won", 80)],
      { referenceDateMs: REF_MS },
    );
    expect(r.recentN).toBe(1);
    expect(r.priorN).toBe(0);
  });

  test("custom windowDays narrows the recent window", () => {
    const rows = [row("a", 10, "won", 80), row("b", 60, "won", 80)];
    const r = computeCalibrationDrift(rows, { referenceDateMs: REF_MS, windowDays: 30 });
    expect(r.recentN).toBe(1);
    expect(r.priorN).toBe(1);
    expect(r.windowDays).toBe(30);
  });

  test("referenceDate is echoed back as ISO", () => {
    const r = computeCalibrationDrift([], { referenceDateMs: REF_MS });
    expect(r.referenceDate).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("computeCalibrationDrift — direction classification", () => {
  /**
   * Build a block where N% of rows are scorer-correct. Score 80 = band
   * "strong" = predicted win. Score 30 = band "at_risk" = predicted loss.
   *   correct won deal: score 80, outcome won
   *   correct lost deal: score 30, outcome lost
   *   miss (overconfident): score 80, outcome lost
   *   miss (underconfident): score 30, outcome won
   */
  function calibratedBlock(
    prefix: string,
    daysAgo: number,
    correctCount: number,
    missCount: number,
  ): ClosedDealAuditRow[] {
    const spec: Array<[number, "won" | "lost" | "expired"]> = [];
    for (let i = 0; i < correctCount; i++) {
      spec.push([80, "won"]);
    }
    for (let i = 0; i < missCount; i++) {
      spec.push([80, "lost"]);
    }
    return block(prefix, daysAgo, spec);
  }

  test("improving: recent hit-rate is materially higher + Brier lower", () => {
    // Recent: 10 correct, 0 miss → hit rate = 1.0
    // Prior:  5 correct, 5 miss → hit rate = 0.5
    const rows = [...calibratedBlock("r", 20, 10, 0), ...calibratedBlock("p", 120, 5, 5)];
    const report = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(report.direction).toBe("improving");
    expect(report.accuracyDelta! > 0).toBe(true);
    expect(report.brierDelta! < 0).toBe(true);
  });

  test("degrading: recent hit-rate is materially lower + Brier higher", () => {
    const rows = [...calibratedBlock("r", 20, 5, 5), ...calibratedBlock("p", 120, 10, 0)];
    const report = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(report.direction).toBe("degrading");
    expect(report.accuracyDelta! < 0).toBe(true);
    expect(report.brierDelta! > 0).toBe(true);
  });

  test("stable: both windows identical calibration", () => {
    const rows = [...calibratedBlock("r", 20, 7, 3), ...calibratedBlock("p", 120, 7, 3)];
    const report = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(report.direction).toBe("stable");
  });

  test("stable: drift below threshold (within noise floor)", () => {
    // Recent 6/10 = 0.6, Prior 7/10 = 0.7. Accuracy delta = -0.10,
    // Brier delta = +0.06. With a custom minAccuracyDelta of 0.25, the
    // Brier threshold scales to 0.10 — so both sigs come in under their
    // noise floors and the classifier correctly calls it stable.
    const rows = [...calibratedBlock("r", 20, 6, 4), ...calibratedBlock("p", 120, 7, 3)];
    const report = computeCalibrationDrift(rows, {
      referenceDateMs: REF_MS,
      minAccuracyDelta: 0.25,
    });
    expect(report.direction).toBe("stable");
  });

  test("stable: mixed signals (accuracy up but Brier also up) don't claim a trend", () => {
    // Hand-craft conflicting deltas via manual report shape at the
    // unit level. We test classifyDirection indirectly by computing a
    // scenario where the sign of accuracyDelta disagrees with brierDelta
    // in the "both same direction" sense.
    //
    // Recent: 10 rows at score 55, all won → band "healthy", predicted
    //   win, all correct → accuracy 1.0, Brier = mean(0.45²) = 0.2025
    // Prior:  10 rows at score 90, all won → band "strong", predicted
    //   win, all correct → accuracy 1.0, Brier = mean(0.10²) = 0.01
    //
    // Accuracy delta = 0 (both perfect), Brier delta = +0.1925 (worse).
    // Only one metric moved, so direction goes "degrading".
    //
    // To construct a genuine mixed case: recent has accuracy UP and
    // Brier UP. Recent: 8 [55, won] + 2 [30, won] = 8 correct + 2 misses →
    //   accuracy 0.8; Brier = 8*0.45² + 2*0.70² = 1.62 + 0.98 = 2.6 / 10 = 0.26
    // Prior: 6 [90, won] + 4 [90, lost] = 6 correct + 4 misses →
    //   accuracy 0.6; Brier = 6*0.10² + 4*0.90² = 0.06 + 3.24 = 3.30 / 10 = 0.33
    // accuracyDelta = +0.2 (better); brierDelta = -0.07 (better).
    // That's "improving", not mixed. Flip: make accuracy go up while
    // Brier goes up.
    //
    // Recent: 10 [55, won] → accuracy 1.0, Brier 0.2025
    // Prior:  9 [90, won] + 1 [90, lost] → accuracy 0.9, Brier = 9*0.01 + 1*0.81 = 0.09 / 10 = 0.009 + 0.081 = 0.09
    // accuracyDelta = +0.1 (up), brierDelta = +0.11 (worse). Mixed!
    const recentRows = block("r", 20, Array.from({ length: 10 }, () => [55 as const, "won" as const]));
    const priorRows = block(
      "p",
      120,
      // 9 correct (90 score, won) + 1 miss (90 score, lost)
      [
        ...(Array.from({ length: 9 }, () => [90, "won"] as [number, "won"])),
        [90, "lost"] as [number, "lost"],
      ],
    );
    const report = computeCalibrationDrift([...recentRows, ...priorRows], {
      referenceDateMs: REF_MS,
    });
    // Sanity: accuracy improved, Brier degraded.
    expect(report.accuracyDelta).not.toBeNull();
    expect(report.brierDelta).not.toBeNull();
    expect(report.accuracyDelta! > 0).toBe(true);
    expect(report.brierDelta! > 0).toBe(true);
    // Mixed signals → stable.
    expect(report.direction).toBe("stable");
  });

  test("only-one-metric-moves: accuracy flat but Brier improves → improving", () => {
    // Recent: 10 [55, won] → accuracy 1.0, Brier 0.2025
    // Prior:  10 [90, won] → accuracy 1.0, Brier 0.01 (tighter!)
    // accuracyDelta = 0, brierDelta = +0.1925 → worse Brier → degrading.
    // Swap to make Brier improve: recent tighter than prior.
    const recentRows = block("r", 20, Array.from({ length: 10 }, () => [90 as const, "won" as const]));
    const priorRows = block("p", 120, Array.from({ length: 10 }, () => [55 as const, "won" as const]));
    const report = computeCalibrationDrift([...recentRows, ...priorRows], {
      referenceDateMs: REF_MS,
    });
    expect(Math.abs(report.accuracyDelta!) < 0.01).toBe(true);
    expect(report.brierDelta! < 0).toBe(true);
    expect(report.direction).toBe("improving");
  });
});

describe("computeCalibrationDrift — confidence flag", () => {
  test("thin recent window → lowConfidence true", () => {
    const rows = [
      ...block("r", 20, [[80, "won"]]), // 1 row
      ...block("p", 120, Array.from({ length: 15 }, () => [80 as const, "won" as const])),
    ];
    const r = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(r.lowConfidence).toBe(true);
  });

  test("thin prior window → lowConfidence true", () => {
    const rows = [
      ...block("r", 20, Array.from({ length: 15 }, () => [80 as const, "won" as const])),
      ...block("p", 120, [[80, "won"]]),
    ];
    const r = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(r.lowConfidence).toBe(true);
  });

  test("both windows >= MIN_DEALS_PER_WINDOW → lowConfidence false", () => {
    const rows = [
      ...block("r", 20, Array.from({ length: 10 }, () => [80 as const, "won" as const])),
      ...block("p", 120, Array.from({ length: 10 }, () => [80 as const, "won" as const])),
    ];
    const r = computeCalibrationDrift(rows, { referenceDateMs: REF_MS });
    expect(r.lowConfidence).toBe(false);
  });
});

describe("describeCalibrationDriftHeadline", () => {
  function baseReport(overrides: Partial<CalibrationDriftReport>): CalibrationDriftReport {
    return {
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 20,
      priorN: 30,
      recentAccuracy: 0.75,
      priorAccuracy: 0.6,
      accuracyDelta: 0.15,
      recentBrier: 0.18,
      priorBrier: 0.25,
      brierDelta: -0.07,
      direction: "improving",
      lowConfidence: false,
      ...overrides,
    };
  }

  test("improving: sharpening copy with +Npp hit-rate fragment", () => {
    const h = describeCalibrationDriftHeadline(baseReport({}));
    expect(h).toBe("Scorer is sharpening over the last 90 days (hit rate +15pp).");
  });

  test("degrading: dulling copy with negative fragment", () => {
    const h = describeCalibrationDriftHeadline(
      baseReport({
        direction: "degrading",
        accuracyDelta: -0.12,
        recentAccuracy: 0.55,
        priorAccuracy: 0.67,
        brierDelta: 0.05,
      }),
    );
    expect(h).toBe("Scorer is dulling over the last 90 days (hit rate -12pp).");
  });

  test("stable with data: holding copy", () => {
    const h = describeCalibrationDriftHeadline(
      baseReport({ direction: "stable", accuracyDelta: 0.01, brierDelta: 0.001 }),
    );
    expect(h).toBe("Scorer calibration is stable over the last 90 days.");
  });

  test("stable with no data: zero-deals copy", () => {
    const h = describeCalibrationDriftHeadline(
      baseReport({
        direction: "stable",
        recentN: 0,
        priorN: 0,
        accuracyDelta: null,
        brierDelta: null,
        lowConfidence: true,
      }),
    );
    expect(h).toBe("No closed deals to measure calibration drift yet.");
  });

  test("lowConfidence appends directional-only note to improving headline", () => {
    const h = describeCalibrationDriftHeadline(
      baseReport({ lowConfidence: true, recentN: 6, priorN: 4 }),
    );
    expect(h).toBe(
      "Scorer is sharpening over the last 90 days (hit rate +15pp) — directional only (6 recent, 4 prior).",
    );
  });

  test("custom windowDays shows up in the copy", () => {
    const h = describeCalibrationDriftHeadline(
      baseReport({ windowDays: 45, accuracyDelta: 0.08 }),
    );
    expect(h).toBe("Scorer is sharpening over the last 45 days (hit rate +8pp).");
  });
});

describe("formatSignedPct", () => {
  test("null → em dash", () => {
    expect(formatSignedPct(null)).toBe("—");
  });

  test("positive → '+N%'", () => {
    expect(formatSignedPct(0.15)).toBe("+15%");
  });

  test("negative → '-N%'", () => {
    expect(formatSignedPct(-0.12)).toBe("-12%");
  });

  test("zero → '0%' (no explicit plus)", () => {
    expect(formatSignedPct(0)).toBe("0%");
  });
});

describe("formatBrierDelta", () => {
  test("null → em dash", () => {
    expect(formatBrierDelta(null)).toBe("—");
  });

  test("positive → '+0.XXX'", () => {
    expect(formatBrierDelta(0.075)).toBe("+0.075");
  });

  test("negative → '-0.XXX'", () => {
    expect(formatBrierDelta(-0.042)).toBe("-0.042");
  });

  test("zero → '0.000'", () => {
    expect(formatBrierDelta(0)).toBe("0.000");
  });
});
