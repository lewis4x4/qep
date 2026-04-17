/**
 * Fixture 4: Bandit Industries chipper — 14% markup override, 15% forestry floor
 *
 * Purpose: validates the forestry brand approval path. Bandit uses a 15% markup
 * floor (higher than construction's 10%). A rep overrides markup to 14%, which is
 * both below floor AND an explicit override — producing two approval reasons.
 *
 * Note: Bandit is one of the 10 forestry brands with discount_configured = false
 * in the production seed. This fixture sets discount_configured = true to test
 * the pricing logic in isolation. In production, Angela must configure rates before
 * any Bandit quote can be priced. The DISCOUNT_NOT_CONFIGURED guard is tested
 * separately.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INPUTS AND DECISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Machine list price: $180,000 = 18_000_000¢  ⚠ PLACEHOLDER
 *   TODO(slice-04): confirm Bandit model + list price from price sheet.
 *
 * Brand config (Bandit — forestry, 15% markup floor):
 *   dealer_discount_pct   = 0.30  ⚠ PLACEHOLDER (Angela must configure)
 *   markup_target_pct     = 0.15  (15% — forestry default)
 *   markup_floor_pct      = 0.15  (15% floor — same as target for forestry)
 *   tariff_pct            = 0.05  (5%)
 *   pdi_default_cents     = 50_000  ($500)
 *   good_faith_pct        = 0.01  (1%)
 *   attachment_markup_pct = 0.20  (20%)
 *
 * Freight: 300_000¢ ($3,000)  ⚠ PLACEHOLDER
 *   TODO(slice-04): confirm Bandit FL freight zone with Rylee.
 *
 * Markup override: 14% = 0.14 (below 15% floor — triggers approval)
 *
 * No attachments, no programs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAND CALCULATION (all values in cents)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * STEP 2 — Dealer discount (30%)
 *   dealer_discount_cents = Math.round(18_000_000 × 0.30) = 5_400_000
 *   discounted_price_cents = 18_000_000 − 5_400_000 = 12_600_000
 *
 * STEP 3 — PDI ($500)
 *   pdi_cents = 50_000
 *   discounted_plus_pdi = 12_600_000 + 50_000 = 12_650_000
 *
 * STEP 4 — Good faith (1% of discounted price)
 *   good_faith_cents = Math.round(12_600_000 × 0.01) = 126_000
 *   subtotal_with_good_faith = 12_650_000 + 126_000 = 12_776_000
 *
 * STEP 5 — Freight ($3,000 PLACEHOLDER)
 *   freight_cents = 300_000
 *   subtotal_with_freight = 12_776_000 + 300_000 = 13_076_000
 *
 * STEP 6 — Tariff (5% of LIST)
 *   tariff_cents = Math.round(18_000_000 × 0.05) = 900_000
 *   equipment_cost_cents = 13_076_000 + 900_000 = 13_976_000
 *
 * STEP 7 — Markup override (14%)
 *   markup_cents = Math.round(13_976_000 × 0.14)
 *               = Math.round(1_956_640.0) = 1_956_640
 *   baseline_sales_price_cents = 13_976_000 + 1_956_640 = 15_932_640
 *
 * CUSTOMER TOTALS (no attachments, no programs)
 *   customerSubtotalCents          = 15_932_640
 *   customerRebatesCents           = 0
 *   customerPriceAfterRebatesCents = 15_932_640
 *   taxCents = Math.round(15_932_640 × 0.07)
 *            = Math.round(1_115_284.8) = 1_115_285
 *   docFeeCents = 40_000
 *   customerTotalCents = 15_932_640 + 1_115_285 + 40_000 = 17_087_925
 *
 * MARGIN
 *   dealerCostTotalCents = 13_976_000
 *   dealerRevenueCents   = 15_932_640
 *   grossMarginCents     = 15_932_640 − 13_976_000 = 1_956_640
 *   markupAchievedPct    = 1_956_640 / 13_976_000 = 0.14000  (exactly 14.0%)
 *   commissionCents      = Math.floor(1_956_640 × 0.15)
 *                        = Math.floor(293_496.0) = 293_496
 *   requiresApproval     = true  (TWO reasons below)
 *   approvalReasons[0]   = "Markup 14.0% is below the 15% floor for Bandit."
 *   approvalReasons[1]   = 'You overrode the price: "Demo concession — customer insisted"'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PriceQuoteRequest, QuoteContext } from "../../types";

// ── Stable UUIDs ──────────────────────────────────────────────────────────────

export const BANDIT_BRAND_ID         = "00000000-0000-0000-0000-000000000007";
export const BANDIT_CHIPPER_MODEL_ID = "00000000-0000-0000-0000-000000000008";
export const OVERRIDE_REQUESTED_BY   = "00000000-0000-0000-0000-000000000099";

// ── Request ───────────────────────────────────────────────────────────────────

export const REQUEST: PriceQuoteRequest = {
  equipmentModelId: BANDIT_CHIPPER_MODEL_ID,
  customerType: "standard",
  deliveryState: "FL",
  attachments: [],
  markupOverride: {
    markupPct: 0.14,
    reason: "Demo concession — customer insisted",
    requestedBy: OVERRIDE_REQUESTED_BY,
  },
  docFeeCents: 40_000,
};

// ── Context ───────────────────────────────────────────────────────────────────

export const CTX: QuoteContext = {
  model: {
    id: BANDIT_CHIPPER_MODEL_ID,
    model_code: "BANDIT-200XP",
    name_display: "Bandit 200XP Whole Tree Chipper",
    list_price_cents: 18_000_000, // ⚠ PLACEHOLDER — TODO(slice-04): real Bandit list price
    frame_size: "large",
    workspace_id: "default",
    brand: {
      id: BANDIT_BRAND_ID,
      code: "BANDIT",
      name: "Bandit",
      // ⚠ FIXTURE OVERRIDE: discount_configured=true to exercise pricing logic.
      // In production, Bandit ships with discount_configured=false until Angela sets rates.
      discount_configured: true,
      dealer_discount_pct: 0.30,  // ⚠ PLACEHOLDER — Angela must confirm
      markup_target_pct: 0.15,
      markup_floor_pct: 0.15,     // Forestry floor is 15%, not 10%
      tariff_pct: 0.05,
      pdi_default_cents: 50_000,
      good_faith_pct: 0.01,
      attachment_markup_pct: 0.20,
    },
  },
  freightCents: 300_000,  // ⚠ PLACEHOLDER — TODO(slice-04): confirm Bandit FL freight
  freightZone: "FL_LARGE",
  taxRatePct: 0.07,
  programs: [], // no programs
  catalogAttachments: [],
};

// ── Expected output — pinned from hand-calculation ────────────────────────────

export const EXPECTED = {
  breakdown: {
    listPriceCents:           18_000_000,
    dealerDiscountCents:       5_400_000,
    dealerDiscountPct:         0.30,
    discountedPriceCents:     12_600_000,
    pdiCents:                     50_000,
    goodFaithCents:              126_000,
    goodFaithPct:                 0.01,
    freightCents:                300_000,
    freightZone:             "FL_LARGE",
    tariffCents:                 900_000,
    tariffPct:                    0.05,
    equipmentCostCents:       13_976_000,
    markupPct:                    0.14,   // from override
    markupCents:               1_956_640,
    baselineSalesPriceCents:  15_932_640,
  },

  customerSubtotalCents:             15_932_640,
  customerRebatesCents:                       0,
  customerPriceAfterRebatesCents:    15_932_640,
  customerTradeInAllowanceCents:              0,
  taxRatePct:                             0.07,
  taxCents:                          1_115_285,  // Math.round(15_932_640 × 0.07)
  docFeeCents:                          40_000,
  customerTotalCents:                17_087_925,

  dealerCostTotalCents:    13_976_000,
  dealerRevenueCents:      15_932_640,
  grossMarginCents:         1_956_640,
  grossMarginPctApprox:     0.1228,  // 1_956_640 / 15_932_640
  markupAchievedPctApprox:  0.1400,  // exactly 14.0% — below 15% forestry floor
  commissionCents:            293_496,  // Math.floor(1_956_640 × 0.15)

  requiresApproval: true,         // two reasons
  approvalReasonsLength: 2,       // (1) below floor, (2) override present
  programStackingWarnings: [] as string[],
} as const;
