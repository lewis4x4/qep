import { describe, expect, test } from "bun:test";
import { formatLaborPricingRule } from "./service-labor-pricing-utils";

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
