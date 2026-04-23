import { describe, expect, test } from "bun:test";

import {
  amortizedMonthlyPayment,
  computePaymentFor,
  filterDisplayableScenarios,
  scenarioKey,
} from "../financing-math";
import type { DealRoomFinanceScenario, DealRoomQuote } from "../deal-room-api";

function makeQuote(overrides: Partial<DealRoomQuote> = {}): DealRoomQuote {
  return {
    id: "q1",
    quote_number: null,
    status: "draft",
    customer_name: null,
    customer_company: null,
    branch_slug: null,
    equipment: [],
    attachments_included: [],
    subtotal: 47_000,
    equipment_total: 47_000,
    attachment_total: 0,
    discount_total: 2_350,
    trade_credit: 0,
    net_total: 44_650,
    tax_total: 0,
    cash_down: 10_000,
    amount_financed: 34_650,
    customer_total: 44_650,
    financing_scenarios: [],
    selected_finance_scenario: null,
    ai_recommendation: null,
    created_at: null,
    updated_at: null,
    expires_at: null,
    sent_at: null,
    viewed_at: null,
    ...overrides,
  };
}

function makeScenario(overrides: Partial<DealRoomFinanceScenario> = {}): DealRoomFinanceScenario {
  return {
    label: "Custom Finance 60 mo",
    type: "finance",
    term_months: 60,
    apr: 7.5,
    rate: null,
    monthly_payment: 694.31,
    total_cost: 41_658.9,
    lender: "Custom terms",
    ...overrides,
  };
}

describe("amortizedMonthlyPayment", () => {
  test("returns 0 for zero principal", () => {
    expect(amortizedMonthlyPayment(0, 7.5, 60)).toBe(0);
  });
  test("returns 0 for non-positive term", () => {
    expect(amortizedMonthlyPayment(10_000, 7.5, 0)).toBe(0);
  });
  test("straight-line for 0% APR", () => {
    expect(amortizedMonthlyPayment(12_000, 0, 24)).toBe(500);
  });
  test("matches standard amortization at 7.5% for 60 months on $34,650", () => {
    const payment = amortizedMonthlyPayment(34_650, 7.5, 60);
    // Expected ≈ 694.31 per a standard amortization table.
    expect(Math.abs(payment - 694.31)).toBeLessThan(1);
  });
});

describe("computePaymentFor", () => {
  test("cash scenarios short-circuit to principal with zero monthly", () => {
    const quote = makeQuote();
    const scenario = makeScenario({ label: "Cash", type: "cash", apr: 0, term_months: 0 });
    const result = computePaymentFor(quote, scenario, { cashDown: 10_000, termMonths: 60, scenarioKey: "Cash" });
    expect(result.isCash).toBe(true);
    expect(result.monthlyPayment).toBe(0);
    expect(result.amountFinanced).toBe(0);
    expect(result.totalCost).toBe(34_650);
  });

  test("finance recomputes on new cash-down", () => {
    const quote = makeQuote();
    const scenario = makeScenario();
    const lowDown = computePaymentFor(quote, scenario, { cashDown: 0, termMonths: 60, scenarioKey: "x" });
    const highDown = computePaymentFor(quote, scenario, { cashDown: 20_000, termMonths: 60, scenarioKey: "x" });
    expect(highDown.amountFinanced).toBeLessThan(lowDown.amountFinanced);
    expect(highDown.monthlyPayment).toBeLessThan(lowDown.monthlyPayment);
  });

  test("cash-down clamps to customer_total", () => {
    const quote = makeQuote({ customer_total: 10_000 });
    const scenario = makeScenario();
    const result = computePaymentFor(quote, scenario, { cashDown: 99_999_999, termMonths: 60, scenarioKey: "x" });
    expect(result.amountFinanced).toBe(0);
    expect(result.monthlyPayment).toBe(0);
  });

  test("longer term lowers monthly payment", () => {
    const quote = makeQuote();
    const scenario = makeScenario();
    const short = computePaymentFor(quote, scenario, { cashDown: 10_000, termMonths: 36, scenarioKey: "x" });
    const long = computePaymentFor(quote, scenario, { cashDown: 10_000, termMonths: 84, scenarioKey: "x" });
    expect(long.monthlyPayment).toBeLessThan(short.monthlyPayment);
  });
});

describe("filterDisplayableScenarios", () => {
  test("drops cash placeholders with all-zero data", () => {
    const scenarios = [
      makeScenario({ type: "cash", monthly_payment: null, term_months: 0, rate: 0, apr: 0 }),
      makeScenario({ type: "finance" }),
    ];
    expect(filterDisplayableScenarios(scenarios)).toHaveLength(1);
  });
  test("keeps cash scenarios with populated data", () => {
    const scenarios = [makeScenario({ type: "cash", total_cost: 44_650, monthly_payment: 0, apr: 0, term_months: 0 })];
    // monthly_payment is explicitly null in the placeholder filter; 0 counts.
    expect(filterDisplayableScenarios(scenarios)).toHaveLength(1);
  });
});

describe("scenarioKey", () => {
  test("uses label when present", () => {
    expect(scenarioKey(makeScenario({ label: "60-mo standard" }))).toBe("60-mo standard");
  });
  test("falls back to type when label missing", () => {
    expect(scenarioKey(makeScenario({ label: null, type: "cash" }))).toBe("cash");
  });
});
