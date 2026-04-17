/**
 * Fixture 6: Yanmar ViO55 — 7% markup override (below 10% floor)
 *
 * Purpose: validates the dual-approval path where both the markup-below-floor
 * trigger AND the explicit override trigger fire simultaneously. The rep sets
 * markup to 7% which is below Yanmar's 10% floor, producing two approval reasons:
 *   1. Markup 7.0% is below the 10% floor for Yanmar.
 *   2. You overrode the price: "<reason>"
 *
 * No attachments (keeps the approval logic isolated from attachment markup checks).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAND CALCULATION (all values in cents)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Equipment chain (identical to Fixture 1 up through tariff):
 *   equipment_cost_cents = 7_435_700
 *
 * STEP 7 — Markup override (7%)
 *   markup_cents = Math.round(7_435_700 × 0.07)
 *               = Math.round(520_499.0) = 520_499
 *   baseline_sales_price_cents = 7_435_700 + 520_499 = 7_956_199
 *
 * CUSTOMER TOTALS (no attachments, no programs)
 *   customerSubtotalCents          = 7_956_199
 *   customerRebatesCents           = 0
 *   customerPriceAfterRebatesCents = 7_956_199
 *   customerTradeInAllowanceCents  = 0
 *   taxCents = Math.round(7_956_199 × 0.07)
 *            = Math.round(556_933.93) = 556_934
 *   docFeeCents = 40_000
 *   customerTotalCents = 7_956_199 + 556_934 + 40_000 = 8_553_133
 *
 * MARGIN
 *   dealerCostTotalCents = 7_435_700
 *   dealerRevenueCents   = 7_956_199
 *   grossMarginCents     = 7_956_199 − 7_435_700 = 520_499
 *   grossMarginPct       = 520_499 / 7_956_199 ≈ 0.0654  (6.54%)
 *   markupAchievedPct    = 520_499 / 7_435_700 ≈ 0.0700  (exactly 7.00%)
 *   commissionCents      = Math.floor(520_499 × 0.15)
 *                        = Math.floor(78_074.85) = 78_074
 *   requiresApproval     = true  (TWO reasons below)
 *   approvalReasons[0]   = "Markup 7.0% is below the 10% floor for Yanmar."
 *   approvalReasons[1]   = 'You overrode the price: "Competitive situation — match competitor bid"'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PriceQuoteRequest, QuoteContext } from "../../types";

// ── Stable UUIDs ──────────────────────────────────────────────────────────────

export const YANMAR_BRAND_ID_F6       = "00000000-0000-0000-0000-000000000001";  // same brand as F1
export const YANMAR_VIO55_MODEL_ID_F6 = "00000000-0000-0000-0000-000000000002";  // same model as F1
export const OVERRIDE_REQUESTED_BY_F6 = "00000000-0000-0000-0000-000000000098";

// ── Request ───────────────────────────────────────────────────────────────────

export const REQUEST: PriceQuoteRequest = {
  equipmentModelId: YANMAR_VIO55_MODEL_ID_F6,
  customerType: "standard",
  deliveryState: "FL",
  attachments: [],
  markupOverride: {
    markupPct: 0.07,
    reason: "Competitive situation — match competitor bid",
    requestedBy: OVERRIDE_REQUESTED_BY_F6,
  },
  docFeeCents: 40_000,
};

// ── Context ───────────────────────────────────────────────────────────────────

export const CTX: QuoteContext = {
  model: {
    id: YANMAR_VIO55_MODEL_ID_F6,
    model_code: "VIO55-6-CAB-AB",
    name_display: "Yanmar ViO 55 — Cab w/ A/C, Angle Blade",
    list_price_cents: 9_500_000,  // ⚠ PLACEHOLDER (same as Fixture 1)
    frame_size: "large",
    workspace_id: "default",
    brand: {
      id: YANMAR_BRAND_ID_F6,
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
  programs: [],
  catalogAttachments: [],
};

// ── Expected output — pinned from hand-calculation ────────────────────────────

export const EXPECTED = {
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
    markupPct:                   0.07,    // from override
    markupCents:                520_499,  // Math.round(7_435_700 × 0.07)
    baselineSalesPriceCents:  7_956_199,
  },

  customerSubtotalCents:            7_956_199,
  customerRebatesCents:                     0,
  customerPriceAfterRebatesCents:   7_956_199,
  customerTradeInAllowanceCents:            0,
  taxRatePct:                           0.07,
  taxCents:                           556_934,  // Math.round(7_956_199 × 0.07)
  docFeeCents:                         40_000,
  customerTotalCents:               8_553_133,  // 7_956_199 + 556_934 + 40_000

  dealerCostTotalCents:   7_435_700,
  dealerRevenueCents:     7_956_199,
  grossMarginCents:         520_499,  // 7_956_199 − 7_435_700
  grossMarginPctApprox:     0.0654,   // 520_499 / 7_956_199
  markupAchievedPctApprox:  0.0700,   // 520_499 / 7_435_700 — exactly 7%
  commissionCents:           78_074,  // Math.floor(520_499 × 0.15)

  requiresApproval: true,        // two reasons
  approvalReasonsLength: 2,      // (1) below 10% floor, (2) override present
  programStackingWarnings: [] as string[],
} as const;
