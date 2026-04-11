import { describe, expect, it } from "bun:test";
import { buildSeasonalOpportunityBoard } from "./seasonal-opportunity-map";

describe("buildSeasonalOpportunityBoard", () => {
  it("surfaces mapped seasonal opportunities from seasonality, budget cycle, visits, and revenue", () => {
    const board = buildSeasonalOpportunityBoard({
      equipment: [
        { companyId: "company-1", companyName: "Oak Ridge", lat: 35, lng: -90 },
        { companyId: "company-2", companyName: "River Dirt", lat: 36, lng: -89 },
      ],
      profiles: [
        { companyId: "company-1", companyName: "Oak Ridge", seasonalPattern: "spring_push", budgetCycleMonth: 4 },
        { companyId: "company-2", companyName: "River Dirt", seasonalPattern: "steady", budgetCycleMonth: 7 },
      ],
      visitRecommendations: [{ companyId: "company-1" }],
      deals: [
        { companyId: "company-1", weightedAmount: 120000 },
        { companyId: "company-2", weightedAmount: 80000 },
      ],
      now: new Date("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.mappedAccounts).toBe(1);
    expect(board.summary.seasonalAccounts).toBe(1);
    expect(board.summary.budgetCycleAccounts).toBe(1);
    expect(board.summary.visitTargets).toBe(1);
    expect(board.rows[0]?.companyId).toBe("company-1");
    expect(board.rows[0]?.confidence).toBe("high");
  });

  it("skips rows without routeable seasonal signals", () => {
    const board = buildSeasonalOpportunityBoard({
      equipment: [{ companyId: "company-1", companyName: "Oak Ridge", lat: 35, lng: -90 }],
      profiles: [{ companyId: "company-1", companyName: "Oak Ridge", seasonalPattern: "steady", budgetCycleMonth: 10 }],
      visitRecommendations: [],
      deals: [{ companyId: "company-1", weightedAmount: 0 }],
      now: new Date("2026-04-11T00:00:00.000Z"),
    });

    expect(board.rows).toHaveLength(0);
  });
});
