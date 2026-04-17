/**
 * Steps 11–12: Gross margin, commission, and approval flags
 *
 * Margin formula:
 *   dealerCost   = equipment_cost + attachment_cost + dealer_participation_cost
 *   dealerRevenue = customerPriceAfterRebates (tax + doc fee are pass-through)
 *   grossMargin  = dealerRevenue − dealerCost
 *   grossMarginPct = grossMargin / dealerRevenue
 *   markupAchieved = grossMargin / dealerCost
 *
 * Commission:
 *   Math.floor(grossMargin × 0.15) — always floor, never overpay
 *   Source: 00_MASTER_INDEX.md §"Commission: 15% of gross margin, flat rate"
 *
 * Approval triggers (requiresApproval = true when any of):
 *   1. markupAchieved < brand.markup_floor_pct  (default 10% construction, 15% forestry)
 *   2. markupOverride is present (rep overrode the price — always needs a paper trail)
 *   3. Any attachment markup < 20% (floor per spec)
 *
 * approvalReasons is human-readable for the UI — Rylee's voice, not boilerplate.
 */

import type {
  EquipmentResult,
  AttachmentsResult,
  ProgramsResult,
  MarginResult,
  PriceQuoteRequest,
} from "./types";

interface ComputeMarginInput {
  equipmentResult: EquipmentResult;
  attachmentsResult: AttachmentsResult;
  programsResult: ProgramsResult;
  customerPriceAfterRebates: number;
  markupOverride?: PriceQuoteRequest["markupOverride"];
}

export function computeMargin(input: ComputeMarginInput): MarginResult {
  const {
    equipmentResult,
    attachmentsResult,
    programsResult,
    customerPriceAfterRebates,
    markupOverride,
  } = input;

  // Dealer cost = machine cost + attachment cost + any financing dealer participation
  const dealerCostTotalCents =
    equipmentResult.breakdown.equipmentCostCents +
    attachmentsResult.subtotal.totalCostCents +
    programsResult.dealerParticipationCostCents;

  // Revenue = what the customer actually pays for equipment (tax/doc are pass-through)
  const dealerRevenueCents = customerPriceAfterRebates;

  const grossMarginCents = dealerRevenueCents - dealerCostTotalCents;

  // Guard against division by zero on degenerate inputs
  const grossMarginPct =
    dealerRevenueCents > 0 ? grossMarginCents / dealerRevenueCents : 0;
  const markupAchievedPct =
    dealerCostTotalCents > 0 ? grossMarginCents / dealerCostTotalCents : 0;

  // Commission — always floor (spec: "never overpay")
  const commissionCents = Math.floor(grossMarginCents * 0.15);

  // ── Approval checks ──────────────────────────────────────────────────────
  const approvalReasons: string[] = [];
  const { brand } = equipmentResult;

  // 1. Machine markup below floor
  if (markupAchievedPct < brand.markupFloorPct) {
    approvalReasons.push(
      `Markup ${(markupAchievedPct * 100).toFixed(1)}% is below the ` +
        `${(brand.markupFloorPct * 100).toFixed(0)}% floor for ${brand.name}.`,
    );
  }

  // 2. Rep overrode markup — always flag regardless of resulting markup
  if (markupOverride) {
    approvalReasons.push(
      `You overrode the price: "${markupOverride.reason}"`,
    );
  }

  // 3. Individual attachment markup below 20% floor
  //    Age-based exception (>1yr old stock is exempt) deferred to Slice 03
  //    when we have attachment creation dates.
  for (const att of attachmentsResult.attachments) {
    if (att.markupPct < 0.20) {
      approvalReasons.push(
        `Attachment "${att.description}" markup ` +
          `${(att.markupPct * 100).toFixed(1)}% is below the 20% floor.`,
      );
    }
  }

  return {
    dealerCostTotalCents,
    dealerRevenueCents,
    grossMarginCents,
    grossMarginPct,
    markupAchievedPct,
    commissionCents,
    requiresApproval: approvalReasons.length > 0,
    approvalReasons,
  };
}
