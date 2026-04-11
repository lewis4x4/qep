import { describe, expect, it } from "bun:test";
import { buildDecisionCycleBoard } from "./decision-cycle";

describe("buildDecisionCycleBoard", () => {
  it("turns close history, cadence drift, and budget timing into a synchronizer board", () => {
    const board = buildDecisionCycleBoard({
      accountId: "company-1",
      budgetCycleMonth: 5,
      seasonalPattern: "spring_push",
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
      closedDeals: [
        { id: "closed-1", name: "Wheel Loader", createdAt: "2026-01-01T00:00:00.000Z", closedAt: "2026-02-10T00:00:00.000Z" },
        { id: "closed-2", name: "Skid Steer", createdAt: "2026-02-01T00:00:00.000Z", closedAt: "2026-03-13T00:00:00.000Z" },
      ],
      openDeals: [
        {
          id: "open-1",
          name: "Excavator Replacement",
          createdAt: "2026-02-01T00:00:00.000Z",
          expectedCloseOn: null,
          nextFollowUpAt: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "open-2",
          name: "Loader Fleet Refresh",
          createdAt: "2026-03-20T00:00:00.000Z",
          expectedCloseOn: "2026-04-30T00:00:00.000Z",
          nextFollowUpAt: "2026-04-15T00:00:00.000Z",
        },
      ],
      signatures: [
        { dealId: "closed-1", signedAt: "2026-02-01T00:00:00.000Z" },
        { dealId: "closed-2", signedAt: "2026-03-01T00:00:00.000Z" },
      ],
      cadences: [
        { dealId: "open-1", status: "active", startedAt: "2026-03-01T00:00:00.000Z", overdueTouchpoints: 2, pendingTouchpoints: 1 },
        { dealId: "open-2", status: "active", startedAt: "2026-03-21T00:00:00.000Z", overdueTouchpoints: 0, pendingTouchpoints: 2 },
      ],
    });

    expect(board.summary.learnedCycleDays).toBe(40);
    expect(board.summary.signatureToCloseDays).toBeGreaterThan(0);
    expect(board.summary.activeDeals).toBe(2);
    expect(board.summary.driftCount).toBeGreaterThanOrEqual(1);
    expect(board.rhythm[0]?.title).toContain("Historic purchase rhythm");
    expect(board.syncGaps[0]?.title).toBe("Excavator Replacement");
    expect(board.nextWindow[0]?.title).toContain("budget window");
  });

  it("falls back cleanly when rhythm history is sparse", () => {
    const board = buildDecisionCycleBoard({
      accountId: "company-1",
      budgetCycleMonth: null,
      seasonalPattern: null,
      closedDeals: [],
      openDeals: [],
      signatures: [],
      cadences: [],
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.learnedCycleDays).toBeNull();
    expect(board.summary.activeDeals).toBe(0);
    expect(board.nextWindow[0]?.confidence).toBe("low");
  });
});
