/**
 * Post–PR 21 orchestrator slimming: tax/approval/document readiness glue.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useMemo } from "react";

import type {
  QuoteApprovalCaseSummary,
  QuoteFinanceScenario,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import type { getTradeValuationProposalSnapshot } from "../lib/point-shoot-trade-api";
import type { Branch } from "@/hooks/useBranches";
import { resolveApprovalBlockerMessage } from "../lib/quote-builder-approval-blocker";
import { buildQuoteProposalData } from "../lib/quote-proposal-data";
import { buildQuotePdfBranch } from "../lib/quote-builder-page-normalizers";
import {
  isQuoteWhyThisMachineConfirmationRequired,
  isTaxProfileExempt,
} from "../lib/quote-workspace";
import { shortDateTime } from "../lib/quote-date-input";

export interface UseQuoteBuilderReadinessInput {
  draft: QuoteWorkspaceDraft;
  subtotal: number;
  equipmentTotal: number;
  attachmentTotal: number;
  pricingLineTotal: number;
  discountTotal: number;
  netTotal: number;
  taxTotal: number;
  customerTotal: number;
  cashDown: number;
  amountFinanced: number;
  marginPct: number;
  allFinanceScenarios: QuoteFinanceScenario[];
  activeQuotePackageId: string | null;
  activeQuoteNumber: string | null;
  activeApprovalCaseLoading: boolean;
  bypassApprovedWithoutCase: boolean;
  activeApprovalCase: QuoteApprovalCaseSummary | null;
  taxPreviewSuccess: boolean;
  taxPreviewError: boolean;
  selectedBranch: Branch | undefined;
  tradeValuationSnapshot: Awaited<ReturnType<typeof getTradeValuationProposalSnapshot>> | null | undefined;
  tradeValuationLoading: boolean;
  tradeValuationFetching: boolean;
  hasTradeValuationData: boolean;
  selectedFinanceScenarioLabel: string | null | undefined;
  lastSavedAt: string | null;
  activeQuoteUpdatedAt: string | null;
}

export function useQuoteBuilderReadiness({
  draft,
  subtotal,
  equipmentTotal,
  attachmentTotal,
  pricingLineTotal,
  discountTotal,
  netTotal,
  taxTotal,
  customerTotal,
  cashDown,
  amountFinanced,
  marginPct,
  allFinanceScenarios,
  activeQuotePackageId,
  activeQuoteNumber,
  activeApprovalCaseLoading,
  bypassApprovedWithoutCase,
  activeApprovalCase,
  taxPreviewSuccess,
  taxPreviewError,
  selectedBranch,
  tradeValuationSnapshot,
  tradeValuationLoading,
  tradeValuationFetching,
  hasTradeValuationData,
  selectedFinanceScenarioLabel,
  lastSavedAt,
  activeQuoteUpdatedAt,
}: UseQuoteBuilderReadinessInput) {
  const manualTaxOverrideReady = draft.taxOverrideAmount != null && Boolean(draft.taxOverrideReason?.trim());
  const taxPreviewRequiresSuccessfulCalculation =
    !isTaxProfileExempt(draft.taxProfile)
    && Boolean(draft.branchSlug || draft.deliveryState)
    && subtotal > 0
    && !manualTaxOverrideReady;
  const taxResolved = !taxPreviewRequiresSuccessfulCalculation || taxPreviewSuccess;

  const taxResolutionBlocker = taxResolved
    ? null
    : taxPreviewError
      ? "Tax preview failed. Resolve the jurisdiction or enter a manual tax override with a reason before customer-facing document/send."
      : "Tax preview must complete before customer-facing document/send.";

  const whyThisMachineRequired = isQuoteWhyThisMachineConfirmationRequired(draft);
  const whyThisMachineBlocker = whyThisMachineRequired && draft.whyThisMachineConfirmed !== true
    ? "Confirm the Why this machine narrative before customer-facing document/send."
    : null;

  const approvalBlocker = resolveApprovalBlockerMessage({
    activeQuotePackageId,
    activeApprovalCaseLoading,
    bypassApprovedWithoutCase,
    activeApprovalCase,
  });

  const customerFacingDocumentBlocker = approvalBlocker ?? taxResolutionBlocker ?? whyThisMachineBlocker;

  const displayedSavedAt = lastSavedAt ?? activeQuoteUpdatedAt;
  const displayedSavedLabel = shortDateTime(displayedSavedAt);

  const financeMethodLabel =
    selectedFinanceScenarioLabel
    ?? draft.selectedFinanceScenario
    ?? (amountFinanced > 0 ? "Cash / TBD" : "Cash");

  const quoteTitle =
    activeQuoteNumber
    ?? (activeQuotePackageId ? `Quote ${activeQuotePackageId.slice(0, 8)}` : "New quote");

  const quotePdfData = useMemo(() => buildQuoteProposalData({
    draft,
    computed: {
      equipmentTotal,
      attachmentTotal,
      pricingLineTotal,
      subtotal,
      discountTotal,
      netTotal,
      taxTotal,
      customerTotal,
      cashDown,
      amountFinanced,
    },
    financeScenarios: allFinanceScenarios,
    quoteNumber: activeQuoteNumber,
    preparedBy: "QEP Sales Team",
    preparedDate: new Date().toLocaleDateString(),
    branch: buildQuotePdfBranch(selectedBranch),
    tradeValuation: tradeValuationSnapshot ?? null,
  }), [
    activeQuoteNumber,
    allFinanceScenarios,
    amountFinanced,
    attachmentTotal,
    cashDown,
    customerTotal,
    discountTotal,
    draft,
    equipmentTotal,
    netTotal,
    pricingLineTotal,
    selectedBranch,
    subtotal,
    taxTotal,
    tradeValuationSnapshot,
  ]);

  const quoteMediaSnapshotLoading =
    Boolean(draft.tradeValuationId)
    && (tradeValuationLoading || tradeValuationFetching)
    && !hasTradeValuationData;

  return {
    manualTaxOverrideReady,
    taxPreviewRequiresSuccessfulCalculation,
    taxResolved,
    taxResolutionBlocker,
    whyThisMachineRequired,
    whyThisMachineBlocker,
    approvalBlocker,
    customerFacingDocumentBlocker,
    displayedSavedLabel,
    financeMethodLabel,
    quoteTitle,
    quotePdfData,
    quoteMediaSnapshotLoading,
  };
}
