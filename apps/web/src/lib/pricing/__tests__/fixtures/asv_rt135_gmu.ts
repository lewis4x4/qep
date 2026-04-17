/**
 * Fixture 2: ASV RT-135 — GMU customer (government/municipality pricing tier)
 *
 * Purpose: validates the GMU equipment pricing path where the customer price is
 * fixed at 8% off list rather than a dealer-markup calculation. The cost chain
 * (discount → PDI → good faith → freight → tariff) runs identically to standard.
 * markupCents / markupPct in the breakdown are the implied values derived from
 * (gmuPrice - equipmentCost).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INPUTS AND DECISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Machine list price: $85,000 = 8,500,000¢  ⚠ PLACEHOLDER
 *   Update once Slice 04 seeds real ASV RT-135 list prices.
 *
 * Brand config (aligned with Yanmar per Slice 01 seed conventions):
 *   dealer_discount_pct  = 0.30  (30%)
 *   markup_target_pct    = 0.12  (12% — irrelevant for GMU; GMU price is fixed)
 *   markup_floor_pct     = 0.10  (10%)
 *   tariff_pct           = 0.05  (5%)
 *   pdi_default_cents    = 50_000  ($500)
 *   good_faith_pct       = 0.01  (1%)
 *   attachment_markup_pct = 0.20  (20%)
 *
 * Freight: FL large frame = $1,942 = 194_200¢  (shared ASV/Yanmar FL zone)
 *
 * GMU agency: local government, no pre-approval number (demo scenario)
 *
 * No attachments, no financing (GMU pricing tier blocks retail incentives).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAND CALCULATION (all values in cents)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * STEP 2 — Dealer discount (30%)
 *   dealer_discount_cents = Math.round(8_500_000 × 0.30) = 2_550_000
 *   discounted_price_cents = 8_500_000 − 2_550_000 = 5_950_000
 *
 * STEP 3 — PDI ($500)
 *   pdi_cents = 50_000
 *   discounted_plus_pdi = 5_950_000 + 50_000 = 6_000_000
 *
 * STEP 4 — Good faith (1% of discounted price)
 *   good_faith_cents = Math.round(5_950_000 × 0.01) = 59_500
 *   subtotal_with_good_faith = 6_000_000 + 59_500 = 6_059_500
 *
 * STEP 5 — Freight (FL large)
 *   freight_cents = 194_200
 *   subtotal_with_freight = 6_059_500 + 194_200 = 6_253_700
 *
 * STEP 6 — Tariff (5% of LIST)
 *   tariff_cents = Math.round(8_500_000 × 0.05) = 425_000
 *   equipment_cost_cents = 6_253_700 + 425_000 = 6_678_700
 *
 * STEP 7 — GMU price (8% off list)
 *   gmu_price_cents = Math.round(8_500_000 × 0.92) = 7_820_000
 *   markup_cents     = 7_820_000 − 6_678_700 = 1_141_300
 *   markup_pct       = 1_141_300 / 6_678_700 ≈ 0.1709  (implied, not targeted)
 *   baseline_sales_price_cents = 7_820_000
 *
 * CUSTOMER TOTALS (no attachments, no programs, not tax exempt)
 *   customerSubtotalCents          = 7_820_000
 *   customerRebatesCents           = 0
 *   customerPriceAfterRebatesCents = 7_820_000
 *   customerTradeInAllowanceCents  = 0
 *   taxCents = Math.round(7_820_000 × 0.07)
 *            = Math.round(547_400.0) = 547_400
 *   docFeeCents = 40_000
 *   customerTotalCents = 7_820_000 + 547_400 + 40_000 = 8_407_400
 *
 * MARGIN
 *   dealerCostTotalCents = 6_678_700 + 0 + 0 = 6_678_700
 *   dealerRevenueCents   = 7_820_000
 *   grossMarginCents     = 7_820_000 − 6_678_700 = 1_141_300
 *   grossMarginPct       = 1_141_300 / 7_820_000 ≈ 0.1459  (14.59%)
 *   markupAchievedPct    = 1_141_300 / 6_678_700 ≈ 0.1709  (17.09%)
 *   commissionCents      = Math.floor(1_141_300 × 0.15)
 *                        = Math.floor(171_195.0) = 171_195
 *   requiresApproval     = false  (17.09% > 10% floor; no override; no attachments)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PriceQuoteRequest, QuoteContext } from "../../types";

// ── Stable UUIDs for the fixture ─────────────────────────────────────────────

export const ASV_BRAND_ID       = "00000000-0000-0000-0000-000000000003";
export const ASV_RT135_MODEL_ID = "00000000-0000-0000-0000-000000000004";

// ── Request ───────────────────────────────────────────────────────────────────

export const REQUEST: PriceQuoteRequest = {
  equipmentModelId: ASV_RT135_MODEL_ID,
  customerType: "gmu",
  gmuDetails: {
    agencyType: "local_gov",
    // No pre-approval number — demo/exercise scenario
  },
  deliveryState: "FL",
  attachments: [],
  docFeeCents: 40_000,
};

// ── Context ───────────────────────────────────────────────────────────────────

export const CTX: QuoteContext = {
  model: {
    id: ASV_RT135_MODEL_ID,
    model_code: "RT-135",
    name_display: "ASV RT-135 Forestry",
    list_price_cents: 8_500_000, // ⚠ PLACEHOLDER — update from Slice 04 price sheet
    frame_size: "large",
    workspace_id: "default",
    brand: {
      id: ASV_BRAND_ID,
      code: "ASV",
      name: "ASV",
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
  programs: [], // GMU blocks retail incentive programs; no programs applicable
  catalogAttachments: [],
};

// ── Expected output — pinned from hand-calculation ────────────────────────────

export const EXPECTED = {
  breakdown: {
    listPriceCents:           8_500_000,
    dealerDiscountCents:      2_550_000,
    dealerDiscountPct:        0.30,
    discountedPriceCents:     5_950_000,
    pdiCents:                    50_000,
    goodFaithCents:              59_500,
    goodFaithPct:                0.01,
    freightCents:               194_200,
    freightZone:             "FL_LARGE",
    tariffCents:                425_000,
    tariffPct:                   0.05,
    equipmentCostCents:       6_678_700,
    // GMU implied markup: 1_141_300 / 6_678_700 — tested with toBeCloseTo
    markupCents:              1_141_300,
    baselineSalesPriceCents:  7_820_000,
  },

  customerSubtotalCents:             7_820_000,
  customerRebatesCents:              0,
  customerPriceAfterRebatesCents:    7_820_000,
  customerTradeInAllowanceCents:     0,
  taxRatePct:                        0.07,
  taxCents:                          547_400,  // Math.round(7_820_000 × 0.07)
  docFeeCents:                       40_000,
  customerTotalCents:                8_407_400, // 7_820_000 + 547_400 + 40_000

  dealerCostTotalCents:    6_678_700,
  dealerRevenueCents:      7_820_000,
  grossMarginCents:        1_141_300,
  grossMarginPctApprox:    0.1459,   // 1_141_300 / 7_820_000
  markupAchievedPctApprox: 0.1709,   // 1_141_300 / 6_678_700 (implied GMU markup)
  commissionCents:         171_195,  // Math.floor(1_141_300 × 0.15)

  requiresApproval: false,
  approvalReasons: [] as string[],
  programStackingWarnings: [] as string[],
  // GMU eligibility note is in programEligibilityNotes (not warnings)
  programEligibilityNotesMinLength: 1,
} as const;
