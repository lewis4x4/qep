/**
 * programs.ts unit tests — F5 coverage
 *
 * The pricing engine's applyPrograms() reads low_rate_financing details as flat
 * scalars: { term_months, rate_pct, dealer_participation_pct, lender_name }.
 * The ingestion pipeline (extract-price-sheet → publish-price-sheet) normalizes
 * nested-array Claude output to that flat shape before writing to qb_programs.
 *
 * These tests cover:
 *   1. Flat-scalar path — existing fixture shape continues to work (non-regression).
 *   2. Nested-array path — if a program somehow reaches applyPrograms with the
 *      raw Claude shape, the output should degrade gracefully (no throws) and the
 *      payment will be NaN, which signals the normalization step was missed.
 *      This test documents the expected failure mode and ensures the code doesn't
 *      throw, making it easy to spot in QA rather than crashing the quote.
 */

import { describe, expect, it } from "bun:test";
import { applyPrograms } from "../programs.ts";
import type {
  PriceQuoteRequest,
  EquipmentResult,
  AttachmentsResult,
  ProgramFixture,
} from "../types.ts";

// ── Minimal stubs ────────────────────────────────────────────────────────────

const BRAND_STUB = {
  id: "brand-001",
  code: "YNM",
  name: "Yanmar",
  dealerDiscountPct: 0.30,
  markupTargetPct: 0.12,
  markupFloorPct: 0.10,
  tariffPct: 0.05,
  pdiDefaultCents: 50_000,
  goodFaithPct: 0.01,
  attachmentMarkupPct: 0.20,
  discountConfigured: true,
};

const MODEL_STUB = {
  id: "model-001",
  modelCode: "VIO55-6",
  nameDisplay: "Yanmar ViO55-6 Cab",
  listPriceCents: 9_500_000,
};

const EQUIPMENT_RESULT: EquipmentResult = {
  breakdown: {
    listPriceCents: 9_500_000,
    dealerDiscountCents: 2_850_000,
    dealerDiscountPct: 0.30,
    discountedPriceCents: 6_650_000,
    pdiCents: 50_000,
    goodFaithCents: 66_500,
    goodFaithPct: 0.01,
    freightCents: 194_200,
    freightZone: "FL_LARGE",
    tariffCents: 475_000,
    tariffPct: 0.05,
    equipmentCostCents: 7_435_700,
    markupPct: 0.12,
    markupCents: 892_284,
    baselineSalesPriceCents: 8_327_984,
  },
  brand: BRAND_STUB,
  model: MODEL_STUB,
  baselineSalesPriceCents: 8_327_984,
};

const ATTACHMENTS_RESULT: AttachmentsResult = {
  attachments: [],
  subtotal: { totalListCents: 0, totalCostCents: 0, totalSalesPriceCents: 0 },
};

const REQUEST_STUB: PriceQuoteRequest = {
  equipmentModelId: "model-001",
  customerType: "standard",
  deliveryState: "FL",
  financing: { programId: "prog-001", termMonths: 48 },
};

// ── Test 1: flat-scalar path (the normal case for all seeded programs) ────────

describe("applyPrograms — flat-scalar financing details (F5 non-regression)", () => {
  const flatProgram: ProgramFixture = {
    id: "prog-001",
    programType: "low_rate_financing",
    name: "Yanmar Finance Q1 2026 — 0% / 48mo",
    brandId: "brand-001",
    isActive: true,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    details: {
      term_months: 48,
      rate_pct: 0.0,
      dealer_participation_pct: 0.0,
      lender_name: "Yanmar Financial Services",
    },
  };

  const result = applyPrograms({
    request: REQUEST_STUB,
    equipmentResult: EQUIPMENT_RESULT,
    attachmentsResult: ATTACHMENTS_RESULT,
    validatedProgramIds: ["prog-001"],
    availablePrograms: [flatProgram],
  });

  it("produces a financing scenario", () => {
    expect(result.financingScenario).toBeDefined();
  });

  it("term matches requested termMonths override (48)", () => {
    expect(result.financingScenario?.termMonths).toBe(48);
  });

  it("payment is a finite integer (0% path: Math.round(financed / 48))", () => {
    const payment = result.financingScenario?.paymentCents ?? NaN;
    expect(Number.isFinite(payment)).toBe(true);
    expect(Number.isInteger(payment)).toBe(true);
    expect(payment).toBeGreaterThan(0);
  });

  it("dealer participation cost is 0 (0% participation)", () => {
    expect(result.dealerParticipationCostCents).toBe(0);
  });
});

// ── Test 2: nested-array path — documents graceful degradation ───────────────
// If a program reaches the calculator with the raw Claude extraction shape
// (before publish-price-sheet normalization), the engine must not throw.
// The payment will be NaN (term_months is undefined → NaN), which surfaces
// in QA rather than crashing the entire quote.

describe("applyPrograms — nested-array financing details (pre-normalization shape)", () => {
  const nestedProgram: ProgramFixture = {
    id: "prog-002",
    programType: "low_rate_financing",
    name: "ASV Finance — nested shape",
    brandId: "brand-001",
    isActive: true,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    details: {
      // This is the raw Claude extraction shape (terms array, not flat scalars).
      // publish-price-sheet normalizes this before writing; if it somehow reaches
      // applyPrograms, we want a clear NaN signal rather than a throw.
      terms: [
        { months: 48, rate_pct: 0.0, dealer_participation_pct: 0.0 },
        { months: 60, rate_pct: 0.0199, dealer_participation_pct: 0.03 },
      ],
      lenders: [{ name: "ASV Finance", customer_type: "retail" }],
    },
  };

  const req: PriceQuoteRequest = {
    ...REQUEST_STUB,
    financing: { programId: "prog-002", termMonths: 48 },
  };

  it("does not throw on nested-array shape", () => {
    expect(() =>
      applyPrograms({
        request: req,
        equipmentResult: EQUIPMENT_RESULT,
        attachmentsResult: ATTACHMENTS_RESULT,
        validatedProgramIds: ["prog-002"],
        availablePrograms: [nestedProgram],
      })
    ).not.toThrow();
  });

  it("payment is NaN when details.term_months is undefined — signals missing normalization", () => {
    const result = applyPrograms({
      request: req,
      equipmentResult: EQUIPMENT_RESULT,
      attachmentsResult: ATTACHMENTS_RESULT,
      validatedProgramIds: ["prog-002"],
      availablePrograms: [nestedProgram],
    });
    // term_months reads undefined from flat field; 0% path: Math.round(financed / undefined) = NaN
    // This is the expected failure mode — publish-price-sheet normalization prevents this in prod.
    const payment = result.financingScenario?.paymentCents;
    expect(Number.isNaN(payment)).toBe(true);
  });
});
