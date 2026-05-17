/**
 * Post–PR 21 orchestrator slimming: localStorage draft key + initial restore.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  buildLocalDraftKey,
  isDraftEmpty,
  loadLocalDraft,
} from "../lib/local-draft";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderLocalDraftInput {
  userId: string | undefined;
  dealId: string;
  contactId: string;
  draftDealId: string | undefined;
  draftContactId: string | undefined;
  ironQuoteHandoffId: string;
  existingQuote: Record<string, unknown> | null;
  existingQuoteLoading: boolean;
  existingQuoteFetching: boolean;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
}

export interface UseQuoteBuilderLocalDraftResult {
  localDraftKey: string | null;
  localDraftHydrationComplete: boolean;
  localPersistEnabled: boolean;
  setLocalPersistEnabled: Dispatch<SetStateAction<boolean>>;
}

export function useQuoteBuilderLocalDraft({
  userId,
  dealId,
  contactId,
  draftDealId,
  draftContactId,
  ironQuoteHandoffId,
  existingQuote,
  existingQuoteLoading,
  existingQuoteFetching,
  setDraft,
}: UseQuoteBuilderLocalDraftInput): UseQuoteBuilderLocalDraftResult {
  const localDraftKey = useMemo(
    () => userId
      ? buildLocalDraftKey({
        userId,
        dealId: dealId || draftDealId,
        contactId: contactId || draftContactId,
      })
      : null,
    [userId, dealId, contactId, draftDealId, draftContactId],
  );

  const [localDraftHydrationComplete, setLocalDraftHydrationComplete] = useState(false);
  const [localPersistEnabled, setLocalPersistEnabled] = useState(true);

  useEffect(() => {
    if (localDraftHydrationComplete) return;
    if (!localDraftKey) return;
    if (existingQuoteFetching || existingQuoteLoading) return;
    if (existingQuote) {
      setLocalDraftHydrationComplete(true);
      return;
    }
    if (ironQuoteHandoffId) {
      setLocalDraftHydrationComplete(true);
      return;
    }
    const stored = loadLocalDraft(localDraftKey);
    if (stored && !isDraftEmpty(stored)) {
      setDraft((current) => ({ ...current, ...stored }));
    }
    setLocalDraftHydrationComplete(true);
  }, [
    existingQuote,
    existingQuoteFetching,
    existingQuoteLoading,
    ironQuoteHandoffId,
    localDraftHydrationComplete,
    localDraftKey,
    setDraft,
  ]);

  return {
    localDraftKey,
    localDraftHydrationComplete,
    localPersistEnabled,
    setLocalPersistEnabled,
  };
}
