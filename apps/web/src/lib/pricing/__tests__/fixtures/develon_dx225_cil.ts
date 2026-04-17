/**
 * Fixture 3: Develon DX225LL-7-US20 — Cash-In-Lieu (CIL) $7,500
 *
 * Purpose: validates the CIL stacking path. CIL is a customer-facing rebate that
 * reduces the price the customer pays (but not the dealer cost). The resulting
 * markup falls below the 10% floor, triggering an approval requirement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INPUTS AND DECISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Machine list price: $348,353.49 = 34_835_349¢
 *   Source: SLICE_02_PRICING_ENGINE_CORE.md §"Fixture 3"
 *
 * Brand config (Develon — construction equipment, same tier as Yanmar/ASV):
 *   dealer_discount_pct   = 0.30  (30%)
 *   markup_target_pct     = 0.12  (12%)
 *   markup_floor_pct      = 0.10  (10%)
 *   tariff_pct            = 0.05  (5%)
 *   pdi_default_cents     = 50_000  ($500)
 *   good_faith_pct        = 0.01  (1%)
 *   attachment_markup_pct = 0.20  (20%)
 *   Note: ⚠ PLACEHOLDER — Develon brand not in Slice 01 seed;
 *   update these when Angela configures Develon discount rates.
 *
 * Freight: 250_000¢ ($2,500)  ⚠ PLACEHOLDER
 *   TODO(slice-04): confirm Develon FL freight zone with Rylee.
 *
 * CIL rebate: $7,500 = 750_000¢
 *   Source: SLICE_02_PRICING_ENGINE_CORE.md §"Fixture 3"
 *
 * No attachments, no financing (CIL and financing are mutually exclusive).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAND CALCULATION (all values in cents)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * STEP 2 — Dealer discount (30%)
 *   dealer_discount_cents = Math.round(34_835_349 × 0.30)
 *                         = Math.round(10_450_604.7) = 10_450_605
 *   discounted_price_cents = 34_835_349 − 10_450_605 = 24_384_744
 *
 * STEP 3 — PDI ($500)
 *   pdi_cents = 50_000
 *   discounted_plus_pdi = 24_384_744 + 50_000 = 24_434_744
 *
 * STEP 4 — Good faith (1% of discounted price)
 *   good_faith_cents = Math.round(24_384_744 × 0.01)
 *                    = Math.round(243_847.44) = 243_847
 *   subtotal_with_good_faith = 24_434_744 + 243_847 = 24_678_591
 *
 * STEP 5 — Freight ($2,500 PLACEHOLDER)
 *   freight_cents = 250_000
 *   subtotal_with_freight = 24_678_591 + 250_000 = 24_928_591
 *
 * STEP 6 — Tariff (5% of LIST)
 *   tariff_cents = Math.round(34_835_349 × 0.05)
 *               = Math.round(1_741_767.45) = 1_741_767
 *   equipment_cost_cents = 24_928_591 + 1_741_767 = 26_670_358
 *
 * STEP 7 — Markup (12% target, standard customer)
 *   markup_cents = Math.round(26_670_358 × 0.12)
 *               = Math.round(3_200_442.96) = 3_200_443
 *   baseline_sales_price_cents = 26_670_358 + 3_200_443 = 29_870_801
 *
 * CIL PROGRAM — $7,500 customer rebate
 *   customerSubtotalCents          = 29_870_801
 *   customerRebatesCents           = 750_000  (CIL)
 *   customerPriceAfterRebatesCents = 29_870_801 − 750_000 = 29_120_801
 *   customerTradeInAllowanceCents  = 0
 *   taxCents = Math.round(29_120_801 × 0.07)
 *            = Math.round(2_038_456.07) = 2_038_456
 *   docFeeCents = 40_000
 *   customerTotalCents = 29_120_801 + 2_038_456 + 40_000 = 31_199_257
 *
 * MARGIN
 *   dealerCostTotalCents = 26_670_358 + 0 + 0 = 26_670_358
 *   dealerRevenueCents   = 29_120_801  (after CIL rebate; tax/doc are pass-through)
 *   grossMarginCents     = 29_120_801 − 26_670_358 = 2_450_443
 *   grossMarginPct       = 2_450_443 / 29_120_801 ≈ 0.0841  (8.41%)
 *   markupAchievedPct    = 2_450_443 / 26_670_358 ≈ 0.0919  (9.19%)
 *   commissionCents      = Math.floor(2_450_443 × 0.15)
 *                        = Math.floor(367_566.45) = 367_566
 *   requiresApproval     = true  (9.19% < 10% floor — CIL erodes markup)
 *   approvalReasons      = ["Markup 9.2% is below the 10% floor for Develon."]
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PriceQuoteRequest, QuoteContext } from "../../types";

// ── Stable UUIDs ──────────────────────────────────────────────────────────────

export const DEVELON_BRAND_ID       = "00000000-0000-0000-0000-000000000005";
export const DEVELON_DX225_MODEL_ID = "00000000-0000-0000-0000-000000000006";
export const PROGRAM_CIL_7500_ID    = "00000000-0000-0000-0000-000000000021";

// ── Request ───────────────────────────────────────────────────────────────────

export const REQUEST: PriceQuoteRequest = {
  equipmentModelId: DEVELON_DX225_MODEL_ID,
  customerType: "standard",
  deliveryState: "FL",
  attachments: [],
  cashInLieuProgramId: PROGRAM_CIL_7500_ID,
  docFeeCents: 40_000,
};

// ── Context ───────────────────────────────────────────────────────────────────

export const CTX: QuoteContext = {
  model: {
    id: DEVELON_DX225_MODEL_ID,
    model_code: "DX225LL-7-US20",
    name_display: "Develon DX225LL-7-US20 Long Reach Excavator",
    list_price_cents: 34_835_349, // $348,353.49 — from SLICE_02 spec
    frame_size: "large",
    workspace_id: "default",
    brand: {
      id: DEVELON_BRAND_ID,
      code: "DEVELON",
      name: "Develon",
      discount_configured: true, // ⚠ PLACEHOLDER — will be set by Angela
      dealer_discount_pct: 0.30,
      markup_target_pct: 0.12,
      markup_floor_pct: 0.10,
      tariff_pct: 0.05,
      pdi_default_cents: 50_000,
      good_faith_pct: 0.01,
      attachment_markup_pct: 0.20,
    },
  },
  freightCents: 250_000,  // ⚠ PLACEHOLDER — TODO(slice-04): confirm Develon FL freight with Rylee
  freightZone: "FL_LARGE",
  taxRatePct: 0.07,
  programs: [
    {
      id: PROGRAM_CIL_7500_ID,
      programType: "cash_in_lieu",
      name: "Develon Q1 2026 Cash-In-Lieu $7,500",
      brandId: DEVELON_BRAND_ID,
      isActive: true,
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      details: {
        rebate_amount_cents: 750_000, // $7,500
      },
    },
  ],
  catalogAttachments: [],
};

// ── Expected output — pinned from hand-calculation ────────────────────────────

export const EXPECTED = {
  breakdown: {
    listPriceCents:           34_835_349,
    dealerDiscountCents:      10_450_605,
    dealerDiscountPct:        0.30,
    discountedPriceCents:     24_384_744,
    pdiCents:                     50_000,
    goodFaithCents:              243_847,
    goodFaithPct:                0.01,
    freightCents:                250_000,
    freightZone:             "FL_LARGE",
    tariffCents:               1_741_767,
    tariffPct:                   0.05,
    equipmentCostCents:       26_670_358,
    markupPct:                    0.12,
    markupCents:               3_200_443,
    baselineSalesPriceCents:  29_870_801,
  },

  customerSubtotalCents:             29_870_801,
  customerRebatesCents:                 750_000,  // CIL $7,500
  customerPriceAfterRebatesCents:    29_120_801,
  customerTradeInAllowanceCents:              0,
  taxRatePct:                            0.07,
  taxCents:                          2_038_456,  // Math.round(29_120_801 × 0.07)
  docFeeCents:                          40_000,
  customerTotalCents:                31_199_257,  // 29_120_801 + 2_038_456 + 40_000

  dealerCostTotalCents:    26_670_358,
  dealerRevenueCents:      29_120_801,
  grossMarginCents:         2_450_443,
  grossMarginPctApprox:     0.0841,  // 2_450_443 / 29_120_801
  markupAchievedPctApprox:  0.0919,  // 2_450_443 / 26_670_358 — below 10% floor!
  commissionCents:            367_566,  // Math.floor(2_450_443 × 0.15)

  requiresApproval: true,            // markup < 10% floor triggers approval
  approvalReasonsLength: 1,          // one reason: markup below floor
  programStackingWarnings: [] as string[],
} as const;
