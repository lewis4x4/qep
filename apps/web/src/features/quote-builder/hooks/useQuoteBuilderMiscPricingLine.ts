/**
 * Post–PR 21 orchestrator slimming: misc charge/credit adder from Pricing step.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";
import {
  buildMiscPricingAdderField,
  resolveMiscPricingLineInput,
  type MiscPricingLineFormState,
} from "../lib/misc-pricing-line";
import type { PricingAdderField } from "../lib/pricing-adder-fields";

export interface UseQuoteBuilderMiscPricingLineInput extends MiscPricingLineFormState {
  setMiscChargeTitle: Dispatch<SetStateAction<string>>;
  setMiscChargeAmount: Dispatch<SetStateAction<number>>;
  setMiscCreditTitle: Dispatch<SetStateAction<string>>;
  setMiscCreditAmount: Dispatch<SetStateAction<number>>;
  upsertPricingLine: (
    field: PricingAdderField,
    amount: number,
    patch?: Partial<QuoteLineItemDraft>,
  ) => void;
}

export function useQuoteBuilderMiscPricingLine({
  chargeTitle,
  chargeAmount,
  creditTitle,
  creditAmount,
  setMiscChargeTitle,
  setMiscChargeAmount,
  setMiscCreditTitle,
  setMiscCreditAmount,
  upsertPricingLine,
}: UseQuoteBuilderMiscPricingLineInput): (kind: "charge" | "credit") => void {
  return useCallback((kind) => {
    const resolved = resolveMiscPricingLineInput(kind, {
      chargeTitle,
      chargeAmount,
      creditTitle,
      creditAmount,
    });
    if (!resolved) return;

    const field = buildMiscPricingAdderField(kind, resolved.title);
    upsertPricingLine(field, resolved.amount, {
      title: resolved.title,
      reasonCode: kind === "credit" ? "other" : null,
      metadata: field.metadata,
    });

    if (kind === "charge") {
      setMiscChargeTitle("");
      setMiscChargeAmount(0);
    } else {
      setMiscCreditTitle("");
      setMiscCreditAmount(0);
    }
  }, [
    chargeAmount,
    chargeTitle,
    creditAmount,
    creditTitle,
    setMiscChargeAmount,
    setMiscChargeTitle,
    setMiscCreditAmount,
    setMiscCreditTitle,
    upsertPricingLine,
  ]);
}
