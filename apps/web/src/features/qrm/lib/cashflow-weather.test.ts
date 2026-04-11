import { describe, expect, it } from "bun:test";
import { buildCashflowWeatherBoard } from "./cashflow-weather";

describe("buildCashflowWeatherBoard", () => {
  it("turns invoice history, AR pressure, and seasonal timing into a cash weather board", () => {
    const board = buildCashflowWeatherBoard({
      accountId: "company-1",
      budgetCycleMonth: 5,
      seasonalPattern: "spring_push",
      arBlock: {
        id: "block-1",
        block_reason: "AR exposure",
        block_threshold_days: 30,
        current_max_aging_days: 41,
        status: "active",
        override_until: null,
        blocked_at: "2026-04-01T00:00:00.000Z",
      },
      invoices: [
        {
          id: "inv-1",
          invoiceNumber: "INV-1",
          invoiceDate: "2026-02-01T00:00:00.000Z",
          dueDate: "2026-03-01T00:00:00.000Z",
          paidAt: "2026-02-24T00:00:00.000Z",
          total: 10000,
          amountPaid: 10000,
          balanceDue: 0,
          status: "paid",
          paymentMethod: "ach",
        },
        {
          id: "inv-2",
          invoiceNumber: "INV-2",
          invoiceDate: "2026-03-10T00:00:00.000Z",
          dueDate: "2026-04-10T00:00:00.000Z",
          paidAt: null,
          total: 12000,
          amountPaid: 6000,
          balanceDue: 6000,
          status: "partial",
          paymentMethod: "check",
        },
        {
          id: "inv-3",
          invoiceNumber: "INV-3",
          invoiceDate: "2026-02-15T00:00:00.000Z",
          dueDate: "2026-03-15T00:00:00.000Z",
          paidAt: null,
          total: 9000,
          amountPaid: 0,
          balanceDue: 9000,
          status: "open",
          paymentMethod: null,
        },
      ],
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.openBalance).toBe(15000);
    expect(board.summary.overdueBalance).toBe(15000);
    expect(board.summary.avgDaysToPay).toBe(23);
    expect(board.summary.riskScore).toBeGreaterThan(50);
    expect(board.currentWeather[0]?.title).toContain("Overdue AR");
    expect(board.cadencePattern[0]?.trace.join(" ")).toContain("Average days to pay");
    expect(board.seasonalCash[0]?.trace.join(" ")).toContain("May");
  });

  it("falls back gracefully when invoice history is quiet", () => {
    const board = buildCashflowWeatherBoard({
      accountId: "company-1",
      budgetCycleMonth: null,
      seasonalPattern: null,
      arBlock: null,
      invoices: [],
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.openBalance).toBe(0);
    expect(board.summary.overdueBalance).toBe(0);
    expect(board.currentWeather[0]?.confidence).toBe("low");
    expect(board.cadencePattern[0]?.confidence).toBe("low");
    expect(board.seasonalCash).toHaveLength(0);
  });
});
