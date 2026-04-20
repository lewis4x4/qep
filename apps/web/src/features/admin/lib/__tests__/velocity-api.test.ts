import { describe, expect, test } from "bun:test";
import {
  computeStageStats,
  summarizeVelocity,
  findStalledQuotes,
  formatDuration,
  type QuoteVelocityRow,
} from "../velocity-api";

function row(partial: Partial<QuoteVelocityRow>): QuoteVelocityRow {
  return {
    id: partial.id ?? "q-1",
    customer: partial.customer ?? null,
    status: partial.status ?? "sent",
    created_at: partial.created_at ?? "2026-04-01T10:00:00Z",
    sent_at: partial.sent_at ?? null,
    viewed_at: partial.viewed_at ?? null,
    draftToSentSec: partial.draftToSentSec ?? null,
    sentToViewedSec: partial.sentToViewedSec ?? null,
    sentToOutcomeSec: partial.sentToOutcomeSec ?? null,
    outcome: partial.outcome ?? null,
    currentStageAgeSec: partial.currentStageAgeSec ?? 0,
  };
}

describe("computeStageStats", () => {
  test("empty input → all null / zero", () => {
    const s = computeStageStats([]);
    expect(s.n).toBe(0);
    expect(s.medianSec).toBeNull();
    expect(s.p90Sec).toBeNull();
    expect(s.meanSec).toBeNull();
  });

  test("nulls filtered out", () => {
    const s = computeStageStats([null, 100, null, 200, null]);
    expect(s.n).toBe(2);
    expect(s.meanSec).toBe(150);
  });

  test("median of odd-length sorted sample", () => {
    const s = computeStageStats([10, 50, 90]);
    expect(s.medianSec).toBe(50);
  });

  test("median of even-length interpolates between two middle values", () => {
    const s = computeStageStats([10, 20, 30, 40]);
    // 50th percentile between index 1 (20) and 2 (30) = 25
    expect(s.medianSec).toBe(25);
  });

  test("p90 of 10 values = the 9th index (interpolation hits it cleanly)", () => {
    const s = computeStageStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    // idx = 0.9 * 9 = 8.1 → between 9 and 100
    expect(s.p90Sec).toBe(Math.round(9 * 0.9 + 100 * 0.1));
  });

  test("single value → median + p90 + mean all equal", () => {
    const s = computeStageStats([42]);
    expect(s.medianSec).toBe(42);
    expect(s.p90Sec).toBe(42);
    expect(s.meanSec).toBe(42);
  });

  test("negative durations filtered (defensive)", () => {
    const s = computeStageStats([-5, 100, 200]);
    expect(s.n).toBe(2);
    expect(s.medianSec).toBe(150);
  });
});

describe("summarizeVelocity", () => {
  test("counts inFlight + won + lost correctly", () => {
    const rows = [
      row({ id: "a", status: "sent" }),
      row({ id: "b", status: "viewed" }),
      row({ id: "c", status: "draft" }),
      row({ id: "d", status: "accepted", outcome: "won" }),
      row({ id: "e", status: "rejected", outcome: "lost" }),
      row({ id: "f", status: "expired" }),
    ];
    const s = summarizeVelocity(rows);
    expect(s.totalQuotes).toBe(6);
    expect(s.inFlight).toBe(3);
    expect(s.won).toBe(1);
    expect(s.lost).toBe(1);
  });

  test("computes per-stage stats from the row set", () => {
    const rows = [
      row({ draftToSentSec: 600, sentToViewedSec: 1800, sentToOutcomeSec: 86400 }),
      row({ draftToSentSec: 1200, sentToViewedSec: null, sentToOutcomeSec: 172800 }),
      row({ draftToSentSec: 1800, sentToViewedSec: 3600, sentToOutcomeSec: null }),
    ];
    const s = summarizeVelocity(rows);
    expect(s.draftToSent.n).toBe(3);
    expect(s.draftToSent.medianSec).toBe(1200);
    expect(s.sentToViewed.n).toBe(2);
    expect(s.sentToOutcome.n).toBe(2);
  });
});

describe("findStalledQuotes", () => {
  test("only sent/viewed rows over the threshold are flagged", () => {
    const DAY = 86400;
    const rows = [
      row({ id: "fresh", status: "sent", currentStageAgeSec: 5 * DAY }),
      row({ id: "stale", status: "sent", currentStageAgeSec: 20 * DAY }),
      row({ id: "viewed-stale", status: "viewed", currentStageAgeSec: 30 * DAY }),
      row({ id: "draft-old", status: "draft", currentStageAgeSec: 40 * DAY }),
      row({ id: "won", status: "accepted", currentStageAgeSec: 90 * DAY }),
    ];
    const stalled = findStalledQuotes(rows, 14);
    expect(stalled.map((r) => r.id)).toEqual(["viewed-stale", "stale"]);
  });

  test("sorted by age desc", () => {
    const DAY = 86400;
    const rows = [
      row({ id: "a", status: "sent", currentStageAgeSec: 15 * DAY }),
      row({ id: "b", status: "sent", currentStageAgeSec: 30 * DAY }),
      row({ id: "c", status: "sent", currentStageAgeSec: 20 * DAY }),
    ];
    const stalled = findStalledQuotes(rows);
    expect(stalled.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  test("respects custom threshold", () => {
    const DAY = 86400;
    const rows = [
      row({ id: "a", status: "sent", currentStageAgeSec: 5 * DAY }),
      row({ id: "b", status: "sent", currentStageAgeSec: 10 * DAY }),
    ];
    expect(findStalledQuotes(rows, 3).map((r) => r.id)).toEqual(["b", "a"]);
    expect(findStalledQuotes(rows, 14)).toEqual([]);
  });
});

describe("formatDuration", () => {
  test("null → em-dash", () => {
    expect(formatDuration(null)).toBe("—");
  });

  test("under a minute: bare seconds", () => {
    expect(formatDuration(42)).toBe("42s");
  });

  test("minutes in whole-number form", () => {
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(180)).toBe("3m");
  });

  test("hours with one decimal", () => {
    expect(formatDuration(3600)).toBe("1.0h");
    expect(formatDuration(7200)).toBe("2.0h");
  });

  test("days with one decimal", () => {
    expect(formatDuration(86400)).toBe("1.0d");
    expect(formatDuration(86400 * 4.5)).toBe("4.5d");
  });
});
