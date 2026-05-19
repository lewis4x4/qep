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
 * Machine list price: $295,000 = 29_500_000¢
 *   Source: live Supabase qb_equipment_models row for Bandit 2900T Whole-Tree Chipper,
 *   queried 2026-05-19.
 *
 * Brand config (Bandit — forestry, 15% markup floor):
 *   dealer_discount_pct   = 0.30  fixture override (live Bandit remains unconfigured)
 *   markup_target_pct     = 0.15  (15% — forestry default)
 *   markup_floor_pct      = 0.15  (15% floor — same as target for forestry)
 *   tariff_pct            = 0.05  (5%)
 *   pdi_default_cents     = 50_000  ($500)
 *   good_faith_pct        = 0.01  (1%)
 *   attachment_markup_pct = 0.20  (20%)
 *
 * Freight: 300_000¢ ($3,000) synthetic regression input.
 *   Live Supabase has no Bandit FL freight zone as of 2026-05-19; this fixture
 *   pins the approval math until Bandit freight is configured in qb_freight_zones.
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
 *   dealer_discount_cents = Math.round(29_500_000 × 0.30) = 8_850_000
 *   discounted_price_cents = 29_500_000 − 8_850_000 = 20_650_000
 *
 * STEP 3 — PDI ($500)
 *   pdi_cents = 50_000
 *   discounted_plus_pdi = 20_650_000 + 50_000 = 20_700_000
 *
 * STEP 4 — Good faith (1% of discounted price)
 *   good_faith_cents = Math.round(20_650_000 × 0.01) = 206_500
 *   subtotal_with_good_faith = 20_700_000 + 206_500 = 20_906_500
 *
 * STEP 5 — Freight ($3,000 synthetic regression input)
 *   freight_cents = 300_000
 *   subtotal_with_freight = 20_906_500 + 300_000 = 21_206_500
 *
 * STEP 6 — Tariff (5% of LIST)
 *   tariff_cents = Math.round(29_500_000 × 0.05) = 1_475_000
 *   equipment_cost_cents = 21_206_500 + 1_475_000 = 22_681_500
 *
 * STEP 7 — Markup override (14%)
 *   markup_cents = Math.round(22_681_500 × 0.14)
 *               = Math.round(3_175_410.0) = 3_175_410
 *   baseline_sales_price_cents = 22_681_500 + 3_175_410 = 25_856_910
 *
 * CUSTOMER TOTALS (no attachments, no programs)
 *   customerSubtotalCents          = 25_856_910
 *   customerRebatesCents           = 0
 *   customerPriceAfterRebatesCents = 25_856_910
 *   taxCents = Math.round(25_856_910 × 0.07)
 *            = Math.round(1_809_983.7) = 1_809_984
 *   docFeeCents = 40_000
 *   customerTotalCents = 25_856_910 + 1_809_984 + 40_000 = 27_706_894
 *
 * MARGIN
 *   dealerCostTotalCents = 22_681_500
 *   dealerRevenueCents   = 25_856_910
 *   grossMarginCents     = 25_856_910 − 22_681_500 = 3_175_410
 *   markupAchievedPct    = 3_175_410 / 22_681_500 = 0.14000  (exactly 14.0%)
 *   commissionCents      = Math.floor(3_175_410 × 0.15)
 *                        = Math.floor(476_311.5) = 476_311
 *   requiresApproval     = true  (TWO reasons below)
 *   approvalReasons[0]   = "Markup 14.0% is below the 15% floor for Bandit."
 *   approvalReasons[1]   = 'You overrode the price: "Demo concession — customer insisted"'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PriceQuoteRequest, QuoteContext } from "../../types";

// ── Stable UUIDs ──────────────────────────────────────────────────────────────

export const BANDIT_BRAND_ID = "00000000-0000-0000-0000-000000000007";
export const BANDIT_2900T_MODEL_ID = "00000000-0000-0000-0000-000000000008";
export const OVERRIDE_REQUESTED_BY = "00000000-0000-0000-0000-000000000099";

// ── Request ───────────────────────────────────────────────────────────────────

export const REQUEST: PriceQuoteRequest = {
  equipmentModelId: BANDIT_2900T_MODEL_ID,
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
    id: BANDIT_2900T_MODEL_ID,
    model_code: "2900T",
    name_display: "Bandit 2900T Whole-Tree Chipper",
    list_price_cents: 29_500_000,
    frame_size: "large",
    workspace_id: "default",
    brand: {
      id: BANDIT_BRAND_ID,
      code: "BANDIT",
      name: "Bandit",
      // ⚠ FIXTURE OVERRIDE: discount_configured=true to exercise pricing logic.
      // In production, Bandit ships with discount_configured=false until Angela sets rates.
      discount_configured: true,
      dealer_discount_pct: 0.30, // fixture override; live Bandit remains unconfigured
      markup_target_pct: 0.15,
      markup_floor_pct: 0.15, // Forestry floor is 15%, not 10%
      tariff_pct: 0.05,
      pdi_default_cents: 50_000,
      good_faith_pct: 0.01,
      attachment_markup_pct: 0.20,
    },
  },
  freightCents: 300_000, // synthetic regression input; no live Bandit FL freight zone yet
  freightZone: "FL_LARGE",
  taxRatePct: 0.07,
  programs: [], // no programs
  catalogAttachments: [],
};

// ── Expected output — pinned from hand-calculation ────────────────────────────

export const EXPECTED = {
  breakdown: {
    listPriceCents: 29_500_000,
    dealerDiscountCents: 8_850_000,
    dealerDiscountPct: 0.30,
    discountedPriceCents: 20_650_000,
    pdiCents: 50_000,
    goodFaithCents: 206_500,
    goodFaithPct: 0.01,
    freightCents: 300_000,
    freightZone: "FL_LARGE",
    tariffCents: 1_475_000,
    tariffPct: 0.05,
    equipmentCostCents: 22_681_500,
    markupPct: 0.14, // from override
    markupCents: 3_175_410,
    baselineSalesPriceCents: 25_856_910,
  },

  customerSubtotalCents: 25_856_910,
  customerRebatesCents: 0,
  customerPriceAfterRebatesCents: 25_856_910,
  customerTradeInAllowanceCents: 0,
  taxRatePct: 0.07,
  taxCents: 1_809_984, // Math.round(25_856_910 × 0.07)
  docFeeCents: 40_000,
  customerTotalCents: 27_706_894,

  dealerCostTotalCents: 22_681_500,
  dealerRevenueCents: 25_856_910,
  grossMarginCents: 3_175_410,
  grossMarginPctApprox: 0.1228, // 3_175_410 / 25_856_910
  markupAchievedPctApprox: 0.1400, // exactly 14.0% — below 15% forestry floor
  commissionCents: 476_311, // Math.floor(3_175_410 × 0.15)

  requiresApproval: true, // two reasons
  approvalReasonsLength: 2, // (1) below floor, (2) override present
  programStackingWarnings: [] as string[],
} as const;
