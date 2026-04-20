import { describe, expect, test } from "bun:test";
import {
  aggregateOutcomes,
  type OutcomeClassification,
  type OutcomeReason,
} from "../outcomes-api";

type Row = { outcome: OutcomeClassification; reason: OutcomeReason | null };

describe("aggregateOutcomes", () => {
  test("empty input → all zeros, null rates", () => {
    const r = aggregateOutcomes([]);
    expect(r.total).toBe(0);
    expect(r.won).toBe(0);
    expect(r.lost).toBe(0);
    expect(r.expired).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.winRatePct).toBeNull();
    expect(r.skipRatePct).toBeNull();
    expect(r.topReasons).toEqual([]);
  });

  test("counts each outcome class separately", () => {
    const rows: Row[] = [
      { outcome: "won", reason: "price" },
      { outcome: "won", reason: "relationship" },
      { outcome: "lost", reason: "competitor" },
      { outcome: "expired", reason: null },
      { outcome: "skipped", reason: null },
    ];
    const r = aggregateOutcomes(rows);
    expect(r.total).toBe(5);
    expect(r.won).toBe(2);
    expect(r.lost).toBe(1);
    expect(r.expired).toBe(1);
    expect(r.skipped).toBe(1);
  });

  test("winRatePct computed from won/(won+lost), ignoring expired + skipped", () => {
    const rows: Row[] = [
      { outcome: "won", reason: "price" },
      { outcome: "won", reason: "price" },
      { outcome: "won", reason: "price" },
      { outcome: "lost", reason: "price" },
      { outcome: "expired", reason: null },
      { outcome: "skipped", reason: null },
    ];
    // 3 won / 4 resolved = 75%
    expect(aggregateOutcomes(rows).winRatePct).toBe(75);
  });

  test("winRatePct null when no resolved rows", () => {
    const rows: Row[] = [
      { outcome: "expired", reason: null },
      { outcome: "skipped", reason: null },
    ];
    expect(aggregateOutcomes(rows).winRatePct).toBeNull();
  });

  test("skipRatePct computed over total (not over resolved)", () => {
    const rows: Row[] = [
      { outcome: "won", reason: "price" },
      { outcome: "skipped", reason: null },
      { outcome: "skipped", reason: null },
      { outcome: "skipped", reason: null },
    ];
    // 3 skipped / 4 total = 75%
    expect(aggregateOutcomes(rows).skipRatePct).toBe(75);
  });

  test("reason counts only accumulate from won/lost rows", () => {
    const rows: Row[] = [
      { outcome: "won",     reason: "price" },
      { outcome: "won",     reason: "price" },
      { outcome: "lost",    reason: "price" },
      { outcome: "expired", reason: "price" }, // should NOT count
      { outcome: "skipped", reason: "price" }, // should NOT count
    ];
    const r = aggregateOutcomes(rows);
    expect(r.reasonCounts.price).toBe(3);
    expect(r.reasonCounts.timing).toBe(0);
  });

  test("topReasons sorted desc, omits zero counts", () => {
    const rows: Row[] = [
      { outcome: "won", reason: "price" },
      { outcome: "won", reason: "price" },
      { outcome: "won", reason: "price" },
      { outcome: "lost", reason: "competitor" },
      { outcome: "lost", reason: "competitor" },
      { outcome: "lost", reason: "timing" },
    ];
    const r = aggregateOutcomes(rows);
    expect(r.topReasons).toHaveLength(3);
    expect(r.topReasons[0]).toEqual({ reason: "price", count: 3 });
    expect(r.topReasons[1]).toEqual({ reason: "competitor", count: 2 });
    expect(r.topReasons[2]).toEqual({ reason: "timing", count: 1 });
  });

  test("rounding: 2/3 → 67, not 66.67", () => {
    const rows: Row[] = [
      { outcome: "won", reason: "price" },
      { outcome: "won", reason: "price" },
      { outcome: "lost", reason: "price" },
    ];
    expect(aggregateOutcomes(rows).winRatePct).toBe(67);
  });
});
