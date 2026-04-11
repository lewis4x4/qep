import { describe, expect, it } from "bun:test";
import { buildBranchChiefBoard } from "./branch-chief";

describe("buildBranchChiefBoard", () => {
  it("turns branch pressure signals into ranked recommendations with trace", () => {
    const board = buildBranchChiefBoard({
      branchId: "memphis",
      summary: {
        logisticsOpen: 5,
        rentalMoves: 2,
        readinessBlocked: 3,
        readinessInPrep: 6,
        activeServiceJobs: 4,
        serviceInvoiceValue: 18000,
        branchRevenue: 42000,
        openArBalance: 26000,
        serviceLinkedSalesCount: 2,
        serviceLinkedSalesValue: 155000,
      },
      trafficTickets: [
        { id: "t1", ticket_type: "rental", status: "scheduled", from_location: "Memphis", to_location: "Nashville" },
      ],
      serviceJobs: [
        { id: "sj-1", customer_id: "c1", current_stage: "in_progress", invoice_total: 5000 },
        { id: "sj-2", customer_id: "c2", current_stage: "waiting_parts", invoice_total: 13000 },
      ],
    });

    expect(board.summary.recommendationCount).toBeGreaterThanOrEqual(4);
    expect(board.summary.urgentCount).toBeGreaterThanOrEqual(2);
    expect(board.summary.logisticsRisk).toBe(true);
    expect(board.summary.readinessRisk).toBe(true);
    expect(board.summary.revenueLeak).toBe(true);
    expect(board.recommendations[0]?.trace.length).toBeGreaterThan(1);
  });

  it("falls back to steady-state guidance when no acute branch signal is active", () => {
    const board = buildBranchChiefBoard({
      branchId: "lake-city",
      summary: {
        logisticsOpen: 0,
        rentalMoves: 0,
        readinessBlocked: 0,
        readinessInPrep: 1,
        activeServiceJobs: 1,
        serviceInvoiceValue: 0,
        branchRevenue: 5000,
        openArBalance: 0,
        serviceLinkedSalesCount: 0,
        serviceLinkedSalesValue: 0,
      },
      trafficTickets: [],
      serviceJobs: [],
    });

    expect(board.summary.recommendationCount).toBe(1);
    expect(board.recommendations[0]?.confidence).toBe("low");
    expect(board.recommendations[0]?.headline).toContain("stable");
  });
});
