import { describe, expect, test } from "bun:test";
import { computePipelineAnalytics } from "./pipeline-analytics";
import type { QrmDealStage, QrmRepSafeDeal } from "./types";

const NOW = Date.parse("2026-04-15T00:00:00Z");
const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function makeDeal(id: string, stageId: string, lastActivityDaysAgo: number | null): QrmRepSafeDeal {
  return {
    id,
    workspaceId: "ws",
    name: id,
    stageId,
    primaryContactId: null,
    companyId: null,
    assignedRepId: null,
    amount: 100000,
    expectedCloseOn: null,
    nextFollowUpAt: null,
    lastActivityAt: lastActivityDaysAgo !== null ? daysAgo(lastActivityDaysAgo) : null,
    closedAt: null,
    hubspotDealId: null,
    createdAt: daysAgo(lastActivityDaysAgo ?? 0),
    updatedAt: daysAgo(lastActivityDaysAgo ?? 0),
    slaDeadlineAt: null,
    depositStatus: null,
    depositAmount: null,
    sortPosition: null,
    marginPct: null,
  };
}

function makeStage(id: string, sortOrder: number, overrides: Partial<QrmDealStage> = {}): QrmDealStage {
  return {
    id,
    workspaceId: "ws",
    name: `Stage ${sortOrder}`,
    sortOrder,
    probability: 0.5,
    isClosedWon: false,
    isClosedLost: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computePipelineAnalytics", () => {
  test("returns empty analytics for empty inputs", () => {
    const result = computePipelineAnalytics({ stages: [], deals: [], now: NOW });
    expect(result.stages).toEqual([]);
    expect(result.bottleneckStageId).toBeNull();
    expect(result.velocityDealsPerWeek).toBe(0);
    expect(result.totalOpenDeals).toBe(0);
  });

  test("skips closed-won and closed-lost stages", () => {
    const stages = [
      makeStage("a", 1),
      makeStage("won", 22, { isClosedWon: true }),
      makeStage("lost", 23, { isClosedLost: true }),
    ];
    const result = computePipelineAnalytics({ stages, deals: [], now: NOW });
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0].stageId).toBe("a");
  });

  test("computes avg days in stage from lastActivityAt", () => {
    const stages = [makeStage("a", 1)];
    const deals = [
      makeDeal("d1", "a", 10),
      makeDeal("d2", "a", 20),
    ];
    const result = computePipelineAnalytics({ stages, deals, now: NOW });
    expect(result.stages[0].avgDaysInStage).toBe(15);
  });

  test("conversion rate is ratio of next-stage count to current-stage count", () => {
    const stages = [makeStage("a", 1), makeStage("b", 2)];
    const deals = [
      makeDeal("d1", "a", 1),
      makeDeal("d2", "a", 1),
      makeDeal("d3", "a", 1),
      makeDeal("d4", "a", 1),
      makeDeal("d5", "b", 1),
    ];
    const result = computePipelineAnalytics({ stages, deals, now: NOW });
    // 1 / 4 = 25%
    expect(result.stages[0].conversionToNextPct).toBe(25);
    // Last stage has no "next"
    expect(result.stages[1].conversionToNextPct).toBeNull();
  });

  test("conversion caps at 100% when next stage exceeds current", () => {
    const stages = [makeStage("a", 1), makeStage("b", 2)];
    const deals = [
      makeDeal("d1", "a", 1),
      makeDeal("d2", "b", 1),
      makeDeal("d3", "b", 1),
      makeDeal("d4", "b", 1),
    ];
    const result = computePipelineAnalytics({ stages, deals, now: NOW });
    expect(result.stages[0].conversionToNextPct).toBe(100);
  });

  test("flags a bottleneck only when avg > 14 days", () => {
    const stages = [makeStage("a", 1), makeStage("b", 2)];
    const dealsBelow = [makeDeal("d1", "a", 5), makeDeal("d2", "b", 10)];
    expect(computePipelineAnalytics({ stages, deals: dealsBelow, now: NOW }).bottleneckStageId).toBeNull();

    const dealsAbove = [makeDeal("d1", "a", 5), makeDeal("d2", "b", 30)];
    expect(computePipelineAnalytics({ stages, deals: dealsAbove, now: NOW }).bottleneckStageId).toBe("b");
  });

  test("picks the longest-stalled stage when multiple exceed threshold", () => {
    const stages = [makeStage("a", 1), makeStage("b", 2), makeStage("c", 3)];
    const deals = [
      makeDeal("d1", "a", 20),
      makeDeal("d2", "b", 40),
      makeDeal("d3", "c", 30),
    ];
    const result = computePipelineAnalytics({ stages, deals, now: NOW });
    expect(result.bottleneckStageId).toBe("b");
    expect(result.bottleneckStageName).toBe("Stage 2");
  });

  test("velocity counts deals with lastActivityAt in the past 7 days", () => {
    const stages = [makeStage("a", 1)];
    const deals = [
      makeDeal("recent1", "a", 2),
      makeDeal("recent2", "a", 6),
      makeDeal("old", "a", 30),
      makeDeal("null", "a", null),
    ];
    const result = computePipelineAnalytics({ stages, deals, now: NOW });
    expect(result.velocityDealsPerWeek).toBe(2);
  });
});
