/**
 * Post–PR 21 orchestrator slimming: document preview, PDF download, and send actions.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import {
  computeQuoteSendActionReadiness,
  type QuoteSendActionChannel,
} from "../lib/quote-workspace";
import {
  logQuoteDeliveryEvent,
  persistQuoteDocumentArtifact,
  sendQuotePackage,
  type QuotePackageSaveResponse,
} from "../lib/quote-api";
import type { QuotePDFData } from "../components/QuotePDFDocument";
import type { QuotePdfGenerationResult } from "./useQuotePDF";
import type { DocumentArtifactState } from "./useQuoteBuilderDocumentInvalidation";

export interface UseQuoteBuilderDocumentActionsInput {
  customerFacingDocumentBlocker: string | null;
  quoteMediaSnapshotLoading: boolean;
  quotePdfData: QuotePDFData;
  downloadPDF: (data: QuotePDFData) => Promise<QuotePdfGenerationResult>;
  activeQuotePackageId: string | null;
  draft: QuoteWorkspaceDraft;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  draftSaveSignature: string;
  lastAutoSaveSignatureRef: MutableRefObject<string>;
  documentDraftSignatureRef: MutableRefObject<string>;
  documentArtifact: DocumentArtifactState | null;
  documentFallbackGeneratedAt: string | null;
  setDocumentFallbackGeneratedAt: Dispatch<SetStateAction<string | null>>;
  setDocumentArtifact: Dispatch<SetStateAction<DocumentArtifactState | null>>;
  setDocumentActionError: Dispatch<SetStateAction<string | null>>;
  setDeliveryActionMessage: Dispatch<SetStateAction<string | null>>;
  setDeliveryActionError: Dispatch<SetStateAction<string | null>>;
  setDeliveryActionBusy: Dispatch<SetStateAction<QuoteSendActionChannel | null>>;
  packetReadinessDraftReady: boolean;
  saveMutation: UseMutationResult<QuotePackageSaveResponse, Error, void, unknown>;
  refetchActiveApprovalCase: () => Promise<{
    error: Error | null;
    data?: { canSend?: boolean } | null;
  }>;
  bypassApprovedWithoutCase: boolean;
  approvalCaseCanSend: boolean;
  taxResolved: boolean;
  whyThisMachineRequired: boolean;
}

export interface UseQuoteBuilderDocumentActionsResult {
  handleDownloadPdf: () => void;
  handleGenerateFallbackDocument: () => Promise<void>;
  handleQuoteSendAction: (channel: QuoteSendActionChannel) => Promise<void>;
}

export function useQuoteBuilderDocumentActions({
  customerFacingDocumentBlocker,
  quoteMediaSnapshotLoading,
  quotePdfData,
  downloadPDF,
  activeQuotePackageId,
  draft,
  setDraft,
  draftSaveSignature,
  lastAutoSaveSignatureRef,
  documentDraftSignatureRef,
  documentArtifact,
  documentFallbackGeneratedAt,
  setDocumentFallbackGeneratedAt,
  setDocumentArtifact,
  setDocumentActionError,
  setDeliveryActionMessage,
  setDeliveryActionError,
  setDeliveryActionBusy,
  packetReadinessDraftReady,
  saveMutation,
  refetchActiveApprovalCase,
  bypassApprovedWithoutCase,
  approvalCaseCanSend,
  taxResolved,
  whyThisMachineRequired,
}: UseQuoteBuilderDocumentActionsInput): UseQuoteBuilderDocumentActionsResult {
  const ensureCleanApprovalForCustomerFacing = useCallback(async (): Promise<string | null> => {
    if (!packetReadinessDraftReady) return "Save the quote package before customer-facing actions.";
    if (draftSaveSignature !== lastAutoSaveSignatureRef.current) {
      await saveMutation.mutateAsync();
      lastAutoSaveSignatureRef.current = draftSaveSignature;
    }
    const refreshed = await refetchActiveApprovalCase();
    if (refreshed.error) {
      return "Could not recheck owner approval after saving. Try again before customer-facing actions.";
    }
    if (!refreshed.data && bypassApprovedWithoutCase) return null;
    return refreshed.data?.canSend === true
      ? null
      : "Approval case is no longer clean after saving the latest quote changes. Resubmit or wait for owner approval before customer-facing actions.";
  }, [
    bypassApprovedWithoutCase,
    draftSaveSignature,
    lastAutoSaveSignatureRef,
    packetReadinessDraftReady,
    refetchActiveApprovalCase,
    saveMutation,
  ]);

  const handleDownloadPdf = useCallback(() => {
    if (customerFacingDocumentBlocker) {
      setDocumentActionError(customerFacingDocumentBlocker);
      return;
    }
    if (quoteMediaSnapshotLoading) {
      setDocumentActionError(
        "Trade-in photos are still loading. Try again in a moment so the proposal includes the stored trade media.",
      );
      return;
    }
    void downloadPDF(quotePdfData);
  }, [
    customerFacingDocumentBlocker,
    downloadPDF,
    quoteMediaSnapshotLoading,
    quotePdfData,
    setDocumentActionError,
  ]);

  const handleGenerateFallbackDocument = useCallback(async () => {
    setDocumentActionError(null);
    if (customerFacingDocumentBlocker) {
      setDocumentActionError(customerFacingDocumentBlocker);
      return;
    }
    if (quoteMediaSnapshotLoading) {
      setDocumentActionError(
        "Trade-in photos are still loading. Try again in a moment so the proposal includes the stored trade media.",
      );
      return;
    }
    try {
      const approvalRefreshBlocker = await ensureCleanApprovalForCustomerFacing();
      if (approvalRefreshBlocker) {
        setDocumentActionError(approvalRefreshBlocker);
        return;
      }
      const pdfResult = await downloadPDF(quotePdfData);
      const generatedAt = new Date().toISOString();
      let artifact: DocumentArtifactState | null = null;
      if (activeQuotePackageId && pdfResult.blob) {
        const persisted = await persistQuoteDocumentArtifact({
          quotePackageId: activeQuotePackageId,
          quotePackageVersionId: saveMutation.data?.quote_package_version_id ?? null,
          blob: pdfResult.blob,
          filename: pdfResult.filename,
          generatedAt,
          metadata: {
            step: 10,
            mode: pdfResult.mode,
            draft_signature: draftSaveSignature,
          },
        });
        artifact = { ...persisted, generatedAt };
        setDocumentArtifact(artifact);
      } else {
        setDocumentArtifact(null);
      }
      documentDraftSignatureRef.current = draftSaveSignature;
      setDocumentFallbackGeneratedAt(generatedAt);
      if (activeQuotePackageId) {
        await logQuoteDeliveryEvent({
          quotePackageId: activeQuotePackageId,
          documentArtifactId: artifact?.id ?? null,
          channel: "preview",
          status: "draft",
          provider: artifact ? "stored_pdf_preview" : "local_preview",
          recipient: draft.customerEmail || draft.customerPhone || draft.customerName || draft.customerCompany || null,
          followUpAt: draft.followUpAt ?? null,
          metadata: {
            step: 10,
            fallback_document: !artifact,
            document_artifact_id: artifact?.id ?? null,
            generated_at: generatedAt,
            storage_bucket: artifact?.storageBucket ?? null,
            storage_key: artifact?.storageKey ?? null,
            note: artifact
              ? "Customer quote PDF stored as a quote document artifact."
              : "Printable fallback opened; no stored PDF artifact was created.",
          },
        });
      }
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : "Failed to generate document preview.");
    }
  }, [
    activeQuotePackageId,
    customerFacingDocumentBlocker,
    documentDraftSignatureRef,
    draft,
    draftSaveSignature,
    downloadPDF,
    ensureCleanApprovalForCustomerFacing,
    quoteMediaSnapshotLoading,
    quotePdfData,
    saveMutation.data?.quote_package_version_id,
    setDocumentActionError,
    setDocumentArtifact,
    setDocumentFallbackGeneratedAt,
  ]);

  const handleQuoteSendAction = useCallback(async (channel: QuoteSendActionChannel) => {
    setDeliveryActionMessage(null);
    setDeliveryActionError(null);
    const readiness = computeQuoteSendActionReadiness({
      channel,
      quotePackageId: activeQuotePackageId,
      approvalCaseCanSend,
      followUpAt: draft.followUpAt ?? null,
      customerEmail: draft.customerEmail ?? null,
      customerPhone: draft.customerPhone ?? null,
      documentReady: Boolean(documentFallbackGeneratedAt),
      taxResolved,
      whyThisMachineRequired,
      whyThisMachineConfirmed: draft.whyThisMachineConfirmed === true,
    });
    if (!readiness.ready) {
      setDeliveryActionError(`Blocked: ${readiness.missing.join(", ")}.`);
      return;
    }
    const approvalRefreshBlocker = await ensureCleanApprovalForCustomerFacing();
    if (approvalRefreshBlocker) {
      setDeliveryActionError(`Blocked: ${approvalRefreshBlocker}`);
      return;
    }
    if (!activeQuotePackageId) return;
    setDeliveryActionBusy(channel);
    try {
      if (channel === "preview") {
        if (quoteMediaSnapshotLoading) {
          setDeliveryActionError("Blocked: trade-in photos are still loading. Try again in a moment.");
          return;
        }
        const pdfResult = await downloadPDF(quotePdfData);
        const generatedAt = new Date().toISOString();
        let artifact: DocumentArtifactState | null = null;
        if (activeQuotePackageId && pdfResult.blob) {
          const persisted = await persistQuoteDocumentArtifact({
            quotePackageId: activeQuotePackageId,
            quotePackageVersionId: saveMutation.data?.quote_package_version_id ?? null,
            blob: pdfResult.blob,
            filename: pdfResult.filename,
            generatedAt,
            metadata: {
              step: 11,
              mode: pdfResult.mode,
              draft_signature: draftSaveSignature,
            },
          });
          artifact = { ...persisted, generatedAt };
          setDocumentArtifact(artifact);
        } else {
          setDocumentArtifact(null);
        }
        documentDraftSignatureRef.current = draftSaveSignature;
        setDocumentFallbackGeneratedAt(generatedAt);
        await logQuoteDeliveryEvent({
          quotePackageId: activeQuotePackageId,
          documentArtifactId: artifact?.id ?? null,
          channel: "preview",
          status: "draft",
          provider: artifact ? "stored_pdf_preview" : "local_preview",
          recipient: draft.customerEmail || draft.customerPhone || draft.customerName || draft.customerCompany || null,
          followUpAt: draft.followUpAt ?? null,
          metadata: {
            step: 11,
            fallback_document: !artifact,
            document_artifact_id: artifact?.id ?? null,
            generated_at: generatedAt,
            mode: pdfResult.mode,
            storage_bucket: artifact?.storageBucket ?? null,
            storage_key: artifact?.storageKey ?? null,
            note: artifact
              ? "Customer quote PDF stored as a quote document artifact."
              : "Printable fallback opened; no stored PDF artifact was created.",
          },
        });
        setDeliveryActionMessage("Preview opened and logged. This does not mark the quote sent.");
        return;
      }

      const textEnabled = import.meta.env.VITE_FEATURE_QRM_TEXT_QUOTE === "true";
      if (channel === "email") {
        const result = await sendQuotePackage(activeQuotePackageId, {
          documentArtifactId: documentArtifact?.id ?? null,
          followUpAt: draft.followUpAt ?? null,
        });
        setDraft((current) => ({ ...current, quoteStatus: "sent" }));
        setDeliveryActionMessage(
          `Quote emailed to ${result.to_email}. Delivery event ${result.delivery_event_id ? "logged" : "recorded by quote status"} and follow-up preserved.`,
        );
        return;
      }

      if (!textEnabled) {
        setDeliveryActionMessage("Text delivery is not connected yet. Email the proposal or use the approved proposal link for now.");
        return;
      }

      setDeliveryActionError(
        "Text delivery is not connected yet. Email the proposal or use the approved proposal link for now.",
      );
    } catch (error) {
      setDeliveryActionError(error instanceof Error ? error.message : "Quote delivery action failed.");
    } finally {
      setDeliveryActionBusy(null);
    }
  }, [
    activeQuotePackageId,
    approvalCaseCanSend,
    documentArtifact?.id,
    documentDraftSignatureRef,
    documentFallbackGeneratedAt,
    draft,
    draftSaveSignature,
    downloadPDF,
    ensureCleanApprovalForCustomerFacing,
    quoteMediaSnapshotLoading,
    quotePdfData,
    saveMutation.data?.quote_package_version_id,
    setDeliveryActionBusy,
    setDeliveryActionError,
    setDeliveryActionMessage,
    setDocumentArtifact,
    setDocumentFallbackGeneratedAt,
    setDraft,
    taxResolved,
    whyThisMachineRequired,
  ]);

  return {
    handleDownloadPdf,
    handleGenerateFallbackDocument,
    handleQuoteSendAction,
  };
}
