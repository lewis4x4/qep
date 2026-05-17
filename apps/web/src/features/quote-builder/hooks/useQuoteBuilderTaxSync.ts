/**
 * Post–PR 21 orchestrator slimming: sync draft.taxTotal from preview or override.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderTaxSyncInput {
  branchSlug: string | undefined;
  deliveryState: string | undefined | null;
  taxOverrideAmount: number | null | undefined;
  manualTaxOverrideReady: boolean;
  previewTotalTax: number | undefined;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
}

export function useQuoteBuilderTaxSync({
  branchSlug,
  deliveryState,
  taxOverrideAmount,
  manualTaxOverrideReady,
  previewTotalTax,
  setDraft,
}: UseQuoteBuilderTaxSyncInput): void {
  useEffect(() => {
    const hasTaxJurisdiction = Boolean(branchSlug || deliveryState);
    if (!hasTaxJurisdiction) {
      setDraft((current) => current.taxTotal === 0 ? current : { ...current, taxTotal: 0 });
      return;
    }
    if (manualTaxOverrideReady && typeof taxOverrideAmount === "number") {
      const nextTaxTotal = Math.round(taxOverrideAmount * 100) / 100;
      setDraft((current) => current.taxTotal === nextTaxTotal
        ? current
        : { ...current, taxTotal: nextTaxTotal });
      return;
    }
    if (typeof previewTotalTax !== "number") return;
    const nextTaxTotal = Math.round(previewTotalTax * 100) / 100;
    setDraft((current) => current.taxTotal === nextTaxTotal
      ? current
      : { ...current, taxTotal: nextTaxTotal });
  }, [
    branchSlug,
    deliveryState,
    manualTaxOverrideReady,
    previewTotalTax,
    setDraft,
    taxOverrideAmount,
  ]);
}
