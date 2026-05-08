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
          id: "eq-1b",
          companyId: "company-1",
          companyName: "Acme",
          ownership: "customer_owned",
          availability: "available",
          name: "CAT 320 backup",
          lat: 35.3,
          lng: -89.7,
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

    expect(board.summary.mappedAccounts).toBe(2);
    expect(board.summary.openRevenue).toBe(125000);
    expect(board.summary.visitTargets).toBe(1);
    expect(board.summary.activeRentals).toBe(1);
    expect(board.summary.tradeSignals).toBe(1);
    expect(board.summary.criticalAccounts).toBe(1);
    expect(board.summary.routeCandidates).toBe(1);

    expect(board.rows[0]?.id).toBe("account:company-1:35.1:-89.9");
    expect(board.rows[0]?.openRevenue).toBe(62500);
    expect(board.rows[0]?.openDealCount).toBe(1);
    expect(board.rows[0]?.urgency).toBe("critical");
    expect(board.rows[0]?.score).toBe(90);
    expect(board.rows[0]?.routeCandidate).toBe(true);
    expect(board.rows[0]?.reasons).toEqual(["$62,500 open revenue", "1 open deal", "1 visit target", "1 trade signal"]);

    expect(board.rows[1]?.id).toBe("account:company-1:35.3:-89.7");
    expect(board.rows[1]?.openRevenue).toBe(62500);
    expect(board.rows[1]?.openDealCount).toBe(1);
    expect(board.rows[1]?.urgency).toBe("warm");
    expect(board.rows[1]?.routeCandidate).toBe(false);
    expect(board.rows[1]?.reasons).toEqual(["$62,500 open revenue", "1 open deal"]);

    expect(board.rows[2]?.id).toBe("rental:eq-2");
    expect(board.rows[2]?.urgency).toBe("rental");
    expect(board.rows[2]?.routeCandidate).toBe(false);
    expect(board.rows[2]?.reasons).toEqual(["Active rental unit in field"]);
  });

  it("assigns deterministic urgency tiers and route candidates", () => {
    const board = buildOpportunityMapBoard({
      equipment: [
        {
          id: "eq-critical",
          companyId: "company-critical",
          companyName: "Critical Co",
          ownership: "customer_owned",
          availability: "available",
          name: "Critical asset",
          lat: 1,
          lng: 1,
        },
        {
          id: "eq-hot",
          companyId: "company-hot",
          companyName: "Hot Co",
          ownership: "customer_owned",
          availability: "available",
          name: "Hot asset",
          lat: 2,
          lng: 2,
        },
        {
          id: "eq-warm",
          companyId: "company-warm",
          companyName: "Warm Co",
          ownership: "customer_owned",
          availability: "available",
          name: "Warm asset",
          lat: 3,
          lng: 3,
        },
        {
          id: "eq-cold",
          companyId: "company-cold",
          companyName: "Cold Co",
          ownership: "customer_owned",
          availability: "available",
          name: "Cold asset",
          lat: 4,
          lng: 4,
        },
      ],
      deals: [
        { id: "deal-critical", companyId: "company-critical", amount: 100000 },
        { id: "deal-hot", companyId: "company-hot", amount: 50000 },
        { id: "deal-warm", companyId: "company-warm", amount: 1000 },
      ],
      visitRecommendations: [
        { companyId: "company-critical", companyName: "Critical Co", priorityScore: 99 },
        { companyId: "company-hot", companyName: "Hot Co", priorityScore: 80 },
      ],
      tradeSignals: [{ equipmentId: "eq-critical" }],
    });

    const byCompany = new Map(board.rows.map((row) => [row.companyId ?? row.id, row]));

    expect(byCompany.get("company-critical")?.urgency).toBe("critical");
    expect(byCompany.get("company-hot")?.urgency).toBe("hot");
    expect(byCompany.get("company-warm")?.urgency).toBe("warm");
    expect(byCompany.get("company-cold")?.urgency).toBe("cold");

    expect(byCompany.get("company-critical")?.routeCandidate).toBe(true);
    expect(byCompany.get("company-hot")?.routeCandidate).toBe(true);
    expect(byCompany.get("company-warm")?.routeCandidate).toBe(false);
    expect(byCompany.get("company-cold")?.routeCandidate).toBe(false);

    expect(byCompany.get("company-cold")?.reasons).toEqual(["Mapped customer-owned equipment location"]);
    expect(byCompany.get("company-critical")?.openDealCount).toBe(1);
    expect(byCompany.get("company-hot")?.openDealCount).toBe(1);
    expect(byCompany.get("company-warm")?.openDealCount).toBe(1);
    expect(byCompany.get("company-cold")?.openDealCount).toBe(0);

    expect(board.summary.criticalAccounts).toBe(1);
    expect(board.summary.routeCandidates).toBe(2);
  });
});
