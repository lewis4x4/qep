import { describe, expect, it } from "bun:test";
import { buildRepRealityBoard } from "./rep-reality";

describe("buildRepRealityBoard", () => {
  it("prioritizes overdue and over-time deals and derives private mirror insights", () => {
    const board = buildRepRealityBoard({
      deals: [
        {
          dealId: "deal-1",
          dealName: "Acme loader",
          companyName: "Acme",
          weightedAmount: 80000,
          nextFollowUpAt: "2026-04-09T10:00:00.000Z",
          lastActivityAt: "2026-04-01T10:00:00.000Z",
          pctUsed: 1.2,
          isOver: true,
        },
        {
          dealId: "deal-2",
          dealName: "River quote",
          companyName: "River",
          weightedAmount: 40000,
          nextFollowUpAt: "2026-04-12T10:00:00.000Z",
          lastActivityAt: "2026-04-10T09:00:00.000Z",
          pctUsed: 0.5,
          isOver: false,
        },
      ],
      voiceNotes30d: 0,
      touches7d: 0,
      nowTime: Date.parse("2026-04-10T12:00:00.000Z"),
    });

    expect(board.summary.activeDeals).toBe(2);
    expect(board.summary.weightedRevenue).toBe(120000);
    expect(board.summary.overdueFollowUps).toBe(1);
    expect(board.summary.overTimeDeals).toBe(1);
    expect(board.focusDeals[0]?.dealId).toBe("deal-1");
    expect(board.insights.map((i) => i.label).join(" | ")).toContain("follow-up");
    expect(board.insights.map((i) => i.label).join(" | ")).toContain("No voice notes");
  });
});
