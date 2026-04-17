/**
 * Step 1–7: Equipment cost chain
 *
 *   list_price
 *   − dealer_discount        (list × brand.dealer_discount_pct)
 *   + PDI                    (brand.pdi_default_cents)
 *   + good faith             (discounted × brand.good_faith_pct)
 *   + freight                (from qb_freight_zones)
 *   + tariff                 (list × brand.tariff_pct)
 *   = equipment_cost
 *
 *   equipment_cost × (1 + markup_pct) = baseline_sales_price
 *
 * No floats. Every division boundary uses Math.round().
 */

import type { EquipmentResult, PricedBrand, PricedModel } from "./types.ts";
import { PricingError } from "./errors.ts";

interface ComputeEquipmentCostInput {
  model: PricedModel;
  brand: PricedBrand;
  freightCents: number;
  freightZone: string;
  customerType: "standard" | "gmu";
  markupOverride?: {
    markupPct: number;
    reason: string;
    requestedBy: string;
  };
}

export function computeEquipmentCost(
  input: ComputeEquipmentCostInput,
): EquipmentResult {
  const { model, brand, freightCents, freightZone, customerType, markupOverride } = input;

  if (markupOverride && (markupOverride.markupPct < 0 || markupOverride.markupPct > 1)) {
    throw new PricingError(
      "MARKUP_INVALID",
      `Markup override ${(markupOverride.markupPct * 100).toFixed(1)}% is out of range. Use a value between 0% and 100%.`,
      { markupPct: markupOverride.markupPct },
    );
  }

  const listPriceCents = model.listPriceCents;

  // Step 2: Dealer discount
  const dealerDiscountCents = Math.round(listPriceCents * brand.dealerDiscountPct);
  const discountedPriceCents = listPriceCents - dealerDiscountCents;

  // Step 3: PDI
  const pdiCents = brand.pdiDefaultCents;
  const discountedPlusPdi = discountedPriceCents + pdiCents;

  // Step 4: Good faith (1% of invoice price = discounted price, before PDI)
  // Rylee: "1% of original cost after our discount"
  const goodFaithCents = Math.round(discountedPriceCents * brand.goodFaithPct);
  const subtotalWithGoodFaith = discountedPlusPdi + goodFaithCents;

  // Step 5: Freight
  const subtotalWithFreight = subtotalWithGoodFaith + freightCents;

  // Step 6: Tariff (5% of LIST price — Rylee: "tariff based on list prices")
  const tariffCents = Math.round(listPriceCents * brand.tariffPct);
  const equipmentCostCents = subtotalWithFreight + tariffCents;

  // Step 7: Markup
  // GMU path: customer price is fixed at 8% off list (a government pricing tier).
  // The full cost chain (Steps 2–6) runs normally. We then derive the implied
  // markup from the difference between the GMU price and equipment cost.
  // Standard path: apply target markup (or override).
  let markupPct: number;
  let markupCents: number;
  let baselineSalesPriceCents: number;

  if (customerType === "gmu") {
    // GMU price = list × 0.92 (8% off list, per government pricing tier)
    const gmuPriceCents = Math.round(listPriceCents * 0.92);
    markupCents = gmuPriceCents - equipmentCostCents;
    markupPct = equipmentCostCents > 0 ? markupCents / equipmentCostCents : 0;
    baselineSalesPriceCents = gmuPriceCents;
  } else {
    markupPct = markupOverride?.markupPct ?? brand.markupTargetPct;
    markupCents = Math.round(equipmentCostCents * markupPct);
    baselineSalesPriceCents = equipmentCostCents + markupCents;
  }

  return {
    breakdown: {
      listPriceCents,
      dealerDiscountCents,
      dealerDiscountPct: brand.dealerDiscountPct,
      discountedPriceCents,
      pdiCents,
      goodFaithCents,
      goodFaithPct: brand.goodFaithPct,
      freightCents,
      freightZone,
      tariffCents,
      tariffPct: brand.tariffPct,
      equipmentCostCents,
      markupPct,
      markupCents,
      baselineSalesPriceCents,
    },
    brand,
    model,
    baselineSalesPriceCents,
  };
}
