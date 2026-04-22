import { assertEquals } from "jsr:@std/assert@1";
import {
  deriveWorkOrderStatus,
  resolveLaborRate,
  selectApplicableLaborPricingRule,
  type ServiceLaborPricingRule,
} from "./service-labor-pricing.ts";

const baseRule: ServiceLaborPricingRule = {
  id: "rule-1",
  location_code: "OCALA",
  customer_id: null,
  customer_group_label: null,
  work_order_status: "customer",
  labor_type_code: null,
  premium_code: null,
  default_premium_code: "STD",
  pricing_code: "fixed_price",
  pricing_value: 165,
  effective_start_on: null,
  effective_end_on: null,
  active: true,
  created_at: "2026-04-22T00:00:00.000Z",
};

Deno.test("deriveWorkOrderStatus maps flags", () => {
  assertEquals(deriveWorkOrderStatus(["internal"]), "internal");
  assertEquals(deriveWorkOrderStatus(["warranty_recall"]), "warranty");
  assertEquals(deriveWorkOrderStatus([]), "customer");
});

Deno.test("selectApplicableLaborPricingRule prefers more specific customer match", () => {
  const rules = [
    baseRule,
    {
      ...baseRule,
      id: "rule-2",
      customer_id: "cust-1",
      pricing_value: 180,
      created_at: "2026-04-23T00:00:00.000Z",
    },
  ];
  const selected = selectApplicableLaborPricingRule(rules, {
    locationCode: "OCALA",
    customerId: "cust-1",
    workOrderStatus: "customer",
  });
  assertEquals(selected?.id, "rule-2");
});

Deno.test("resolveLaborRate honors fixed and percentage modes", () => {
  assertEquals(resolveLaborRate(150, baseRule), 165);
  assertEquals(
    resolveLaborRate(150, {
      ...baseRule,
      pricing_code: "cost_plus_pct",
      pricing_value: 10,
    }),
    165,
  );
  assertEquals(
    resolveLaborRate(150, {
      ...baseRule,
      pricing_code: "list_minus_pct",
      pricing_value: 10,
    }),
    135,
  );
});
