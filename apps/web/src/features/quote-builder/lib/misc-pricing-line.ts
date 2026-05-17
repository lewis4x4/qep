import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

/** Stable key for misc charge/credit rows (id, pricing_field_key, or title fallback). */
export function miscPricingLineKey(line: QuoteLineItemDraft): string {
  if (line.id) return line.id;
  const fieldKey = line.metadata?.pricing_field_key;
  if (typeof fieldKey === "string" && fieldKey.length > 0) return fieldKey;
  return `${line.metadata?.misc_line_kind ?? "misc"}:${line.title}`;
}
