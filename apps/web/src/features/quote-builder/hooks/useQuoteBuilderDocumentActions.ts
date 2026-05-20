/**
 * Post–PR 21 orchestrator slimming: document preview, PDF download, and send actions.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import {
  computeQuoteSendActionReadiness,
  type QuoteSendActionChannel,
} from "../lib/quote-workspace";
import {
  ensureQuotePublicLink,
  logQuoteDeliveryEvent,
  persistImmutableQuotePdfVersion,
  persistQuoteDocumentArtifact,
  sendQuotePackage,
  type QuotePackageSaveResponse,
} from "../lib/quote-api";
import type { SaveQuoteVariables } from "./useQuoteBuilderSave";
import type { QuotePDFData } from "../components/QuotePDFDocument";
import { buildQuotePdfVersionSnapshot } from "../lib/quote-pdf-version-snapshot";
import { buildQuoteLandingQrData } from "../lib/quote-qr";
import type { QuotePdfBlobResult, QuotePdfGenerationResult } from "./useQuotePDF";
import type { DocumentArtifactState } from "./useQuoteBuilderDocumentInvalidation";

export interface UseQuoteBuilderDocumentActionsInput {
  customerFacingDocumentBlocker: string | null;
  quoteMediaSnapshotLoading: boolean;
  quotePdfData: QuotePDFData;
  downloadPDF: (data: QuotePDFData) => Promise<QuotePdfGenerationResult>;
  generatePdfBlob: (data: QuotePDFData) => Promise<QuotePdfBlobResult>;
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
  saveMutation: UseMutationResult<QuotePackageSaveResponse, Error, SaveQuoteVariables | void, unknown>;
  refetchActiveApprovalCase: () => Promise<{
    error: Error | null;
    data?: { canSend?: boolean } | null;
  }>;
  bypassApprovedWithoutCase: boolean;
  approvalCaseCanSend: boolean;
  taxResolved: boolean;
  whyThisMachineRequired: boolean;
}

export interface QuoteSendActionResult {
  ok: boolean;
  channel: QuoteSendActionChannel;
  toEmail?: string | null;
  versionNumber?: number | null;
  documentArtifactId?: string | null;
  message?: string | null;
  error?: string | null;
}

export interface UseQuoteBuilderDocumentActionsResult {
  handleDownloadPdf: () => void;
  handleGenerateFallbackDocument: () => Promise<void>;
  handleQuoteSendAction: (channel: QuoteSendActionChannel) => Promise<QuoteSendActionResult>;
}

export function useQuoteBuilderDocumentActions({
  customerFacingDocumentBlocker,
  quoteMediaSnapshotLoading,
  quotePdfData,
  downloadPDF,
  generatePdfBlob,
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
  const latestCustomerFacingSaveResponseRef = useRef<QuotePackageSaveResponse | null>(null);

  const ensureCleanApprovalForCustomerFacing = useCallback(async (): Promise<string | null> => {
    if (!packetReadinessDraftReady) return "Save the quote package before customer-facing actions.";
    if (draftSaveSignature !== lastAutoSaveSignatureRef.current) {
      latestCustomerFacingSaveResponseRef.current = await saveMutation.mutateAsync();
      lastAutoSaveSignatureRef.current = draftSaveSignature;
    } else {
      latestCustomerFacingSaveResponseRef.current = saveMutation.data ?? latestCustomerFacingSaveResponseRef.current;
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
    saveMutation.data,
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
      expiresAt: draft.expiresAt ?? null,
      customerEmail: draft.customerEmail ?? null,
      customerPhone: draft.customerPhone ?? null,
      documentReady: channel === "email" ? true : Boolean(documentFallbackGeneratedAt),
      taxResolved,
      whyThisMachineRequired,
      whyThisMachineConfirmed: draft.whyThisMachineConfirmed === true,
    });
    if (!readiness.ready) {
      const error = `Blocked: ${readiness.missing.join(", ")}.`;
      setDeliveryActionError(error);
      return { ok: false, channel, error };
    }
    if (channel === "email" && quoteMediaSnapshotLoading) {
      const error = "Blocked: trade-in photos are still loading. Try again in a moment so the sent PDF includes the stored trade media.";
      setDeliveryActionError(error);
      return { ok: false, channel, error };
    }
    const approvalRefreshBlocker = await ensureCleanApprovalForCustomerFacing();
    if (approvalRefreshBlocker) {
      const error = `Blocked: ${approvalRefreshBlocker}`;
      setDeliveryActionError(error);
      return { ok: false, channel, error };
    }
    if (!activeQuotePackageId) {
      const error = "Blocked: save the quote package before customer-facing actions.";
      setDeliveryActionError(error);
      return { ok: false, channel, error };
    }
    setDeliveryActionBusy(channel);
    try {
      if (channel === "preview") {
        if (quoteMediaSnapshotLoading) {
          const error = "Blocked: trade-in photos are still loading. Try again in a moment.";
          setDeliveryActionError(error);
          return { ok: false, channel, error };
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
        const message = "Preview opened and logged. This does not mark the quote sent.";
        setDeliveryActionMessage(message);
        return { ok: true, channel, message };
      }

      const textEnabled = import.meta.env.VITE_FEATURE_QRM_TEXT_QUOTE === "true";
      if (channel === "email") {
        const ensuredLink = await ensureQuotePublicLink(activeQuotePackageId);
        const customerSendPdfData: QuotePDFData = {
          ...quotePdfData,
          publicLandingUrl: ensuredLink.public_url,
          landingQr: buildQuoteLandingQrData(ensuredLink.public_url),
        };
        const pdfResult = await generatePdfBlob(customerSendPdfData);
        const quotePackageVersionId = latestCustomerFacingSaveResponseRef.current?.quote_package_version_id
          ?? saveMutation.data?.quote_package_version_id
          ?? null;
        const proposalSnapshot = buildQuotePdfVersionSnapshot(customerSendPdfData, {
          quotePackageId: activeQuotePackageId,
          quotePackageVersionId,
        });
        const artifact = await persistImmutableQuotePdfVersion({
          quotePackageId: activeQuotePackageId,
          quotePackageVersionId,
          blob: pdfResult.blob,
          filename: pdfResult.filename,
          proposalSnapshot,
        });
        const result = await sendQuotePackage(activeQuotePackageId, {
          documentArtifactId: artifact.id,
          followUpAt: draft.followUpAt ?? null,
        });
        const generatedArtifact: DocumentArtifactState = {
          id: artifact.id,
          storageBucket: artifact.storageBucket,
          storageKey: artifact.storageKey,
          generatedAt: artifact.generatedAt,
        };
        setDocumentArtifact(generatedArtifact);
        documentDraftSignatureRef.current = draftSaveSignature;
        setDocumentFallbackGeneratedAt(artifact.generatedAt);
        setDraft((current) => ({ ...current, quoteStatus: "sent" }));
        const versionNumber = result.pdf_version_number ?? artifact.versionNumber ?? null;
        const documentArtifactId = result.document_artifact_id ?? artifact.id;
        const message = `Quote emailed to ${result.to_email}. Version ${versionNumber ?? "latest"} PDF artifact ${documentArtifactId} was generated fresh and delivery ${result.delivery_event_id ? "logged" : "recorded by quote status"}.`;
        setDeliveryActionMessage(message);
        return {
          ok: true,
          channel,
          toEmail: result.to_email,
          versionNumber,
          documentArtifactId,
          message,
        };
      }

      if (!textEnabled) {
        const message = "Text delivery is not connected yet. Email the proposal or use the approved proposal link for now.";
        setDeliveryActionMessage(message);
        return { ok: true, channel, message };
      }

      const error = "Text delivery is not connected yet. Email the proposal or use the approved proposal link for now.";
      setDeliveryActionError(error);
      return { ok: false, channel, error };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Quote delivery action failed.";
      setDeliveryActionError(message);
      return { ok: false, channel, error: message };
    } finally {
      setDeliveryActionBusy(null);
    }
  }, [
    activeQuotePackageId,
    approvalCaseCanSend,
    documentDraftSignatureRef,
    documentFallbackGeneratedAt,
    draft,
    draftSaveSignature,
    downloadPDF,
    ensureCleanApprovalForCustomerFacing,
    generatePdfBlob,
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
