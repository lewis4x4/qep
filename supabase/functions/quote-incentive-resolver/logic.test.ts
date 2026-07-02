import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type IncentiveDiscountType,
  type IncentiveStackKind,
  type NormalizedIncentive,
  normalizeIncentive,
  resolveIncentiveStack,
} from "./logic.ts";

const quote = { subtotal: 100_000, equipment_total: 90_000 };

function incentive(
  id: string,
  overrides: Partial<NormalizedIncentive> = {},
): NormalizedIncentive {
  return {
    id,
    manufacturer: "ASV",
    program_name: id,
    discount_type: "flat",
    discount_value: 1000,
    stackable: false,
    stack_kind: "cash_alt",
    requires_approval: false,
    ...overrides,
  };
}

function appliedIds(incentives: readonly NormalizedIncentive[]): string[] {
  return resolveIncentiveStack(incentives, quote)
    .applied
    .map((item) => item.incentive.id)
    .sort();
}

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
      stackable: false,
      stack_kind: "finance_addon",
    })?.stack_kind,
    "finance_addon",
  );
});

Deno.test("resolver applies a cash-only incentive when it is the selected cash alternative", () => {
  assertEquals(appliedIds([incentive("cash-only")]), ["cash-only"]);
});

Deno.test("resolver applies a finance-only add-on even when legacy stackable is false", () => {
  assertEquals(
    appliedIds([
      incentive("finance-only", {
        discount_type: "apr_buydown" as IncentiveDiscountType,
        discount_value: 1,
        stackable: false,
        stack_kind: "finance_addon" as IncentiveStackKind,
      }),
    ]),
    ["finance-only"],
  );
});

Deno.test("resolver treats cash_alt incentives as mutually exclusive peers", () => {
  const cashLow = incentive("cash-low", { discount_value: 1000 });
  const cashHigh = incentive("cash-high", { discount_value: 2500 });

  const result = resolveIncentiveStack([cashLow, cashHigh], quote);

  assertEquals(result.applied.map((item) => item.incentive.id), ["cash-high"]);
  assertEquals(result.skipped, [{
    incentive: cashLow,
    reason: "cash alternative, lower value than selected peer",
  }]);
});

Deno.test("resolver stacks finance_addon with the selected cash alternative", () => {
  assertEquals(
    appliedIds([
      incentive("cash", { discount_value: 2500 }),
      incentive("finance", {
        discount_type: "apr_buydown" as IncentiveDiscountType,
        discount_value: 1,
        stackable: false,
        stack_kind: "finance_addon" as IncentiveStackKind,
      }),
    ]),
    ["cash", "finance"],
  );
});

Deno.test("resolver always applies always_on incentives with other eligible rules", () => {
  assertEquals(
    appliedIds([
      incentive("cash", { discount_value: 2500 }),
      incentive("always", {
        discount_type: "cash_back" as IncentiveDiscountType,
        discount_value: 750,
        stackable: true,
        stack_kind: "always_on" as IncentiveStackKind,
      }),
    ]),
    ["always", "cash"],
  );
});
