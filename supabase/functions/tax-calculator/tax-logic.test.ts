import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeFederalExciseTax, computeQuoteTax } from "./tax-logic.ts";

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

Deno.test("Florida county surtax applies Columbia 1.5% rate only to the $5K cap", () => {
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
      county_surtax_rate: 0.015,
      surtax_cap_amount: 5000,
    },
  });

  assertEquals(result.state_tax, 3_000);
  assertEquals(result.county_tax, 75);
  assertEquals(result.total_tax, 3_075);
  assertEquals(result.tax_lines[1]?.cap_applied, 5_000);
});

Deno.test("E01420 Columbia County invoice caps discretionary surtax per item", () => {
  // Invoice E01420: one big equipment line above the $5,000 cap plus two
  // smaller items under the cap. Ship-To sourced to Columbia County, FL
  // (1.5% discretionary surtax, $5,000 per-item cap).
  const bigItem = 60_000;
  const midItem = 3_000;
  const smallItem = 1_500;
  const cap = 5_000;
  const countyRate = 0.015;

  const result = computeQuoteTax({
    subtotal: bigItem + midItem + smallItem,
    discountTotal: 0,
    tradeAllowance: 0,
    taxProfile: "standard",
    stateCode: "FL",
    shipToCounty: "Columbia",
    lineItems: [
      { description: "Grapple truck (E01420)", taxable_amount: bigItem },
      { description: "Attachment kit", taxable_amount: midItem },
      { description: "Delivery prep", taxable_amount: smallItem },
    ],
    jurisdiction: {
      id: "jurisdiction-columbia",
      state_code: "FL",
      county_name: "Columbia",
      state_rate: 0.06,
      county_surtax_rate: countyRate,
      surtax_cap_amount: cap,
    },
  });

  // State tax applies to the full taxable basis.
  assertEquals(result.state_tax, 3_870);
  // Per-item cap: big item capped to $5,000; small items counted in full.
  const expectedCountyBasis = cap + midItem + smallItem; // 9,500
  assertEquals(result.county_tax, expectedCountyBasis * countyRate); // 142.50
  assertEquals(result.county_tax, 142.5);
  assertEquals(result.total_tax, 3_870 + 142.5);
  assertEquals(result.tax_lines[1]?.cap_applied, cap);
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

Deno.test("federal excise tax computes separately at the configured rate", () => {
  const result = computeFederalExciseTax({
    taxableBasis: 100_000,
    applicable: true,
    rate: 0.12,
  });

  assertEquals(result.fet_amount, 12_000);
  assertEquals(result.fet_rate, 0.12);
  assertEquals(result.fet_lines[0]?.applies_to, "federal_excise_tax");
});

Deno.test("verified FET exemption preserves certificate metadata and zeros amount", () => {
  const result = computeFederalExciseTax({
    taxableBasis: 100_000,
    applicable: true,
    rate: 0.12,
    exemptionApplied: true,
    exemptionLabel: "FET exempt (cert #FET-1)",
    certificateId: "cert-1",
  });

  assertEquals(result.fet_amount, 0);
  assertEquals(result.fet_exemption_applied, true);
  assertEquals(result.fet_certificate_id, "cert-1");
  assertEquals(result.fet_lines[0]?.amount, 0);
});
