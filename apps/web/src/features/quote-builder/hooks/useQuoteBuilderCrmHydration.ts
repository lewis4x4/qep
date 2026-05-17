/**
 * Post–PR 21 orchestrator slimming: CRM customer hydration from URL params.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { toast } from "@/hooks/use-toast";
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

function notifyCrmHydrationFailure(description: string): void {
  toast({
    title: "Customer lookup failed",
    description,
    variant: "destructive",
  });
}

function notifyCrmHydrationFailureOnce(
  notifiedKeyRef: MutableRefObject<string | null>,
  key: string,
  description: string,
): void {
  if (notifiedKeyRef.current === key) return;
  notifiedKeyRef.current = key;
  notifyCrmHydrationFailure(description);
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
  const prospectFailureKeyRef = useRef<string | null>(null);
  const deepLinkFailureKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!prospectConverted || !companyId) return;
    if (packageId && existingQuote) return;
    if (packageId && (existingQuoteLoading || existingQuoteFetching)) return;
    const failureKey = `prospect:${companyId}:${packageId}`;
    let cancelled = false;
    (async () => {
      try {
        const hydrated = await hydrateCustomerById({ companyId });
        if (cancelled) return;
        if (!hydrated) {
          notifyCrmHydrationFailureOnce(
            prospectFailureKeyRef,
            failureKey,
            "No CRM record matched that company. Enter customer details manually.",
          );
          return;
        }
        prospectFailureKeyRef.current = null;
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
        if (!cancelled) {
          notifyCrmHydrationFailureOnce(
            prospectFailureKeyRef,
            failureKey,
            "Could not load company from CRM. Enter customer details manually.",
          );
        }
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

    const failureKey = `deeplink:${contactId}:${companyId}:${dealId}`;
    let cancelled = false;
    (async () => {
      try {
        const hydrated = await hydrateCustomerById({
          contactId: contactId || null,
          companyId: companyId || null,
          dealId: dealId || null,
        });
        if (cancelled) return;
        if (!hydrated) {
          notifyCrmHydrationFailureOnce(
            deepLinkFailureKeyRef,
            failureKey,
            "No CRM record matched this link. Search or pick a customer manually.",
          );
          return;
        }
        deepLinkFailureKeyRef.current = null;
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
        if (!cancelled) {
          notifyCrmHydrationFailureOnce(
            deepLinkFailureKeyRef,
            failureKey,
            "Could not load customer from CRM. Search or pick a customer manually.",
          );
        }
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
