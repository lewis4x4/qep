import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeQuoteTax } from "./tax-logic.ts";

Deno.test("Florida tax applies 6% state tax after discount and trade", () => {
  const result = computeQuoteTax({
    subtotal: 50_000,
    discountTotal: 2_500,
    tradeAllowance: 10_000,
    taxProfile: "standard",
    stateCode: "FL",
    jurisdiction: {
      state_code: "FL",
      county_name: "Columbia",
      state_rate: 0.06,
      county_surtax_rate: 0,
      surtax_cap_amount: 5000,
    },
  });

  assertEquals(result.taxable_basis, 37_500);
  assertEquals(result.state_tax, 2_250);
  assertEquals(result.county_tax, 0);
  assertEquals(result.total_tax, 2_250);
});

Deno.test("Florida county surtax applies county rate only to cap", () => {
  const result = computeQuoteTax({
    subtotal: 50_000,
    discountTotal: 0,
    tradeAllowance: 0,
    taxProfile: "standard",
    stateCode: "FL",
    jurisdiction: {
      id: "jurisdiction-1",
      state_code: "FL",
      county_name: "Columbia",
      state_rate: 0.06,
      county_surtax_rate: 0.01,
      surtax_cap_amount: 5000,
    },
  });

  assertEquals(result.state_tax, 3_000);
  assertEquals(result.county_tax, 50);
  assertEquals(result.total_tax, 3_050);
  assertEquals(result.tax_lines[1]?.cap_applied, 5_000);
});

Deno.test("verified or selected exemptions zero out tax before overrides", () => {
  const result = computeQuoteTax({
    subtotal: 50_000,
    discountTotal: 0,
    tradeAllowance: 0,
    taxProfile: "agriculture_exempt",
    stateCode: "FL",
    exemptionsApplied: ["agriculture (cert #A-1)"],
    taxOverrideAmount: 999,
    taxOverrideReason: "Owner override",
    jurisdiction: {
      state_code: "FL",
      county_name: "Columbia",
      state_rate: 0.06,
      county_surtax_rate: 0.01,
      surtax_cap_amount: 5000,
    },
  });

  assertEquals(result.total_tax, 0);
  assertEquals(result.tax_lines, []);
  assertEquals(result.manual_override_applied, false);
  assertEquals(result.exemptions_applied, ["agriculture (cert #A-1)"]);
});

Deno.test("manual override returns audited override tax when not exempt", () => {
  const result = computeQuoteTax({
    subtotal: 50_000,
    discountTotal: 0,
    tradeAllowance: 0,
    taxProfile: "standard",
    stateCode: "FL",
    taxOverrideAmount: 1234.56,
    taxOverrideReason: "Tax desk confirmed cap exception",
    jurisdiction: {
      state_code: "FL",
      county_name: "Columbia",
      state_rate: 0.06,
      county_surtax_rate: 0.01,
      surtax_cap_amount: 5000,
    },
  });

  assertEquals(result.total_tax, 1234.56);
  assertEquals(result.manual_override_applied, true);
  assertEquals(result.tax_lines[0]?.applies_to, "manual_override");
});
