/**
 * Post–PR 21 orchestrator slimming: debounced localStorage draft persistence.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type MutableRefObject } from "react";

import {
  clearLocalDraft,
  isDraftEmpty,
  saveLocalDraft,
} from "../lib/local-draft";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderLocalDraftPersistInput {
  draftSaveSignature: string;
  localDraftHydrationComplete: boolean;
  localDraftKey: string | null;
  localPersistEnabled: boolean;
  draftRef: MutableRefObject<QuoteWorkspaceDraft>;
}

export function useQuoteBuilderLocalDraftPersist({
  draftSaveSignature,
  localDraftHydrationComplete,
  localDraftKey,
  localPersistEnabled,
  draftRef,
}: UseQuoteBuilderLocalDraftPersistInput): void {
  useEffect(() => {
    if (!localDraftHydrationComplete) return;
    if (!localPersistEnabled) return;
    if (!localDraftKey) return;
    if (isDraftEmpty(draftRef.current)) {
      clearLocalDraft(localDraftKey);
      return;
    }
    const tid = window.setTimeout(() => {
      const d = draftRef.current;
      if (!localDraftKey || isDraftEmpty(d)) return;
      saveLocalDraft(localDraftKey, d);
    }, 450);
    return () => window.clearTimeout(tid);
  }, [
    draftRef,
    draftSaveSignature,
    localDraftHydrationComplete,
    localDraftKey,
    localPersistEnabled,
  ]);

  useEffect(() => {
    if (!localDraftHydrationComplete || !localPersistEnabled || !localDraftKey) return;
    const flush = () => {
      const key = localDraftKey;
      if (!key) return;
      const d = draftRef.current;
      if (!isDraftEmpty(d)) saveLocalDraft(key, d);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [
    draftRef,
    localDraftHydrationComplete,
    localDraftKey,
    localPersistEnabled,
  ]);
}
