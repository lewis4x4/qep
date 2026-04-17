/**
 * Fixture 5: Yanmar ViO55 — non-OEM attachment financing cap exceeded
 *
 * Purpose: validates the non-OEM attachment roll-in logic. When a non-OEM
 * (third-party) attachment's sales price plus the machine baseline would exceed
 * the financing cap (machine list + OEM attachment list), the engine caps the
 * financed amount and emits a programStackingWarning.
 *
 * Setup: Yanmar ViO55 + one non-OEM grapple ($15,000 cost, no OEM catalog
 * attachments) with 0% / 48-month financing.
 *
 *   maxFinancedCents = machine list (9_500_000) + OEM attachment list (0) = 9_500_000
 *   machine baseline = 8_327_984 (same as Fixture 1)
 *   non-OEM sales    = 1_800_000  (15_000 cost × 1.20 markup)
 *   8_327_984 + 1_800_000 = 10_127_984 > 9_500_000 → capped!
 *   overCap          = 627_984
 *   totalFinanced    = 9_500_000  (capped to machine list)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAND CALCULATION (all values in cents)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Equipment chain (identical to Fixture 1 — same machine, same freight):
 *   equipment_cost_cents        = 7_435_700
 *   baseline_sales_price_cents  = 8_327_984  (12% markup)
 *
 * Custom non-OEM attachment (no list price; cost is the floor):
 *   costCents                   = 1_500_000  ($15,000)
 *   markupCents                 = Math.round(1_500_000 × 0.20) = 300_000
 *   salesPriceCents             = 1_500_000 + 300_000 = 1_800_000
 *   listPriceCents              = 1_500_000  (attachments.ts sets list = cost for custom)
 *   oemBranded                  = false
 *
 * Financing cap check (programs.ts):
 *   oemAttachmentListTotal      = 0  (no OEM catalog attachments)
 *   maxFinancedCents            = 9_500_000 + 0 = 9_500_000
 *   oemAttachmentSales          = 0
 *   totalFinanced before cap    = 8_327_984 + 0 = 8_327_984
 *   nonOemSales                 = 1_800_000
 *   8_327_984 + 1_800_000       = 10_127_984 > 9_500_000 → cap triggered
 *   overCap                     = 10_127_984 − 9_500_000 = 627_984
 *   totalFinancedCents          = 9_500_000  (capped)
 *   paymentCents                = Math.round(9_500_000 / 48)
 *                               = Math.round(197_916.667) = 197_917
 *
 * CUSTOMER TOTALS
 *   customerSubtotalCents          = 8_327_984 + 1_800_000 = 10_127_984
 *   customerRebatesCents           = 0  (financing is neutral on customer price)
 *   customerPriceAfterRebatesCents = 10_127_984
 *   customerTradeInAllowanceCents  = 0
 *   taxCents = Math.round(10_127_984 × 0.07)
 *            = Math.round(708_958.88) = 708_959
 *   docFeeCents = 40_000
 *   customerTotalCents = 10_127_984 + 708_959 + 40_000 = 10_876_943
 *
 * MARGIN
 *   dealerCostTotalCents = 7_435_700 + 1_500_000 + 0 = 8_935_700
 *   dealerRevenueCents   = 10_127_984
 *   grossMarginCents     = 10_127_984 − 8_935_700 = 1_192_284
 *   markupAchievedPct    = 1_192_284 / 8_935_700 ≈ 0.1334  (13.34%)
 *   commissionCents      = Math.floor(1_192_284 × 0.15)
 *                        = Math.floor(178_842.6) = 178_842
 *   requiresApproval     = false  (13.34% > 10% floor; non-OEM attachment markup = 20%)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PriceQuoteRequest, QuoteContext } from "../../types";

// ── Stable UUIDs ──────────────────────────────────────────────────────────────

export const YANMAR_BRAND_ID_F5       = "00000000-0000-0000-0000-000000000001";  // same as Fixture 1
export const YANMAR_VIO55_MODEL_ID_F5 = "00000000-0000-0000-0000-000000000002";  // same as Fixture 1
export const PROGRAM_48MO_0PCT_ID_F5  = "00000000-0000-0000-0000-000000000020";  // same as Fixture 1

// ── Request ───────────────────────────────────────────────────────────────────

export const REQUEST: PriceQuoteRequest = {
  equipmentModelId: YANMAR_VIO55_MODEL_ID_F5,
  customerType: "standard",
  deliveryState: "FL",
  attachments: [],  // no OEM catalog attachments
  customAttachments: [
    {
      description: "Third-party grapple (non-OEM)",
      costCents: 1_500_000,  // $15,000 — non-OEM cost; no list price
      // salesPriceCents not provided → engine computes cost × 1.20 = 1_800_000
      oemBranded: false,
    },
  ],
  financing: {
    programId: PROGRAM_48MO_0PCT_ID_F5,
    termMonths: 48,
  },
  docFeeCents: 40_000,
};

// ── Context ───────────────────────────────────────────────────────────────────

export const CTX: QuoteContext = {
  model: {
    id: YANMAR_VIO55_MODEL_ID_F5,
    model_code: "VIO55-6-CAB-AB",
    name_display: "Yanmar ViO 55 — Cab w/ A/C, Angle Blade",
    list_price_cents: 9_500_000,  // ⚠ PLACEHOLDER (same as Fixture 1)
    frame_size: "large",
    workspace_id: "default",
    brand: {
      id: YANMAR_BRAND_ID_F5,
      code: "YANMAR",
      name: "Yanmar",
      discount_configured: true,
      dealer_discount_pct: 0.30,
      markup_target_pct: 0.12,
      markup_floor_pct: 0.10,
      tariff_pct: 0.05,
      pdi_default_cents: 50_000,
      good_faith_pct: 0.01,
      attachment_markup_pct: 0.20,
    },
  },
  freightCents: 194_200,
  freightZone: "FL_LARGE",
  taxRatePct: 0.07,
  programs: [
    {
      id: PROGRAM_48MO_0PCT_ID_F5,
      programType: "low_rate_financing",
      name: "Yanmar Finance Q1 2026 — 0% / 48mo",
      brandId: YANMAR_BRAND_ID_F5,
      isActive: true,
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      details: {
        term_months: 48,
        rate_pct: 0.0,
        dealer_participation_pct: 0.0,
        lender_name: "Yanmar Financial Services",
      },
    },
  ],
  catalogAttachments: [],  // custom attachment is in request.customAttachments, not here
};

// ── Expected output — pinned from hand-calculation ────────────────────────────

export const EXPECTED = {
  // Equipment chain (same as Fixture 1)
  breakdown: {
    listPriceCents:           9_500_000,
    dealerDiscountCents:      2_850_000,
    dealerDiscountPct:        0.30,
    discountedPriceCents:     6_650_000,
    pdiCents:                    50_000,
    goodFaithCents:              66_500,
    goodFaithPct:                0.01,
    freightCents:               194_200,
    freightZone:             "FL_LARGE",
    tariffCents:                475_000,
    tariffPct:                   0.05,
    equipmentCostCents:       7_435_700,
    markupPct:                   0.12,
    markupCents:                892_284,
    baselineSalesPriceCents:  8_327_984,
  },

  // Custom non-OEM attachment
  attachments: [
    {
      attachmentId: null,
      description: "Third-party grapple (non-OEM)",
      quantity: 1,
      listPriceCents:  1_500_000,  // cost = list for custom items (no catalog list price)
      discountCents:           0,
      costCents:       1_500_000,
      markupPct:            0.20,
      markupCents:       300_000,
      salesPriceCents: 1_800_000,
      oemBranded: false,
    },
  ],
  attachmentsSubtotal: {
    totalListCents:       1_500_000,
    totalCostCents:       1_500_000,
    totalSalesPriceCents: 1_800_000,
  },

  // Financing — capped at machine list
  financingScenario: {
    programId:                    PROGRAM_48MO_0PCT_ID_F5,
    lenderName:                   "Yanmar Financial Services",
    termMonths:                   48,
    ratePct:                      0.0,
    paymentCents:                 197_917,  // Math.round(9_500_000 / 48)
    totalFinancedCents:           9_500_000, // CAPPED (machine list 9_500_000 + 0 OEM)
    dealerParticipationPct:       0.0,
    dealerParticipationCostCents: 0,
  },

  customerSubtotalCents:            10_127_984,  // 8_327_984 + 1_800_000
  customerRebatesCents:                      0,
  customerPriceAfterRebatesCents:   10_127_984,
  customerTradeInAllowanceCents:             0,
  taxRatePct:                            0.07,
  taxCents:                            708_959,  // Math.round(10_127_984 × 0.07)
  docFeeCents:                          40_000,
  customerTotalCents:                10_876_943,  // 10_127_984 + 708_959 + 40_000

  dealerCostTotalCents:     8_935_700,  // 7_435_700 + 1_500_000
  dealerRevenueCents:      10_127_984,
  grossMarginCents:         1_192_284,  // 10_127_984 − 8_935_700
  grossMarginPctApprox:     0.1177,     // 1_192_284 / 10_127_984
  markupAchievedPctApprox:  0.1334,     // 1_192_284 / 8_935_700
  commissionCents:            178_842,  // Math.floor(1_192_284 × 0.15)

  requiresApproval: false,
  approvalReasons: [] as string[],
  // The cap warning goes into programStackingWarnings (merged from programsResult.warnings)
  programStackingWarningsLength: 1,
} as const;
