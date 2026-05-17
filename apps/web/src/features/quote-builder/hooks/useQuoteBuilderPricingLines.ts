/**
 * Post–PR 21 orchestrator slimming: pricing adder line lookup + upsert.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";

import type {
  QuoteLineItemDraft,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import {
  findPricingLine,
  mergePricingLines,
} from "../lib/pricing-line-mutations";
import type {
  CostVisibility,
  PricingAdderField,
  PricingLineKind,
} from "../lib/pricing-adder-fields";

export interface UseQuoteBuilderPricingLinesInput {
  pricingLines: QuoteLineItemDraft[] | undefined;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
}

export function useQuoteBuilderPricingLines({
  pricingLines,
  setDraft,
}: UseQuoteBuilderPricingLinesInput): {
  pricingLine: (fieldOrKind: PricingAdderField | PricingLineKind) => QuoteLineItemDraft | undefined;
  upsertPricingLine: (
    fieldOrKind: PricingAdderField | PricingLineKind,
    amount: number,
    patch?: Partial<QuoteLineItemDraft>,
    legacyTitle?: string,
    legacyCostVisibility?: CostVisibility,
  ) => void;
} {
  const pricingLine = useCallback(
    (fieldOrKind: PricingAdderField | PricingLineKind) =>
      findPricingLine(pricingLines, fieldOrKind),
    [pricingLines],
  );

  const upsertPricingLine = useCallback(
    (
      fieldOrKind: PricingAdderField | PricingLineKind,
      amount: number,
      patch: Partial<QuoteLineItemDraft> = {},
      legacyTitle?: string,
      legacyCostVisibility?: CostVisibility,
    ) => {
      setDraft((current) => ({
        ...current,
        pricingLines: mergePricingLines(
          current.pricingLines ?? [],
          fieldOrKind,
          amount,
          patch,
          legacyTitle,
          legacyCostVisibility,
        ),
      }));
    },
    [setDraft],
  );

  return { pricingLine, upsertPricingLine };
}
