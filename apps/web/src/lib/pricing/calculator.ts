/**
 * QEP Pricing Engine — Main entry point
 *
 * calculateQuote() is the single public function that drives the full pipeline.
 * Every step is a pure function call on an intermediate result; the DB fetch
 * happens once at the top (in the Edge Function), then the rest is deterministic
 * arithmetic with no I/O.
 *
 * Pipeline order (matches the formula in the Moonshot spec):
 *   1.  Guard: brand.discount_configured must be true
 *   2.  equipment.ts  → Steps 1–7: dealer discount → PDI → good faith → freight → tariff → markup
 *   3.  attachments.ts → Step 8: each attachment follows the same discount path then markup
 *   4.  stacking.ts  → Step 9a: validate which programs can coexist
 *   5.  programs.ts  → Step 9b: apply CIL / financing / GMU / aged-inventory effects
 *   6.  tax.ts       → Step 10: FL county-level tax on final customer price
 *   7.  margin.ts    → Steps 11–12: gross margin, commission, approval triggers
 *   8.  assemble     → produce the PricedQuote output shape
 *
 * Corrections vs. pre-Slice-01 spec:
 *   - All IDs are string UUIDs (not number).
 *   - Edge Function is `qb-calculate`, not `calculate-quote`.
 *   - Auth uses requireServiceUser() from _shared/service-auth.ts (in edge fn, not here).
 *   - discount_configured guard throws DISCOUNT_NOT_CONFIGURED for unconfigured brands.
 *   - Programs injected via QuoteContext.programs (fixture in Slice 02, DB in Slice 03).
 *
 * Slice 02 constraint: no LLM calls, no persistence, no UI.
 */

import type {
  PriceQuoteRequest,
  PricedQuote,
  EquipmentResult,
  AttachmentsResult,
  StackingResult,
  ProgramsResult,
  TaxResult,
  MarginResult,
  QuoteContext,
} from "./types.ts";
import { computeEquipmentCost } from "./equipment.ts";
import { priceAttachments } from "./attachments.ts";
import { validateStacking } from "./stacking.ts";
import { applyPrograms } from "./programs.ts";
import { lookupTax } from "./tax.ts";
import { computeMargin } from "./margin.ts";
import { PricingError } from "./errors.ts";

export const ENGINE_VERSION = "qep-pricing-engine@1.0.0";

// Re-export QuoteContext so callers only need one import path
export type { QuoteContext };

/**
 * Pure calculator — takes a request + pre-fetched context, returns a PricedQuote.
 *
 * Test fixtures call this directly by injecting a QuoteContext.
 * The Edge Function (qb-calculate) fetches the context from the DB then delegates here.
 * Keeping math separate from DB I/O makes every step testable without mocking.
 */
export function calculateQuote(
  request: PriceQuoteRequest,
  ctx: QuoteContext,
): PricedQuote {
  const { model } = ctx;
  const { brand } = model;

  // Guard: brand discount must be configured before we can price anything.
  // The forestry brands (Barko, Prinoth, etc.) are seeded with
  // discount_configured = false until Angela sets the correct rates.
  if (!brand.discount_configured) {
    throw new PricingError(
      "DISCOUNT_NOT_CONFIGURED",
      `${brand.name} not yet configured for deal engine.`,
      { brandId: brand.id, brandCode: brand.code },
    );
  }

  // GMU requires gmuDetails to be present
  if (request.customerType === "gmu" && !request.gmuDetails) {
    throw new PricingError(
      "GMU_DETAILS_REQUIRED",
      "GMU quotes need agency type and (ideally) a pre-approval number. What kind of government account is this?",
    );
  }

  // Step 2–7: Dealer discount → PDI → good faith → freight → tariff → markup
  const equipmentResult: EquipmentResult = computeEquipmentCost({
    model: {
      id: model.id,
      modelCode: model.model_code,
      nameDisplay: model.name_display,
      listPriceCents: model.list_price_cents,
    },
    brand: {
      id: brand.id,
      code: brand.code,
      name: brand.name,
      dealerDiscountPct: brand.dealer_discount_pct,
      markupTargetPct: brand.markup_target_pct,
      markupFloorPct: brand.markup_floor_pct,
      tariffPct: brand.tariff_pct,
      pdiDefaultCents: brand.pdi_default_cents,
      goodFaithPct: brand.good_faith_pct,
      attachmentMarkupPct: brand.attachment_markup_pct,
      discountConfigured: brand.discount_configured,
    },
    freightCents: ctx.freightCents,
    freightZone: ctx.freightZone,
    customerType: request.customerType,
    markupOverride: request.markupOverride,
  });

  // Step 8: Attachments — each gets the same dealer-discount path then markup
  const attachmentsResult: AttachmentsResult = priceAttachments({
    brand: equipmentResult.brand,
    catalogAttachments: ctx.catalogAttachments,
    requestedAttachments: request.attachments ?? [],
    customAttachments: request.customAttachments ?? [],
  });

  // Step 9a: Validate which programs can legally stack
  const stackingResult: StackingResult = validateStacking({
    financingProgramId: request.financing?.programId,
    cilProgramId: request.cashInLieuProgramId,
    additionalProgramIds: request.additionalProgramIds ?? [],
    customerType: request.customerType,
    availablePrograms: ctx.programs,
  });

  // Step 9b: Apply program effects (rebates, financing scenarios, GMU cap)
  const programsResult: ProgramsResult = applyPrograms({
    request,
    equipmentResult,
    attachmentsResult,
    validatedProgramIds: stackingResult.validPrograms,
    availablePrograms: ctx.programs,
  });

  // Step 10: Tax — FL county-level, applied after all programs on customer price
  const customerPriceAfterRebates =
    equipmentResult.baselineSalesPriceCents +
    attachmentsResult.subtotal.totalSalesPriceCents -
    programsResult.customerRebatesCents;

  const tax: TaxResult = request.taxExempt
    ? { ratePct: 0, cents: 0 }
    : lookupTax(ctx.taxRatePct, customerPriceAfterRebates);

  const docFeeCents = request.docFeeCents ?? 40_000;

  // Steps 11–12: Margin → commission → approval triggers
  const marginResult: MarginResult = computeMargin({
    equipmentResult,
    attachmentsResult,
    programsResult,
    customerPriceAfterRebates,
    markupOverride: request.markupOverride,
  });

  return assemblePricedQuote({
    request,
    equipmentResult,
    attachmentsResult,
    stackingResult,
    programsResult,
    tax,
    docFeeCents,
    marginResult,
    customerPriceAfterRebates,
  });
}

