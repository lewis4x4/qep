import { describe, expect, test } from "bun:test";
import {
  normalizeQuoteFinanceScenario,
  normalizeQuoteFinancingPreview,
} from "../quote-api";

describe("normalizeQuoteFinanceScenario", () => {
  test("maps snake_case backend fields into the shared frontend contract", () => {
    const scenario = normalizeQuoteFinanceScenario({
      type: "finance",
      term_months: 60,
      rate: 6.5,
      monthly_payment: 1999.42,
      total_cost: 119_965.2,
      lender: "Preferred lender",
    });

    expect(scenario.label).toBe("Finance 60 mo");
    expect(scenario.termMonths).toBe(60);
    expect(scenario.apr).toBe(6.5);
    expect(scenario.monthlyPayment).toBe(1999.42);
    expect(scenario.totalCost).toBe(119_965.2);
  });
});

describe("normalizeQuoteFinancingPreview", () => {
  test("normalizes the full preview envelope", () => {
    const preview = normalizeQuoteFinancingPreview({
      scenarios: [
        { type: "cash", label: "Cash", total_cost: 95_500 },
        { type: "lease", term_months: 48, apr: 5.25, monthly_payment: 1800, total_cost: 110_000 },
      ],
      amount_financed: 75_500,
      tax_total: 4_500,
      customer_total: 95_500,
      discount_total: 11_500,
      margin_check: { flagged: true, message: "Margin below 10%" },
      incentives: {
        applicable: [{ id: "inc-1", name: "Spring Cash", discount_type: "cash", discount_value: 2_500, estimated_savings: 2_500 }],
        total_savings: 2_500,
      },
    });

    expect(preview.scenarios).toHaveLength(2);
    expect(preview.amountFinanced).toBe(75_500);
    expect(preview.taxTotal).toBe(4_500);
    expect(preview.customerTotal).toBe(95_500);
    expect(preview.discountTotal).toBe(11_500);
    expect(preview.margin_check?.message).toBe("Margin below 10%");
    expect(preview.incentives?.total_savings).toBe(2_500);
  });
});
