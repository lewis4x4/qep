/**
 * Unit tests: program eligibility checker
 *
 * Tests use inline qb_programs-shaped objects — no DB calls.
 * All acceptance criteria from SLICE_03_PROGRAM_ENGINE.md §"Acceptance Criteria".
 */

import { describe, it, expect } from "bun:test";
import { isEligible } from "../eligibility.ts";
import type { QuoteContext } from "../types.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

const BRAND_ID   = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER_BRAND = "bbbbbbbb-0000-0000-0000-000000000002";
const MODEL_ID   = "cccccccc-0000-0000-0000-000000000003";

/** A deal date firmly inside Q1 2026 */
const Q1_DATE = new Date("2026-02-15");
/** A deal date outside Q1 2026 (day before) */
const BEFORE_Q1 = new Date("2025-12-31");
/** A deal date outside Q1 2026 (day after) */
const AFTER_Q1  = new Date("2026-04-01");

function makeProgram(overrides: Record<string, unknown> = {}) {
  return {
    id: "prog-uuid-0001",
    workspace_id: "default",
    brand_id: BRAND_ID,
    program_code: "TEST_CIL",
    program_type: "cash_in_lieu",
    name: "Test CIL",
    effective_from: "2026-01-01",
    effective_to:   "2026-03-31",
    details: {
      rebates: [
        { model_code: "RT-135", amount_cents: 800000 },
        { model_code: "VT-75",  amount_cents: 750000 },
      ],
    },
    source_document_url: null,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  } as any;
}

function makeContext(overrides: Partial<QuoteContext> = {}): QuoteContext {
  return {
    brandId: BRAND_ID,
    equipmentModelId: MODEL_ID,
    modelCode: "RT-135",
    modelYear: 2025,
    customerType: "standard",
    dealDate: Q1_DATE,
    listPriceCents: 10_000_000,
    ...overrides,
  };
}

// ── Date window ───────────────────────────────────────────────────────────────

describe("isEligible — date window", () => {
  it("eligible on the effective_from day", () => {
    const ctx = makeContext({ dealDate: new Date("2026-01-01") });
    const result = isEligible(makeProgram(), ctx);
    expect(result.eligible).toBe(true);
  });

  it("eligible on the effective_to day (inclusive)", () => {
    const ctx = makeContext({ dealDate: new Date("2026-03-31") });
    const result = isEligible(makeProgram(), ctx);
    expect(result.eligible).toBe(true);
  });

  it("ineligible the day before effective_from", () => {
    const ctx = makeContext({ dealDate: BEFORE_Q1 });
    const result = isEligible(makeProgram(), ctx);
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/not active/i);
  });

  it("ineligible the day after effective_to", () => {
    const ctx = makeContext({ dealDate: AFTER_Q1 });
    const result = isEligible(makeProgram(), ctx);
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/not active|ask angela/i);
  });
});

// ── CIL ──────────────────────────────────────────────────────────────────────

describe("isEligible — cash_in_lieu", () => {
  it("returns eligible with correct amount for known model", () => {
    const result = isEligible(makeProgram(), makeContext({ modelCode: "RT-135" }));
    expect(result.eligible).toBe(true);
    expect(result.amountCents).toBe(800000);
    expect(result.reasons[0]).toMatch(/\$8,000/);
  });

  it("ineligible when model not in rebate list", () => {
    const result = isEligible(makeProgram(), makeContext({ modelCode: "DX225" }));
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/DX225/);
  });
});

// ── Financing ─────────────────────────────────────────────────────────────────

describe("isEligible — low_rate_financing", () => {
  const financingProg = makeProgram({
    program_type: "low_rate_financing",
    details: {
      terms: [
        { months: 48, rate_pct: 0.0000, dealer_participation_pct: 0.0000 },
        { months: 60, rate_pct: 0.0199, dealer_participation_pct: 0.0000 },
      ],
      lenders: [{ name: "Great America", customer_type: "commercial" }],
    },
  });

  it("eligible for standard customer — returns terms in metadata", () => {
    const result = isEligible(financingProg, makeContext());
    expect(result.eligible).toBe(true);
    expect(result.reasons[0]).toMatch(/48.*0%|0%.*48/i);
    expect((result.metadata as any)?.terms).toHaveLength(2);
  });
});

