import { assertEquals } from "jsr:@std/assert@1";
import {
  deriveWorkOrderStatus,
  evaluateLaborMargin,
  normalizeServiceEquipmentClass,
  resolveLaborCostRate,
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
  equipment_class_code: null,
  labor_type_code: null,
  premium_code: null,
  default_premium_code: "STD",
  pricing_code: "fixed_price",
  pricing_value: 165,
  field_mileage_rate: 0,
  labor_cost_rate: 74.25,
  target_margin_pct: 55,
  floor_margin_pct: 35,
  internal_discount_pct: 10,
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

Deno.test("selectApplicableLaborPricingRule considers equipment class and lets explicit labor type win", () => {
  const rules = [
    {
      ...baseRule,
      id: "large",
      equipment_class_code: "large_construction",
      pricing_value: 185,
    },
    {
      ...baseRule,
      id: "field",
      equipment_class_code: null,
      labor_type_code: "field",
      pricing_value: 185,
      field_mileage_rate: 2,
    },
  ];
  const selected = selectApplicableLaborPricingRule(rules, {
    locationCode: "OCALA",
    customerId: null,
    workOrderStatus: "customer",
    equipmentClassCode: "large_construction",
    laborTypeCode: "field",
  });
  assertEquals(selected?.id, "field");
});

Deno.test("normalizeServiceEquipmentClass maps owner H1 buckets", () => {
  assertEquals(normalizeServiceEquipmentClass("Forestry Mulcher"), "forestry");
  assertEquals(
    normalizeServiceEquipmentClass("skid steer"),
    "compact_construction",
  );
  assertEquals(
    normalizeServiceEquipmentClass("Large Excavator"),
    "large_construction",
  );
  assertEquals(normalizeServiceEquipmentClass("unknown"), null);
});

Deno.test("resolveLaborRate honors fixed, percentage, and internal discount modes", () => {
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
  assertEquals(
    resolveLaborRate(165, baseRule, { workOrderStatus: "internal" }),
    148.5,
  );
  assertEquals(
    resolveLaborRate(
      165,
      { ...baseRule, work_order_status: "internal", pricing_value: 150 },
      { workOrderStatus: "internal" },
    ),
    150,
  );
});

Deno.test("resolveLaborCostRate prefers technician, rule, branch, then target-margin fallback", () => {
  assertEquals(
    resolveLaborCostRate({
      technicianCostRate: 90,
      rule: baseRule,
      laborRate: 165,
    }),
    90,
  );
  assertEquals(resolveLaborCostRate({ rule: baseRule, laborRate: 165 }), 74.25);
  assertEquals(
    resolveLaborCostRate({
      rule: { ...baseRule, labor_cost_rate: null },
      branchDefaultCostRate: 80,
      laborRate: 165,
    }),
    80,
  );
  assertEquals(
    resolveLaborCostRate({
      rule: { ...baseRule, labor_cost_rate: null },
      laborRate: 200,
      targetMarginPct: 55,
    }),
    90,
  );
});

Deno.test("evaluateLaborMargin warns below target and blocks below floor", () => {
  assertEquals(
    evaluateLaborMargin({ quantity: 1, unitPrice: 185, costRate: 83.25 })
      .status,
    "target_met",
  );
  assertEquals(
    evaluateLaborMargin({ quantity: 1, unitPrice: 150, costRate: 85 }).status,
    "below_target",
  );
  assertEquals(
    evaluateLaborMargin({ quantity: 1, unitPrice: 140, costRate: 85 }).status,
    "near_floor",
  );
  const blocked = evaluateLaborMargin({
    quantity: 1,
    unitPrice: 120,
    costRate: 85,
  });
  assertEquals(blocked.status, "blocked_below_floor");
  assertEquals(blocked.floorBlocked, true);
});
