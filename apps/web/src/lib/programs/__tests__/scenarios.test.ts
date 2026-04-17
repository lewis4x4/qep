/**
 * Unit tests: scenario builder
 *
 * Verifies scenario generation logic — no DB calls.
 */

import { describe, it, expect } from "bun:test";
import { buildScenarios } from "../scenarios.ts";
import type { QuoteContext, ProgramRecommendation } from "../types.ts";

const BRAND_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const MODEL_ID = "cccccccc-0000-0000-0000-000000000003";

function makeContext(overrides: Partial<QuoteContext> = {}): QuoteContext {
  return {
    brandId: BRAND_ID,
    equipmentModelId: MODEL_ID,
    modelCode: "RT-135",
    modelYear: 2025,
    customerType: "standard",
    dealDate: new Date("2026-02-15"),
    listPriceCents: 10_000_000,
    ...overrides,
  };
}

function rec(
  id: string,
  type: string,
  eligible: boolean,
  benefitCents?: number,
  meta?: Record<string, unknown>,
): ProgramRecommendation {
  return {
    programId: id,
    programCode: `CODE_${id}`,
    name: `Program ${id}`,
    programType: type as any,
    eligibility: {
      eligible,
      reasons: eligible ? ["Eligible"] : ["Not eligible"],
      amountCents: benefitCents,
      metadata: meta,
    },
    estimatedCustomerBenefitCents: eligible ? benefitCents : undefined,
    notes: [],
  };
}

const EQUIPMENT_COST  = 8_000_000;  // $80,000
const BASELINE_SALES  = 9_000_000;  // $90,000 (12.5% markup)

describe("buildScenarios", () => {
  it("returns at least one scenario (baseline cash) when no programs apply", () => {
    const result = buildScenarios({
      context: makeContext(),
      recommendations: [],
      equipmentCostCents: EQUIPMENT_COST,
      baselineSalesPriceCents: BASELINE_SALES,
      markupPct: 0.125,
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].label).toMatch(/cash/i);
    expect(result[0].programIds).toHaveLength(0);
  });

  it("generates a CIL scenario when CIL is eligible", () => {
    const recommendations = [rec("cil1", "cash_in_lieu", true, 800000)];
    const result = buildScenarios({
      context: makeContext(),
      recommendations,
      equipmentCostCents: EQUIPMENT_COST,
      baselineSalesPriceCents: BASELINE_SALES,
      markupPct: 0.125,
    });
    const cilScenario = result.find((s) => s.label === "Cash + rebate");
    expect(cilScenario).toBeDefined();
    expect(cilScenario!.customerOutOfPocketCents).toBe(BASELINE_SALES - 800000);
    expect(cilScenario!.programIds).toContain("cil1");
    // Commission = 15% of gross margin
    expect(cilScenario!.commissionCents).toBe(
      Math.floor(cilScenario!.dealerMarginCents * 0.15),
    );
    // Human-sounding pro
    expect(cilScenario!.pros.some((p) => p.includes("$8,000"))).toBe(true);
  });

  it("generates a financing scenario with correct monthly payment at 0%", () => {
    const terms = [
      { months: 48, rate_pct: 0.0, dealer_participation_pct: 0.0 },
    ];
    const recommendations = [
      rec("fin1", "low_rate_financing", true, undefined, { terms, lenders: [] }),
    ];
    const result = buildScenarios({
      context: makeContext(),
      recommendations,
      equipmentCostCents: EQUIPMENT_COST,
      baselineSalesPriceCents: BASELINE_SALES,
      markupPct: 0.125,
    });
    const finScenario = result.find((s) => s.termMonths === 48);
    expect(finScenario).toBeDefined();
    // 0%: payment = Math.round(9_000_000 / 48) = 187500
    expect(finScenario!.monthlyPaymentCents).toBe(Math.round(BASELINE_SALES / 48));
    expect(finScenario!.label).toMatch(/0%.*48|48.*0%/i);
  });

  it("stacks CIL + aged inventory into one scenario", () => {
    const recommendations = [
      rec("cil1", "cash_in_lieu",  true, 800000),
      rec("aged1", "aged_inventory", true, 400000),
    ];
    const result = buildScenarios({
      context: makeContext({ modelYear: 2024 }),
      recommendations,
      equipmentCostCents: EQUIPMENT_COST,
      baselineSalesPriceCents: BASELINE_SALES,
      markupPct: 0.125,
    });
    const stacked = result.find((s) => s.programIds.includes("cil1") && s.programIds.includes("aged1"));
    expect(stacked).toBeDefined();
    expect(stacked!.customerOutOfPocketCents).toBe(BASELINE_SALES - 800000 - 400000);
    expect(stacked!.label).toMatch(/\$12,000|\$1,200/); // total stacked rebate
  });

  it("generates GMU scenario for GMU customer", () => {
    const recommendations = [
      rec("gmu1", "gmu_rebate", true, 800000), // 8% of 10_000_000
    ];
    const result = buildScenarios({
      context: makeContext({ customerType: "gmu", listPriceCents: 10_000_000 }),
      recommendations,
      equipmentCostCents: EQUIPMENT_COST,
      baselineSalesPriceCents: BASELINE_SALES,
      markupPct: 0.125,
    });
    const gmuScenario = result.find((s) => s.label === "GMU pricing");
    expect(gmuScenario).toBeDefined();
    expect(gmuScenario!.programIds).toContain("gmu1");
  });

  it("all scenarios have human-sounding copy (no AI-speak patterns)", () => {
    const recommendations = [
      rec("cil1", "cash_in_lieu", true, 800000),
    ];
    const result = buildScenarios({
      context: makeContext(),
      recommendations,
      equipmentCostCents: EQUIPMENT_COST,
      baselineSalesPriceCents: BASELINE_SALES,
      markupPct: 0.125,
    });
    for (const scenario of result) {
      for (const pro of scenario.pros) {
        // These are the AI-speak anti-patterns from the spec
        expect(pro).not.toMatch(/utility function|optimize|maximize.*synerg/i);
      }
    }
  });
});
