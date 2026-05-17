import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

import type { PricingAdderField } from "./pricing-adder-fields";

/** Stable key for misc charge/credit rows (id, pricing_field_key, or title fallback). */
export function miscPricingLineKey(line: QuoteLineItemDraft): string {
  if (line.id) return line.id;
  const fieldKey = line.metadata?.pricing_field_key;
  if (typeof fieldKey === "string" && fieldKey.length > 0) return fieldKey;
  return `${line.metadata?.misc_line_kind ?? "misc"}:${line.title}`;
}

export interface MiscPricingLineFormState {
  chargeTitle: string;
  chargeAmount: number;
  creditTitle: string;
  creditAmount: number;
}

/** Resolves title/amount from misc charge/credit inputs; null when amount is not positive. */
export function resolveMiscPricingLineInput(
  kind: "charge" | "credit",
  form: MiscPricingLineFormState,
): { title: string; amount: number } | null {
  const rawTitle = kind === "charge" ? form.chargeTitle : form.creditTitle;
  const rawAmount = kind === "charge" ? form.chargeAmount : form.creditAmount;
  const title = rawTitle.trim() || (kind === "charge" ? "Misc charge" : "Misc credit");
  const amount = Number.isFinite(rawAmount) ? Math.max(0, rawAmount) : 0;
  if (amount <= 0) return null;
  return { title, amount };
}

export function buildMiscPricingAdderField(
  kind: "charge" | "credit",
  title: string,
  idSuffix: number = Date.now(),
): PricingAdderField {
  const id = `misc_${kind}_${idSuffix}`;
  return {
    id,
    kind: kind === "credit" ? "discount" : "custom",
    title,
    helper: kind === "credit" ? "Customer-facing miscellaneous credit" : "Customer-facing miscellaneous charge",
    step: 25,
    costVisibility: "customer",
    metadata: {
      pricing_field_key: id,
      misc_line_kind: kind,
    },
  };
}
