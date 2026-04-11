import { describe, expect, it } from "bun:test";
import { buildExitRegisterBoard } from "./exit-register";

describe("buildExitRegisterBoard", () => {
  it("aggregates churn, loss, and won-back signals into a portfolio register", () => {
    const board = buildExitRegisterBoard({
      lifecycleSignals: [
        {
          companyId: "company-1",
          companyName: "Oak Ridge",
          eventType: "churn_risk_flag",
          eventAt: "2026-04-01T00:00:00.000Z",
          sourceTable: "customer_lifecycle_events",
        },
        {
          companyId: "company-1",
          companyName: "Oak Ridge",
          eventType: "lost",
          eventAt: "2026-04-08T00:00:00.000Z",
          sourceTable: "customer_lifecycle_events",
        },
        {
          companyId: "company-2",
          companyName: "Pine Hill",
          eventType: "won_back",
          eventAt: "2026-04-09T00:00:00.000Z",
          sourceTable: "customer_lifecycle_events",
        },
      ],
      lostDeals: [
        {
          companyId: "company-1",
          companyName: "Oak Ridge",
          dealId: "deal-1",
          dealName: "Excavator replacement",
          closedAt: "2026-04-07T00:00:00.000Z",
          lossReason: "Budget cut",
          competitor: "CAT",
        },
      ],
    });

    expect(board.summary.accounts).toBe(2);
    expect(board.summary.lost).toBe(1);
    expect(board.summary.wonBack).toBe(1);
    expect(board.rows[0]?.companyName).toBe("Oak Ridge");
    expect(board.rows[0]?.state).toBe("lost");
    expect(board.rows[0]?.trace.join(" ")).toContain("Budget cut");
    expect(board.rows[1]?.state).toBe("won_back");
  });

  it("falls back cleanly when no exit signals exist", () => {
    const board = buildExitRegisterBoard({
      lifecycleSignals: [],
      lostDeals: [],
    });

    expect(board.summary.accounts).toBe(0);
    expect(board.rows).toHaveLength(0);
  });
});
