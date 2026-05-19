import { describe, expect, test } from "bun:test";
import { pickSalesPrimaryAction } from "./sales-primary-action";
import type { RepPipelineDeal } from "./types";

function deal(overrides: Partial<RepPipelineDeal> = {}): RepPipelineDeal {
  return {
    deal_id: overrides.deal_id ?? crypto.randomUUID(),
    company_id: "c1",
    customer_name: "Acme",
    primary_contact_name: null,
    primary_contact_phone: null,
    stage: "qualified",
    stage_sort: 1,
    amount: 100_000,
    deal_name: "Acme — 5T forklift",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expected_close_on: null,
    last_activity_at: null,
    next_follow_up_at: null,
    days_since_activity: 2,
    heat_status: "warm",
    deal_score: 80,
    ...overrides,
  };
}

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const twoWeeksOut = () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

describe("pickSalesPrimaryAction", () => {
  test("empty pipeline → start your first quote", () => {
    const action = pickSalesPrimaryAction([]);
    expect(action.kind).toBe("start_first_quote");
    expect(action.label).toBe("Start your first quote");
    expect(action.to).toBe("/sales/quotes/new");
  });

  test("closing-this-week + cold → confirm closing deal (priority 1)", () => {
    const action = pickSalesPrimaryAction([
      deal({ customer_name: "Beacon", heat_status: "cold", expected_close_on: tomorrow(), amount: 200_000 }),
      deal({ customer_name: "Other", heat_status: "warm", amount: 500_000 }),
    ]);
    expect(action.kind).toBe("confirm_closing_deal");
    expect(action.label).toBe("Confirm Beacon");
    expect(action.to).toBe(`/sales/deals/${action.dealId}`);
  });

  test("no closing-soon but cold deals → recover highest-value cold (priority 2)", () => {
    const action = pickSalesPrimaryAction([
      deal({ customer_name: "Small", heat_status: "cold", amount: 10_000, days_since_activity: 12 }),
      deal({ customer_name: "Big Cold", heat_status: "cold", amount: 500_000, days_since_activity: 8 }),
    ]);
    expect(action.kind).toBe("recover_cold_deal");
    expect(action.label).toBe("Recover Big Cold");
    expect(action.reason).toContain("8d");
  });

  test("closing-soon, no cold/cooling → confirm closing deal (priority 3)", () => {
    const action = pickSalesPrimaryAction([
      deal({ customer_name: "Beacon", heat_status: "warm", expected_close_on: tomorrow(), amount: 100_000 }),
    ]);
    expect(action.kind).toBe("confirm_closing_deal");
    expect(action.reason.toLowerCase()).toContain("lock the win");
  });

  test("only cooling deals → re-engage highest-value (priority 4)", () => {
    const action = pickSalesPrimaryAction([
      deal({ customer_name: "Cool Co", heat_status: "cooling", amount: 80_000 }),
      deal({ customer_name: "Less", heat_status: "cooling", amount: 40_000 }),
    ]);
    expect(action.kind).toBe("engage_quiet_customer");
    expect(action.label).toBe("Re-engage Cool Co");
  });

  test("healthy pipeline → default start a new quote", () => {
    const action = pickSalesPrimaryAction([
      deal({ heat_status: "warm", expected_close_on: twoWeeksOut(), amount: 200_000 }),
      deal({ heat_status: "warm", expected_close_on: null, amount: 80_000 }),
    ]);
    expect(action.kind).toBe("start_quote");
    expect(action.label).toBe("Start a new quote");
    expect(action.to).toBe("/sales/quotes/new");
  });
});
