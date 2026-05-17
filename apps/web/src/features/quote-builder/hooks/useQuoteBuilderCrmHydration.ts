/**
 * Post–PR 21 orchestrator slimming: CRM customer hydration from URL params.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { hydrateCustomerById } from "../lib/customer-search-api";
import { readPersistedStep } from "../wizard/wizard-storage";
import { stepForWizardIndex, type Step } from "../wizard/wizard-types";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderCrmHydrationInput {
  prospectConverted: boolean;
  companyId: string;
  contactId: string;
  dealId: string;
  packageId: string;
  customerName: string;
  customerCompany: string;
  existingQuote: Record<string, unknown> | null;
  existingQuoteLoading: boolean;
  existingQuoteFetching: boolean;
  draftRef: MutableRefObject<QuoteWorkspaceDraft>;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  setStep: (step: Step) => void;
}

export function useQuoteBuilderCrmHydration({
  prospectConverted,
  companyId,
  contactId,
  dealId,
  packageId,
  customerName,
  customerCompany,
  existingQuote,
  existingQuoteLoading,
  existingQuoteFetching,
  draftRef,
  setDraft,
  setStep,
}: UseQuoteBuilderCrmHydrationInput): void {
  useEffect(() => {
    if (!prospectConverted || !companyId) return;
    if (packageId && existingQuote) return;
    if (packageId && (existingQuoteLoading || existingQuoteFetching)) return;
    let cancelled = false;
    (async () => {
      try {
        const hydrated = await hydrateCustomerById({ companyId });
        if (!hydrated || cancelled) return;
        setDraft((current) => ({
          ...current,
          contactId: hydrated.contactId ?? current.contactId,
          companyId: hydrated.companyId ?? companyId,
          customerName: hydrated.customerName || current.customerName,
          customerCompany: hydrated.customerCompany || current.customerCompany,
          customerPhone: hydrated.customerPhone || current.customerPhone,
          customerEmail: hydrated.customerEmail || current.customerEmail,
          customerSignals: hydrated.signals,
          customerWarmth: hydrated.warmth,
        }));
        const nextStep =
          readPersistedStep(packageId || null)
          ?? stepForWizardIndex(draftRef.current.wizardStep)
          ?? "customer";
        setStep(nextStep);
      } catch {
        // Non-fatal: the company id still persists on next save.
      }
    })();
    return () => { cancelled = true; };
  }, [
    companyId,
    draftRef,
    existingQuote,
    existingQuoteFetching,
    existingQuoteLoading,
    packageId,
    prospectConverted,
    setDraft,
    setStep,
  ]);

  useEffect(() => {
    const hasCustomer = Boolean(customerName.trim() || customerCompany.trim());
    if (hasCustomer) return;
    if (existingQuoteLoading || existingQuoteFetching || existingQuote) return;
    if (!contactId && !companyId && !dealId) return;

    let cancelled = false;
    (async () => {
      try {
        const hydrated = await hydrateCustomerById({
          contactId: contactId || null,
          companyId: companyId || null,
          dealId: dealId || null,
        });
        if (!hydrated || cancelled) return;
        setDraft((current) => ({
          ...current,
          contactId: hydrated.contactId ?? current.contactId,
          companyId: hydrated.companyId ?? current.companyId,
          customerName: hydrated.customerName,
          customerCompany: hydrated.customerCompany,
          customerPhone: hydrated.customerPhone,
          customerEmail: hydrated.customerEmail,
          customerSignals: hydrated.signals,
          customerWarmth: hydrated.warmth,
        }));
      } catch {
        // Non-fatal — rep can still search/pick manually.
      }
    })();
    return () => { cancelled = true; };
  }, [
    companyId,
    contactId,
    customerCompany,
    customerName,
    dealId,
    existingQuote,
    existingQuoteFetching,
    existingQuoteLoading,
    setDraft,
  ]);
}