// ── GMU ──────────────────────────────────────────────────────────────────────

describe("isEligible — gmu_rebate", () => {
  const gmuProg = makeProgram({
    program_type: "gmu_rebate",
    details: {
      discount_off_list_pct: 0.08,
      requires_preapproval: true,
      preapproval_instructions: "Submit in YCENA Machine Order App.",
    },
  });

  it("ineligible when customer is standard (not GMU)", () => {
    const result = isEligible(gmuProg, makeContext({ customerType: "standard" }));
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/not gmu|isn't gmu/i);
  });

  it("ineligible when GMU customer has no pre-approval number", () => {
    const ctx = makeContext({
      customerType: "gmu",
      gmuDetails: { agencyType: "municipality" }, // no preApprovalNumber
    });
    const result = isEligible(gmuProg, ctx);
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/pre-approval/i);
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements![0]).toMatch(/YCENA/i);
  });

  it("eligible when GMU customer provides pre-approval number", () => {
    const ctx = makeContext({
      customerType: "gmu",
      gmuDetails: { agencyType: "municipality", preApprovalNumber: "GMU-2026-12345" },
    });
    const result = isEligible(gmuProg, ctx);
    expect(result.eligible).toBe(true);
    expect(result.amountCents).toBe(800000); // 8% of 10_000_000
    expect(result.reasons[0]).toMatch(/8%|8\.0%/);
  });
});

// ── Aged Inventory ────────────────────────────────────────────────────────────

describe("isEligible — aged_inventory", () => {
  const agedProg = makeProgram({
    program_type: "aged_inventory",
    details: {
      eligible_model_years: [2024, 2023, 2022, 2021],
      rebates: [{ model_code: "RT-135", amount_cents: 400000 }],
    },
  });

  it("eligible for MY2024 unit", () => {
    const result = isEligible(agedProg, makeContext({ modelCode: "RT-135", modelYear: 2024 }));
    expect(result.eligible).toBe(true);
    expect(result.amountCents).toBe(400000);
    expect(result.reasons[0]).toMatch(/MY2024|aged inventory/i);
  });

  it("ineligible for MY2025 unit (current model year)", () => {
    const result = isEligible(agedProg, makeContext({ modelCode: "RT-135", modelYear: 2025 }));
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/aged inventory/i);
    expect(result.reasons[0]).toMatch(/2025/);
  });

  it("ineligible when model not in aged inventory schedule", () => {
    const result = isEligible(agedProg, makeContext({ modelCode: "DX225", modelYear: 2024 }));
    expect(result.eligible).toBe(false);
  });

  it("ineligible when modelYear is null", () => {
    const result = isEligible(agedProg, makeContext({ modelCode: "RT-135", modelYear: null }));
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/unknown year|MY\?/i);
  });
});

// ── Bridge ────────────────────────────────────────────────────────────────────

describe("isEligible — bridge_rent_to_sales", () => {
  const bridgeProg = makeProgram({
    program_type: "bridge_rent_to_sales",
    details: {
      requires_reorder: false,
      can_combine_with_others: false,
      rebates: [{ model_code: "RT-135", amount_cents: 600000 }],
    },
  });

  it("ineligible for non-rental purchase", () => {
    const result = isEligible(bridgeProg, makeContext({ isRentalFleetPurchase: false }));
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/rental fleet|not.*rental/i);
  });

  it("eligible for rental fleet placement", () => {
    const result = isEligible(bridgeProg, makeContext({ isRentalFleetPurchase: true }));
    expect(result.eligible).toBe(true);
    expect(result.amountCents).toBe(600000);
    expect(result.reasons[0]).toMatch(/rental fleet/i);
  });
});

// ── Brand mismatch ────────────────────────────────────────────────────────────

describe("isEligible — brand guard", () => {
  it("ineligible when program brand_id doesn't match context brandId", () => {
    const prog = makeProgram({ brand_id: OTHER_BRAND });
    const result = isEligible(prog, makeContext()); // context uses BRAND_ID
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/different brand/i);
  });
});
