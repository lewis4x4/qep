import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeIncentive, resolveIncentiveStack } from "./logic.ts";

Deno.test("normalizes legacy and current manufacturer incentive shapes", () => {
  assertEquals(
    normalizeIncentive({
      id: "inc-1",
      oem_name: "ASV",
      program_name: "Cash in lieu",
      discount_type: "flat",
      discount_value: "2500",
      stackable: false,
      requires_approval: true,
    }),
    {
      id: "inc-1",
      manufacturer: "ASV",
      program_name: "Cash in lieu",
      discount_type: "flat",
      discount_value: 2500,
      stackable: false,
      stack_kind: "cash_alt",
      requires_approval: true,
    },
  );

  assertEquals(
    normalizeIncentive({
      id: "inc-2",
      manufacturer: "Bobcat",
      name: "Finance add-on",
      discount_type: "apr_buydown",
      discount_value: 1.5,
      stackable: true,
      stack_kind: "finance_addon",
    })?.stack_kind,
    "finance_addon",
  );
});

Deno.test("resolver applies always-on and finance add-ons while choosing one cash alternative", () => {
  const quote = { subtotal: 100_000, equipment_total: 90_000 };
  const normalized = [
    {
      id: "cash-low",
      manufacturer: "ASV",
      program_name: "Cash low",
      discount_type: "flat" as const,
      discount_value: 1000,
      stackable: false,
      stack_kind: "cash_alt" as const,
      requires_approval: false,
    },
    {
      id: "cash-high",
      manufacturer: "ASV",
      program_name: "Cash high",
      discount_type: "flat" as const,
      discount_value: 2500,
      stackable: false,
      stack_kind: "cash_alt" as const,
      requires_approval: false,
    },
    {
      id: "finance",
      manufacturer: "ASV",
      program_name: "Finance add-on",
      discount_type: "apr_buydown" as const,
      discount_value: 1,
      stackable: true,
      stack_kind: "finance_addon" as const,
      requires_approval: false,
    },
    {
      id: "always",
      manufacturer: "ASV",
      program_name: "Always on",
      discount_type: "cash_back" as const,
      discount_value: 750,
      stackable: true,
      stack_kind: "always_on" as const,
      requires_approval: false,
    },
  ];

  const result = resolveIncentiveStack(normalized, quote);

  assertEquals(result.applied.map((item) => item.incentive.id).sort(), ["always", "cash-high", "finance"]);
  assertEquals(result.applied.find((item) => item.incentive.id === "finance")?.amount, 900);
  assertEquals(result.skipped, [{
    incentive: normalized[0],
    reason: "cash alternative, lower value than selected peer",
  }]);
});
