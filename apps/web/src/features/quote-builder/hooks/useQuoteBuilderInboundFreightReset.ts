/**
 * Post–PR 21 orchestrator slimming: clear inbound freight when all units in stock.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, useRef } from "react";

import {
  PRICING_ADDER_FIELDS,
  type PricingAdderField,
} from "../lib/pricing-adder-fields";
import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderInboundFreightResetInput {
  inboundFreightEligible: boolean;
  pricingLines: QuoteLineItemDraft[] | undefined;
  pricingLine: (field: PricingAdderField) => QuoteLineItemDraft | undefined;
  upsertPricingLine: (field: PricingAdderField, amount: number) => void;
}

export function useQuoteBuilderInboundFreightReset({
  inboundFreightEligible,
  pricingLines,
  pricingLine,
  upsertPricingLine,
}: UseQuoteBuilderInboundFreightResetInput): void {
  const pricingLineRef = useRef(pricingLine);
  const upsertPricingLineRef = useRef(upsertPricingLine);
  pricingLineRef.current = pricingLine;
  upsertPricingLineRef.current = upsertPricingLine;

  useEffect(() => {
    if (inboundFreightEligible) return;
    const inboundField = PRICING_ADDER_FIELDS.find((field) => field.id === "inbound_freight");
    if (!inboundField) return;
    const existingInbound = pricingLineRef.current(inboundField);
    if (!existingInbound) return;
    upsertPricingLineRef.current(inboundField, 0);
  }, [inboundFreightEligible, pricingLines]);
}
