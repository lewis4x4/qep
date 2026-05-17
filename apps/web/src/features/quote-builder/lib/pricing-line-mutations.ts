import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

import {
  type CostVisibility,
  type PricingAdderField,
  type PricingLineKind,
} from "./pricing-adder-fields";
import { quoteLineCostVisibility } from "./quote-workspace";

export function pricingFieldKeyForLine(item: QuoteLineItemDraft): string {
  const explicitKey = typeof item.metadata?.pricing_field_key === "string"
    ? item.metadata.pricing_field_key
    : null;
  if (explicitKey) return explicitKey;
  if (item.kind === "freight") {
    const direction = typeof item.metadata?.freight_direction === "string"
      ? item.metadata.freight_direction
      : "outbound";
    return direction === "inbound" ? "inbound_freight" : "outbound_delivery";
  }
  return item.kind;
}

export function asPricingAdderField(
  fieldOrKind: PricingAdderField | PricingLineKind,
  title?: string,
  costVisibility?: CostVisibility,
): PricingAdderField {
  if (typeof fieldOrKind === "object") return fieldOrKind;
  return {
    id: fieldOrKind,
    kind: fieldOrKind,
    title: title ?? fieldOrKind,
    helper: "",
    step: 1,
    costVisibility: costVisibility ?? quoteLineCostVisibility({ kind: fieldOrKind }),
  };
}

export function findPricingLine(
  pricingLines: QuoteLineItemDraft[] | undefined,
  fieldOrKind: PricingAdderField | PricingLineKind,
): QuoteLineItemDraft | undefined {
  const field = asPricingAdderField(fieldOrKind);
  return pricingLines?.find((item) =>
    item.kind === field.kind && pricingFieldKeyForLine(item) === field.id);
}

export function mergePricingLines(
  existing: QuoteLineItemDraft[],
  fieldOrKind: PricingAdderField | PricingLineKind,
  amount: number,
  patch: Partial<QuoteLineItemDraft> = {},
  legacyTitle?: string,
  legacyCostVisibility?: CostVisibility,
): QuoteLineItemDraft[] {
  const field = asPricingAdderField(fieldOrKind, legacyTitle, legacyCostVisibility);
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const existingMatch = existing.find((item) =>
    item.kind === field.kind && pricingFieldKeyForLine(item) === field.id);
  const mergedMetadata = {
    ...(field.metadata ?? {}),
    ...(existingMatch?.metadata ?? {}),
    ...((patch.metadata && typeof patch.metadata === "object" && !Array.isArray(patch.metadata))
      ? patch.metadata
      : {}),
  };
  const nextLine: QuoteLineItemDraft = {
    kind: field.kind,
    id: existingMatch?.id ?? `${field.id}-${Date.now()}`,
    sourceCatalog: "manual",
    sourceId: null,
    dealerCost: null,
    costVisibility: field.costVisibility,
    title: field.title,
    quantity: 1,
    unitPrice: safeAmount,
    metadata: mergedMetadata,
    ...patch,
  };
  if (safeAmount <= 0) {
    return existing.filter((item) => !(item.kind === field.kind && pricingFieldKeyForLine(item) === field.id));
  }
  if (existingMatch) {
    return existing.map((item) =>
      item.kind === field.kind && pricingFieldKeyForLine(item) === field.id
        ? { ...item, ...nextLine }
        : item);
  }
  return [...existing, nextLine];
}