// ── Assembly ──────────────────────────────────────────────────────────────────

function assemblePricedQuote(p: {
  request: PriceQuoteRequest;
  equipmentResult: EquipmentResult;
  attachmentsResult: AttachmentsResult;
  stackingResult: StackingResult;
  programsResult: ProgramsResult;
  tax: TaxResult;
  docFeeCents: number;
  marginResult: MarginResult;
  customerPriceAfterRebates: number;
}): PricedQuote {
  const {
    request,
    equipmentResult,
    attachmentsResult,
    stackingResult,
    programsResult,
    tax,
    docFeeCents,
    marginResult,
    customerPriceAfterRebates,
  } = p;

  const customerSubtotalCents =
    equipmentResult.baselineSalesPriceCents +
    attachmentsResult.subtotal.totalSalesPriceCents;

  const tradeInAllowance = request.tradeIn?.allowanceCents ?? 0;
  const customerNetOfTrade = customerPriceAfterRebates - tradeInAllowance;

  const tradeInResult = request.tradeIn
    ? {
        allowanceCents: request.tradeIn.allowanceCents,
        bookValueCents: request.tradeIn.bookValueCents ?? null,
        overUnderCents:
          request.tradeIn.bookValueCents != null
            ? request.tradeIn.allowanceCents - request.tradeIn.bookValueCents
            : null,
      }
    : undefined;

  return {
    request,
    brand: equipmentResult.brand,
    model: equipmentResult.model,
    breakdown: equipmentResult.breakdown,
    attachments: attachmentsResult.attachments,
    attachmentsSubtotal: attachmentsResult.subtotal,
    tradeIn: tradeInResult,
    programs: programsResult.programs,
    programStackingWarnings: [
      ...stackingResult.warnings,
      ...programsResult.warnings,
    ],
    programEligibilityNotes: [
      ...stackingResult.eligibilityNotes,
      ...programsResult.eligibilityNotes,
    ],
    financingScenario: programsResult.financingScenario,
    taxRatePct: tax.ratePct,
    taxCents: tax.cents,
    docFeeCents,
    customerSubtotalCents,
    customerRebatesCents: programsResult.customerRebatesCents,
    customerPriceAfterRebatesCents: customerPriceAfterRebates,
    customerTradeInAllowanceCents: tradeInAllowance,
    customerNetOfTradeCents: customerNetOfTrade,
    customerTaxCents: tax.cents,
    customerDocFeeCents: docFeeCents,
    customerTotalCents: customerNetOfTrade + tax.cents + docFeeCents,
    dealerCostTotalCents: marginResult.dealerCostTotalCents,
    dealerRevenueCents: marginResult.dealerRevenueCents,
    grossMarginCents: marginResult.grossMarginCents,
    grossMarginPct: marginResult.grossMarginPct,
    markupAchievedPct: marginResult.markupAchievedPct,
    commissionCents: marginResult.commissionCents,
    requiresApproval: marginResult.requiresApproval,
    approvalReasons: marginResult.approvalReasons,
    computedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
  };
}
