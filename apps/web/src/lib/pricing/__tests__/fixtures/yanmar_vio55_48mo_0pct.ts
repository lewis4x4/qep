/**
 * Fixture: Yanmar ViO 55 Cab w/ Angle Blade — 48-month 0% financing
 *
 * Rylee's stated dream quote: "Yanmar ViO 55 closed cab / angle blade,
 * 24" trenching bucket, 30" smooth-edge ditching bucket, hydraulic thumb,
 * 0% financing for 48 months."
 * Source: SLICE_02_PRICING_ENGINE_CORE.md §"Fixture 1: yanmar_vio55_48mo_0pct"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOURCE NUMBERS AND DECISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Brand config (all from SLICE_01_SCHEMA_FOUNDATION.md §"Seed data shipped"):
 *   dealer_discount_pct  = 0.30  (30%)
 *   markup_target_pct    = 0.12  (12%)
 *   markup_floor_pct     = 0.10  (10%)
 *   tariff_pct           = 0.05  (5%)
 *   pdi_default_cents    = 50_000  ($500)
 *   good_faith_pct       = 0.01  (1%)
 *   attachment_markup_pct = 0.20  (20%)
 *
 * Freight: FL large frame = $1,942 = 194_200¢
 *   Source: SLICE_01_SCHEMA_FOUNDATION.md §"Seed data shipped":
 *   "1 freight zone in qb_freight_zones: ASV for FL, $1,942 large / $777 small"
 *   Yanmar and ASV share the same freight zone (both confirmed for FL).
 *
 * Machine list price: $95,000 = 9_500_000¢  ⚠ PLACEHOLDER
 *   The exact Yanmar ViO 55 Cab list price is NOT documented in any plan file
 *   found under qep/. The spec directed "find them under qep/ — likely in the
 *   plans or a briefing doc" but no such briefing with explicit list prices exists.
 *   $95,000 is a reasonable approximation for the ViO55-6 closed cab in the
 *   2025-2026 model year. Update this fixture (and the expected values below)
 *   once Slice 04 seeds real prices from the uploaded Yanmar price sheet.
 *
 * Attachment list prices: ⚠ PLACEHOLDER — same caveat as machine.
 *   24" trenching bucket:          $2,200 = 220_000¢
 *   30" smooth-edge ditching bucket: $2,750 = 275_000¢
 *   Hydraulic thumb:               $3,250 = 325_000¢
 *
 * Financing: 0% APR, 48 months, 0% dealer participation
 *   Source: SLICE_02_PRICING_ENGINE_CORE.md §"Fixture 1" — "0% financing for 48
 *   months with 0% dealer participation (Q1 2026 ASV program)"
 *   Payment formula at 0%: Math.round(financed / term)
 *   Source: SLICE_02_PRICING_ENGINE_CORE.md §"Payment Factor Calculation":
 *   "For 0%: payment = financed / term_months"
 *
 * Tax: 7% FL generic stub
 *   Source: DISCOVERY_BRIEF_2026_04.md §"Edge Functions" — existing
 *   "tax-calculator" function; Slice 02 hardcodes 7% FL state + county delta.
 *
 * Doc fee: $400 = 40_000¢
 *   Source: SLICE_02_PRICING_ENGINE_CORE.md §Input — "docFeeCents default 40000
 *   ($400 per Yanmar pattern)"
 *
 * Commission: 15% of gross margin, Math.floor
 *   Source: 00_MASTER_INDEX.md §"The QEP Pricing Model" — "Commission: 15% of
 *   gross margin, flat rate"
 *   Source: SLICE_02_PRICING_ENGINE_CORE.md §"Commission" — "Math.floor, always"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAND CALCULATION (all values in cents)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * STEP 1 — List price
 *   list_price_cents = 9_500_000
 *
 * STEP 2 — Dealer discount (30%)
 *   dealer_discount_cents = Math.round(9_500_000 × 0.30) = 2_850_000
 *   discounted_price_cents = 9_500_000 − 2_850_000 = 6_650_000
 *
 * STEP 3 — PDI ($500)
 *   pdi_cents = 50_000
 *   discounted_plus_pdi = 6_650_000 + 50_000 = 6_700_000
 *
 * STEP 4 — Good faith (1% of discounted price, before PDI)
 *   good_faith_cents = Math.round(6_650_000 × 0.01) = 66_500
 *   subtotal_with_good_faith = 6_700_000 + 66_500 = 6_766_500
 *   Note: Rylee: "1% of original cost after our discount" — the base is the
 *   discounted invoice cost, not the price after PDI is added.
 *
 * STEP 5 — Freight (FL large frame)
 *   freight_cents = 194_200
 *   subtotal_with_freight = 6_766_500 + 194_200 = 6_960_700
 *
 * STEP 6 — Tariff (5% of LIST price — not cost)
 *   tariff_cents = Math.round(9_500_000 × 0.05) = 475_000
 *   equipment_cost_cents = 6_960_700 + 475_000 = 7_435_700
 *   Note: Rylee confirmed "5% tariff applicable that is based on list prices"
 *   Source: SLICE_02_PRICING_ENGINE_CORE.md §"The Pricing Formula"
 *
 * STEP 7 — Markup (12% target)
 *   markup_cents = Math.round(7_435_700 × 0.12) = Math.round(892_284.0) = 892_284
 *   baseline_sales_price_cents = 7_435_700 + 892_284 = 8_327_984
 *
 * ATTACHMENTS — dealer_discount_pct=0.30, attachment_markup_pct=0.20
 *
 *   24" trenching bucket (list 220_000):
 *     discount = Math.round(220_000 × 0.30) = 66_000
 *     cost     = 220_000 − 66_000            = 154_000
 *     markup   = Math.round(154_000 × 0.20)  = 30_800
 *     sales    = 154_000 + 30_800             = 184_800
 *
 *   30" ditching bucket (list 275_000):
 *     discount = Math.round(275_000 × 0.30) = 82_500
 *     cost     = 275_000 − 82_500            = 192_500
 *     markup   = Math.round(192_500 × 0.20)  = 38_500
 *     sales    = 192_500 + 38_500             = 231_000
 *
 *   Hydraulic thumb (list 325_000):
 *     discount = Math.round(325_000 × 0.30) = 97_500
 *     cost     = 325_000 − 97_500            = 227_500
 *     markup   = Math.round(227_500 × 0.20)  = 45_500
 *     sales    = 227_500 + 45_500             = 273_000
 *
 *   Attachment subtotals:
 *     totalListCents        = 220_000 + 275_000 + 325_000 = 820_000
 *     totalCostCents        = 154_000 + 192_500 + 227_500 = 574_000
 *     totalSalesPriceCents  = 184_800 + 231_000 + 273_000 = 688_800
 *
 * FINANCING — 0% APR, 48 months, 0% dealer participation
 *   totalFinancedCents = 8_327_984 + 688_800 = 9_016_784
 *   Cap check: machine list + attachment list = 9_500_000 + 820_000 = 10_320_000
 *              9_016_784 < 10_320_000 ✓
 *   paymentCents = Math.round(9_016_784 / 48) = Math.round(187_849.667) = 187_850
 *   dealerParticipationCostCents = 0
 *
 * CUSTOMER TOTALS
 *   customerSubtotalCents          = 8_327_984 + 688_800 = 9_016_784
 *   customerRebatesCents           = 0  (no CIL)
 *   customerPriceAfterRebatesCents = 9_016_784
 *   customerTradeInAllowanceCents  = 0  (no trade-in)
 *   customerNetOfTradeCents        = 9_016_784
 *   taxCents = Math.round(9_016_784 × 0.07)
 *            = Math.round(631_174.88) = 631_175
 *   docFeeCents = 40_000
 *   customerTotalCents = 9_016_784 + 631_175 + 40_000 = 9_687_959
 *
 * MARGIN
 *   dealerCostTotalCents = 7_435_700 + 574_000 + 0 = 8_009_700
 *   dealerRevenueCents   = 9_016_784
 *   grossMarginCents     = 9_016_784 − 8_009_700 = 1_007_084
 *   grossMarginPct       = 1_007_084 / 9_016_784 ≈ 0.1117  (11.17%)
 *   markupAchievedPct    = 1_007_084 / 8_009_700 ≈ 0.1257  (12.57%)
 *   commissionCents      = Math.floor(1_007_084 × 0.15)
 *                        = Math.floor(151_062.6) = 151_062
 *   requiresApproval     = false  (12.57% > 10% floor; all attachment markups = 20%)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PriceQuoteRequest, PricedQuote, QuoteContext } from "../../types";

// ── Stable UUIDs for the fixture (not real DB rows — seeded by tests) ─────────

export const YANMAR_BRAND_ID      = "00000000-0000-0000-0000-000000000001";
export const YANMAR_VIO55_MODEL_ID = "00000000-0000-0000-0000-000000000002";
export const ATT_TRENCHING_24_ID  = "00000000-0000-0000-0000-000000000010";
export const ATT_DITCHING_30_ID   = "00000000-0000-0000-0000-000000000011";
export const ATT_THUMB_ID         = "00000000-0000-0000-0000-000000000012";
export const PROGRAM_48MO_0PCT_ID = "00000000-0000-0000-0000-000000000020";

// ── Request ───────────────────────────────────────────────────────────────────

export const REQUEST: PriceQuoteRequest = {
  equipmentModelId: YANMAR_VIO55_MODEL_ID,
  customerType: "standard",
  deliveryState: "FL",
  attachments: [
    { attachmentId: ATT_TRENCHING_24_ID, quantity: 1 },
    { attachmentId: ATT_DITCHING_30_ID,  quantity: 1 },
    { attachmentId: ATT_THUMB_ID,        quantity: 1 },
  ],
  financing: {
    programId: PROGRAM_48MO_0PCT_ID,
    termMonths: 48,
  },
  docFeeCents: 40_000,
};

// ── Context (simulates what the DB would return) ───────────────────────────────

export const CTX: QuoteContext = {
  model: {
    id: YANMAR_VIO55_MODEL_ID,
    model_code: "VIO55-6-CAB-AB",
    name_display: "Yanmar ViO 55 — Cab w/ A/C, Angle Blade",
    list_price_cents: 9_500_000, // ⚠ PLACEHOLDER — update from Slice 04 price sheet
    frame_size: "large",
    workspace_id: "default",
    brand: {
      id: YANMAR_BRAND_ID,
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
  // TODO(slice-04): confirm Yanmar FL freight with Rylee — may differ from ASV $1,942
  freightCents: 194_200,  // FL large frame — SLICE_01 seed (ASV zone, shared with Yanmar for now)
  freightZone: "FL_LARGE",
  taxRatePct: 0.07,       // 7% FL generic stub; Slice 03+ uses tax-calculator fn
  programs: [
    {
      id: PROGRAM_48MO_0PCT_ID,
      programType: "low_rate_financing",
      name: "Yanmar Finance Q1 2026 — 0% / 48mo",
      brandId: YANMAR_BRAND_ID,
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
  catalogAttachments: [
    {
      id: ATT_TRENCHING_24_ID,
      name: '24" Trenching Bucket',
      list_price_cents: 220_000,  // ⚠ PLACEHOLDER
      oem_branded: true,
      compatible_model_ids: null,
      universal: false,
    },
    {
      id: ATT_DITCHING_30_ID,
      name: '30" Smooth-Edge Ditching Bucket',
      list_price_cents: 275_000,  // ⚠ PLACEHOLDER
      oem_branded: true,
      compatible_model_ids: null,
      universal: false,
    },
    {
      id: ATT_THUMB_ID,
      name: "Hydraulic Thumb",
      list_price_cents: 325_000,  // ⚠ PLACEHOLDER
      oem_branded: true,
      compatible_model_ids: null,
      universal: false,
    },
  ],
};

// ── Expected output — pinned from the hand-calculation above ──────────────────
// These are the exact values the engine MUST produce for this input.
// If any value changes, a human must have consciously changed an input
// or a business rule — not a side effect of refactoring.

export const EXPECTED = {
  // ── Equipment breakdown ──────────────────────────────────────────────────
  breakdown: {
    listPriceCents:          9_500_000,
    dealerDiscountCents:     2_850_000,
    dealerDiscountPct:       0.30,
    discountedPriceCents:    6_650_000,
    pdiCents:                  50_000,
    goodFaithCents:            66_500,
    goodFaithPct:              0.01,
    freightCents:             194_200,
    freightZone:           "FL_LARGE",
    tariffCents:              475_000,
    tariffPct:                 0.05,
    equipmentCostCents:     7_435_700,
    markupPct:                 0.12,
    markupCents:              892_284,
    baselineSalesPriceCents: 8_327_984,
  },

  // ── Attachments ──────────────────────────────────────────────────────────
  attachments: [
    {
      attachmentId: ATT_TRENCHING_24_ID,
      listPriceCents:   220_000,
      discountCents:     66_000,
      costCents:        154_000,
      markupPct:           0.20,
      markupCents:       30_800,
      salesPriceCents:  184_800,
      oemBranded: true,
    },
    {
      attachmentId: ATT_DITCHING_30_ID,
      listPriceCents:   275_000,
      discountCents:     82_500,
      costCents:        192_500,
      markupPct:           0.20,
      markupCents:       38_500,
      salesPriceCents:  231_000,
      oemBranded: true,
    },
    {
      attachmentId: ATT_THUMB_ID,
      listPriceCents:   325_000,
      discountCents:     97_500,
      costCents:        227_500,
      markupPct:           0.20,
      markupCents:       45_500,
      salesPriceCents:  273_000,
      oemBranded: true,
    },
  ],
  attachmentsSubtotal: {
    totalListCents:        820_000,
    totalCostCents:        574_000,
    totalSalesPriceCents:  688_800,
  },

  // ── Financing scenario ───────────────────────────────────────────────────
  financingScenario: {
    programId:                   PROGRAM_48MO_0PCT_ID,
    lenderName:                  "Yanmar Financial Services",
    termMonths:                  48,
    ratePct:                     0.0,
    paymentCents:                187_850,  // Math.round(9_016_784 / 48)
    totalFinancedCents:          9_016_784,
    dealerParticipationPct:      0.0,
    dealerParticipationCostCents: 0,
  },

  // ── Customer totals ──────────────────────────────────────────────────────
  customerSubtotalCents:            9_016_784,
  customerRebatesCents:             0,
  customerPriceAfterRebatesCents:   9_016_784,
  customerTradeInAllowanceCents:    0,
  customerNetOfTradeCents:          9_016_784,
  taxRatePct:                       0.07,
  taxCents:                         631_175,  // Math.round(9_016_784 × 0.07)
  docFeeCents:                      40_000,
  customerTotalCents:               9_687_959, // 9_016_784 + 631_175 + 40_000

  // ── Margin ───────────────────────────────────────────────────────────────
  dealerCostTotalCents:   8_009_700,  // 7_435_700 + 574_000 + 0
  dealerRevenueCents:     9_016_784,
  grossMarginCents:       1_007_084,  // 9_016_784 − 8_009_700
  // grossMarginPct and markupAchievedPct are floating-point — test with toBeCloseTo
  grossMarginPctApprox:      0.1117,  // 1_007_084 / 9_016_784
  markupAchievedPctApprox:   0.1257,  // 1_007_084 / 8_009_700
  commissionCents:           151_062, // Math.floor(1_007_084 × 0.15)

  // ── Approval ─────────────────────────────────────────────────────────────
  requiresApproval: false,
  approvalReasons: [] as string[],

  // ── Stacking ─────────────────────────────────────────────────────────────
  programStackingWarnings: [] as string[],
} as const;
