/**
 * Post–PR 21 orchestrator slimming: saved-quote fetch + draft hydration.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Dispatch, SetStateAction } from "react";

import { getSavedQuotePackage } from "../lib/quote-api";
import { hydrateDraftFromSavedQuote } from "../lib/saved-quote-draft";
import { readPersistedStep } from "../wizard/wizard-storage";
import { stepForWizardIndex, type Step } from "../wizard/wizard-types";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseExistingQuoteLoadInput {
  packageId: string;
  dealId: string;
  companyId: string;
  persistedQuotePackageIdRef?: MutableRefObject<string | null>;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  setStep: (step: Step) => void;
}

export interface UseExistingQuoteLoadResult {
  existingQuoteQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getSavedQuotePackage>>>>;
  existingQuote: Record<string, unknown> | null;
}

/** Exported for tests — id used to keep saves on the loaded package row. */
export function loadedQuotePackageId(quote: Record<string, unknown>): string | null {
  return typeof quote.id === "string" && quote.id.length > 0 ? quote.id : null;
}

export function useExistingQuoteLoad({
  packageId,
  dealId,
  companyId,
  persistedQuotePackageIdRef,
  setDraft,
  setStep,
}: UseExistingQuoteLoadInput): UseExistingQuoteLoadResult {
  const existingQuoteHydrationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!packageId || !persistedQuotePackageIdRef) return;
    persistedQuotePackageIdRef.current = packageId;
  }, [packageId, persistedQuotePackageIdRef]);

  const existingQuoteQuery = useQuery({
    queryKey: ["quote-builder", "saved-quote", packageId, dealId],
    queryFn: () => getSavedQuotePackage({
      packageId: packageId || undefined,
      dealId: dealId || undefined,
    }),
    enabled: Boolean(packageId || dealId),
    staleTime: 10_000,
  });

  const existingQuote = useMemo(() => {
    const quote = existingQuoteQuery.data?.quote;
    if (quote && typeof quote === "object" && !Array.isArray(quote)) {
      return quote as Record<string, unknown>;
    }
    return null;
  }, [existingQuoteQuery.data?.quote]);

  useEffect(() => {
    if (!existingQuote) return;
    const nextKey =
      (typeof existingQuote.id === "string" && existingQuote.id.length > 0 ? existingQuote.id : "")
      || packageId
      || dealId
      || "__saved_quote__";
    if (existingQuoteHydrationKeyRef.current === nextKey) return;
    existingQuoteHydrationKeyRef.current = nextKey;
    const loadedPackageId = loadedQuotePackageId(existingQuote);
    if (loadedPackageId && persistedQuotePackageIdRef) {
      persistedQuotePackageIdRef.current = loadedPackageId;
    }
    const hydratedDraft = hydrateDraftFromSavedQuote(existingQuote);
    setDraft((current) => ({
      ...current,
      ...hydratedDraft,
      companyId: companyId || hydratedDraft.companyId,
    }));
    setStep(readPersistedStep(nextKey) ?? stepForWizardIndex(hydratedDraft.wizardStep) ?? "review");
  }, [companyId, dealId, existingQuote, packageId, persistedQuotePackageIdRef, setDraft, setStep]);

  return { existingQuoteQuery, existingQuote };
}
