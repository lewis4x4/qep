import { describe, expect, test } from "bun:test";
import { getUrgency } from "../UrgencyBadge";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("getUrgency", () => {
  test("null → missing", () => {
    expect(getUrgency(null)).toBe("missing");
  });

  test("< 14 days → fresh", () => {
    expect(getUrgency(daysAgo(5))).toBe("fresh");
    expect(getUrgency(daysAgo(13))).toBe("fresh");
  });

  test("> 14 and ≤ 60 days → stale", () => {
    expect(getUrgency(daysAgo(15))).toBe("stale");
    expect(getUrgency(daysAgo(30))).toBe("stale");
    expect(getUrgency(daysAgo(60))).toBe("stale");
  });

  test("> 60 days → urgent", () => {
    expect(getUrgency(daysAgo(61))).toBe("urgent");
    expect(getUrgency(daysAgo(365))).toBe("urgent");
  });
});
