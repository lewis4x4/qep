/**
 * Post–PR 21 orchestrator slimming: invalidate stored document when draft changes.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

export interface DocumentArtifactState {
  id: string;
  storageBucket: string;
  storageKey: string;
  generatedAt: string;
}

export interface UseQuoteBuilderDocumentInvalidationInput {
  documentFallbackGeneratedAt: string | null;
  draftSaveSignature: string;
  documentDraftSignatureRef: MutableRefObject<string>;
  setDocumentFallbackGeneratedAt: Dispatch<SetStateAction<string | null>>;
  setDocumentArtifact: Dispatch<SetStateAction<DocumentArtifactState | null>>;
}

export function useQuoteBuilderDocumentInvalidation({
  documentFallbackGeneratedAt,
  draftSaveSignature,
  documentDraftSignatureRef,
  setDocumentFallbackGeneratedAt,
  setDocumentArtifact,
}: UseQuoteBuilderDocumentInvalidationInput): void {
  useEffect(() => {
    if (!documentFallbackGeneratedAt) return;
    if (documentDraftSignatureRef.current === draftSaveSignature) return;
    documentDraftSignatureRef.current = "";
    setDocumentFallbackGeneratedAt(null);
    setDocumentArtifact(null);
  }, [
    documentFallbackGeneratedAt,
    draftSaveSignature,
    setDocumentArtifact,
    setDocumentFallbackGeneratedAt,
  ]);
}
