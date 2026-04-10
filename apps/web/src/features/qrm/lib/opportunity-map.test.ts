import { describe, expect, it } from "bun:test";
import { buildOpportunityMapBoard } from "./opportunity-map";

describe("buildOpportunityMapBoard", () => {
  it("groups account signals on customer-owned equipment coordinates and keeps rentals separate", () => {
    const board = buildOpportunityMapBoard({
      equipment: [
        {
          id: "eq-1",
          companyId: "company-1",
          companyName: "Acme",
          ownership: "customer_owned",
          availability: "available",
          name: "CAT 320",
          lat: 35.1,
          lng: -89.9,
        },
        {
          id: "eq-2",
          companyId: null,
          companyName: null,
          ownership: "rental_fleet",
          availability: "rented",
          name: "JLG 450AJ",
          lat: 36.1,
          lng: -86.8,
        },
      ],
      deals: [{ id: "deal-1", companyId: "company-1", amount: 125000 }],
      visitRecommendations: [{ companyId: "company-1", companyName: "Acme", priorityScore: 87 }],
      tradeSignals: [{ equipmentId: "eq-1" }],
    });

    expect(board.summary.mappedAccounts).toBe(1);
    expect(board.summary.openRevenue).toBe(125000);
    expect(board.summary.visitTargets).toBe(1);
    expect(board.summary.activeRentals).toBe(1);
    expect(board.summary.tradeSignals).toBe(1);
    expect(board.rows[0]?.id).toBe("account:company-1");
    expect(board.rows[1]?.id).toBe("rental:eq-2");
  });
});
