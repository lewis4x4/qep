import { describe, expect, test } from "bun:test";
import {
  formatLaborPricingRule,
  normalizeServiceLaborBranchConfigRows,
  normalizeServiceLaborCompanyOptions,
  normalizeServiceLaborPricingRuleRows,
} from "./service-labor-pricing-utils";

describe("service-labor-pricing-utils", () => {
  test("formats fixed price rules", () => {
    expect(
      formatLaborPricingRule({
        location_code: null,
        customer_id: null,
        customer_group_label: null,
        work_order_status: "customer",
        labor_type_code: null,
        premium_code: null,
        default_premium_code: null,
        comment: null,
        pricing_code: "fixed_price",
        pricing_value: 175,
        active: true,
      }),
    ).toContain("$175.00/hr fixed");
  });

  test("formats percentage rules", () => {
    expect(
      formatLaborPricingRule({
        location_code: null,
        customer_id: null,
        customer_group_label: null,
        work_order_status: "customer",
        labor_type_code: null,
        premium_code: null,
        default_premium_code: null,
        comment: null,
        pricing_code: "list_plus_pct",
        pricing_value: 25,
        active: true,
      }),
    ).toBe("+25% list");
  });
});

describe("service labor pricing row normalizers", () => {
  test("normalizes branch config rows and numeric strings", () => {
    expect(normalizeServiceLaborBranchConfigRows([
      { id: "branch-1", branch_id: "01", default_labor_rate: "145.50" },
      { id: "missing-rate", branch_id: "02", default_labor_rate: "bad" },
      { id: "", branch_id: "03", default_labor_rate: 100 },
    ])).toEqual([
      { id: "branch-1", branch_id: "01", default_labor_rate: 145.5 },
    ]);
  });

  test("normalizes company options and filters malformed rows", () => {
    expect(normalizeServiceLaborCompanyOptions([
      { id: "company-1", name: "Acme Farms" },
      { id: "company-2", name: "" },
      { id: 42, name: "Bad ID" },
    ])).toEqual([
      { id: "company-1", name: "Acme Farms" },
    ]);
  });

  test("normalizes labor pricing rules and unwraps joined company arrays", () => {
    expect(normalizeServiceLaborPricingRuleRows([
      {
        id: "rule-1",
        location_code: "01",
        customer_id: "company-1",
        customer_group_label: null,
        work_order_status: "warranty",
        labor_type_code: "FIELD",
        premium_code: null,
        default_premium_code: "STD",
        comment: "Warranty field labor",
        pricing_code: "cost_plus_pct",
        pricing_value: "15",
        effective_start_on: "2026-01-01",
        effective_end_on: null,
        active: true,
        qrm_companies: [{ name: "Acme Farms" }],
      },
      {
        id: "bad-status",
        work_order_status: "retail",
        pricing_code: "fixed_price",
        pricing_value: 150,
        active: true,
      },
      {
        id: "bad-price",
        work_order_status: "customer",
        pricing_code: "fixed_price",
        pricing_value: "not a number",
        active: true,
      },
    ])).toEqual([
      {
        id: "rule-1",
        location_code: "01",
        customer_id: "company-1",
        customer_group_label: null,
        work_order_status: "warranty",
        labor_type_code: "FIELD",
        premium_code: null,
        default_premium_code: "STD",
        comment: "Warranty field labor",
        pricing_code: "cost_plus_pct",
        pricing_value: 15,
        active: true,
        effective_start_on: "2026-01-01",
        effective_end_on: null,
        qrm_companies: { name: "Acme Farms" },
      },
    ]);
  });

  test("returns empty arrays for non-array inputs", () => {
    expect(normalizeServiceLaborBranchConfigRows(null)).toEqual([]);
    expect(normalizeServiceLaborCompanyOptions({ id: "company-1" })).toEqual([]);
    expect(normalizeServiceLaborPricingRuleRows(undefined)).toEqual([]);
  });
});
