import { describe, expect, test } from "bun:test";
import {
  aggregateExceptions,
  estimateMarginGapCents,
  isUnderThreshold,
  type MarginExceptionRow,
} from "../pricing-discipline-api";

function exc(partial: Partial<MarginExceptionRow>): MarginExceptionRow {
  return {
    id:                   partial.id ?? "x-1",
    workspace_id:         "default",
    quote_package_id:     partial.quote_package_id ?? "q-1",
    brand_id:             partial.brand_id ?? null,
    quoted_margin_pct:    partial.quoted_margin_pct ?? 10,
    threshold_margin_pct: partial.threshold_margin_pct ?? 15,
    delta_pts:            (partial.quoted_margin_pct ?? 10) - (partial.threshold_margin_pct ?? 15),
    estimated_gap_cents:  partial.estimated_gap_cents ?? 50000,
    reason:               partial.reason ?? "test",
    rep_id:               partial.rep_id ?? "rep-1",
    created_at:           partial.created_at ?? "2026-04-19T00:00:00Z",
  } as MarginExceptionRow;
}

describe("isUnderThreshold", () => {
  test("returns false when no threshold set", () => {
    expect(isUnderThreshold(10, null)).toBe(false);
  });

  test("returns false when margin is null or non-finite", () => {
    expect(isUnderThreshold(null, 15)).toBe(false);
    expect(isUnderThreshold(Number.NaN, 15)).toBe(false);
    expect(isUnderThreshold(Number.POSITIVE_INFINITY, 15)).toBe(false);
  });

  test("strict less-than: equal to threshold is not under", () => {
    expect(isUnderThreshold(15, 15)).toBe(false);
    expect(isUnderThreshold(14.99, 15)).toBe(true);
  });

  test("well-below threshold → true", () => {
    expect(isUnderThreshold(8, 15)).toBe(true);
  });

  test("above threshold → false", () => {
    expect(isUnderThreshold(20, 15)).toBe(false);
  });
});

describe("estimateMarginGapCents", () => {
  test("returns 0 when netTotalCents ≤ 0", () => {
    expect(estimateMarginGapCents(0, 10, 15)).toBe(0);
    expect(estimateMarginGapCents(-100, 10, 15)).toBe(0);
  });

  test("returns 0 when quoted ≥ threshold", () => {
    expect(estimateMarginGapCents(100000, 15, 15)).toBe(0);
    expect(estimateMarginGapCents(100000, 20, 15)).toBe(0);
  });

  test("computes margin gap from delta pct", () => {
    // 100k net * (15 - 10)/100 = 5k
    expect(estimateMarginGapCents(10_000_00, 10, 15)).toBe(500_00);
  });

  test("rounds to whole cents", () => {
    // 333 cents * (2/100) = 6.66 → 7
    expect(estimateMarginGapCents(333, 13, 15)).toBe(7);
  });
});

describe("aggregateExceptions", () => {
  test("empty input returns baseline zeros", () => {
    const r = aggregateExceptions([]);
    expect(r.total).toBe(0);
    expect(r.avgDeltaPts).toBeNull();
    expect(r.totalEstimatedGapCents).toBe(0);
    expect(r.byRep).toEqual([]);
    expect(r.byBrand).toEqual([]);
    expect(r.recent).toEqual([]);
  });

  test("sums total + gap + computes averages", () => {
    const rows = [
      exc({ quoted_margin_pct: 10, threshold_margin_pct: 15, estimated_gap_cents: 50_00, rep_id: "r1", brand_id: "b1" }),
      exc({ quoted_margin_pct: 12, threshold_margin_pct: 15, estimated_gap_cents: 30_00, rep_id: "r1", brand_id: "b1" }),
      exc({ quoted_margin_pct: 11, threshold_margin_pct: 15, estimated_gap_cents: 40_00, rep_id: "r2", brand_id: "b2" }),
    ];
    const r = aggregateExceptions(rows);
    expect(r.total).toBe(3);
    // deltas: -5, -3, -4 → avg -4.0
    expect(r.avgDeltaPts).toBe(-4);
    expect(r.totalEstimatedGapCents).toBe(12_000);
  });

  test("byRep ranks by count desc", () => {
    const rows = [
      exc({ id: "a", rep_id: "r1", quoted_margin_pct: 10, threshold_margin_pct: 15 }),
      exc({ id: "b", rep_id: "r1", quoted_margin_pct: 10, threshold_margin_pct: 15 }),
      exc({ id: "c", rep_id: "r2", quoted_margin_pct: 10, threshold_margin_pct: 15 }),
    ];
    const r = aggregateExceptions(rows);
    expect(r.byRep[0]).toMatchObject({ repId: "r1", count: 2 });
    expect(r.byRep[1]).toMatchObject({ repId: "r2", count: 1 });
  });

  test("byBrand handles null brand id as its own bucket", () => {
    const rows = [
      exc({ id: "a", brand_id: "b1", quoted_margin_pct: 10, threshold_margin_pct: 15 }),
      exc({ id: "b", brand_id: null, quoted_margin_pct: 10, threshold_margin_pct: 15 }),
      exc({ id: "c", brand_id: null, quoted_margin_pct: 10, threshold_margin_pct: 15 }),
    ];
    const r = aggregateExceptions(rows);
    expect(r.byBrand).toHaveLength(2);
    expect(r.byBrand[0]).toMatchObject({ brandId: null, count: 2 });
    expect(r.byBrand[1]).toMatchObject({ brandId: "b1", count: 1 });
  });

  test("recent is capped at 50", () => {
    const rows = Array.from({ length: 75 }, (_, i) =>
      exc({ id: `x-${i}`, rep_id: "r1" }),
    );
    const r = aggregateExceptions(rows);
    expect(r.recent.length).toBe(50);
  });

  test("avgDeltaPts rounds to 1 decimal", () => {
    // deltas: -3, -4, -5 → avg -4.0
    const rows = [
      exc({ quoted_margin_pct: 12, threshold_margin_pct: 15 }),
      exc({ quoted_margin_pct: 11, threshold_margin_pct: 15 }),
      exc({ quoted_margin_pct: 10, threshold_margin_pct: 15 }),
    ];
    expect(aggregateExceptions(rows).avgDeltaPts).toBe(-4);
    // Force 1-decimal output
    const r2 = aggregateExceptions([
      exc({ quoted_margin_pct: 12.7, threshold_margin_pct: 15 }),
      exc({ quoted_margin_pct: 13.3, threshold_margin_pct: 15 }),
    ]);
    // deltas: -2.3, -1.7 → avg -2.0
    expect(r2.avgDeltaPts).toBeCloseTo(-2, 1);
  });
});
