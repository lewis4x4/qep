/**
 * Post–PR 21 orchestrator slimming: QuoteWizardStepRouter grouped bindings.
 */

import { useMemo } from "react";

import {
  buildQuoteWizardStepRouterProps,
  type QuoteBuilderStepRouterGroups,
} from "../lib/build-quote-wizard-step-router-props";
import type { QuoteSendActionChannel } from "../lib/quote-workspace";
import type { TradeChecklistKey } from "../lib/trade-checklist";
import type { QuoteWizardStepRouterProps } from "../wizard/QuoteWizardStepRouter";
import type { QuoteBuilderOrchestratorStepRouterInput } from "./quote-builder-orchestrator-step-router-input";

export function useQuoteBuilderOrchestratorStepRouterGroups(
  input: QuoteBuilderOrchestratorStepRouterInput,
): QuoteWizardStepRouterProps {
  const deps = input as QuoteBuilderOrchestratorStepRouterInput & Record<string, unknown>;
  return useMemo(
    () => buildQuoteWizardStepRouterProps({

    intake: {
      aiPrompt: deps.aiPrompt,
      setAiPrompt: deps.setAiPrompt,
      intakeRecorderOpen: deps.intakeRecorderOpen,
      setIntakeRecorderOpen: deps.setIntakeRecorderOpen,
      onVoiceRecorded: deps.onVoiceRecorded,
      voiceMutationPending: (deps.voiceMutation as { isPending: boolean }).isPending,
      onBuildWithAi: deps.onBuildWithAi,
      aiIntakeMutationPending: (deps.aiIntakeMutation as { isPending: boolean }).isPending,
      aiIntakeMessage: deps.aiIntakeMessage,
    },
    intelligence: {
      winProbContext: deps.winProbContext,
      factorVerdicts: deps.factorVerdicts,
      shadowHistory: deps.shadowHistory,
      shadowCalibration: deps.shadowCalibration,
      intelligencePanel: deps.intelligencePanel,
    },
    catalog: {
      setAvailableOptions: deps.setAvailableOptions,
      setAvailableOptionsLabel: deps.setAvailableOptionsLabel,
      availableOptionsLabel: deps.availableOptionsLabel,
      configureTab: deps.configureTab,
      setConfigureTab: deps.setConfigureTab,
      availableOptions: deps.availableOptions,
      setPackageItemSearchOpen: deps.setPackageItemSearchOpen,
      customLineTitle: deps.customLineTitle,
      setCustomLineTitle: deps.setCustomLineTitle,
      customLinePrice: deps.customLinePrice,
      setCustomLinePrice: deps.setCustomLinePrice,
      addConfigLine: deps.addConfigLine,
    },
    availability: {
      equipmentKeyForLine: deps.equipmentKeyForLine,
      availabilityStatusForLine: deps.availabilityStatusForLine,
      availabilityRequestIdForLine: deps.availabilityRequestIdForLine,
      availabilityRequestCreatedAtForLine: deps.availabilityRequestCreatedAtForLine,
      availabilityRequestLabel: deps.availabilityRequestLabel,
      availabilityLabel: deps.availabilityLabel,
      liveAvailabilityRequestForLine: deps.liveAvailabilityRequestForLine,
      liveAvailabilityStatusForLine: deps.liveAvailabilityStatusForLine,
      markAvailabilityConfirmationRequested: deps.markAvailabilityConfirmationRequested,
      markAllAvailabilityConfirmationRequested: deps.markAllAvailabilityConfirmationRequested,
      availabilityRequestMutationPending: (deps.availabilityRequestMutation as { isPending: boolean }).isPending,
      sourceRequiredAwaitingConfirmation: deps.sourceRequiredAwaitingConfirmation,
      sourceRequiredUnavailable: deps.sourceRequiredUnavailable,
      equipmentCanContinue: deps.equipmentCanContinue,
      availabilityAwaitingCount: (deps.sourceRequiredAwaitingConfirmation as unknown[]).length,
    },
    trade: {
      appliedValuationSnapshot: (deps.tradeValuationProposalQuery as { data: unknown }).data ?? null,
      onPointShootApply: deps.handlePointShootTradeApply,
      tradeChecklist: deps.tradeChecklist,
      tradeCapture: deps.tradeCapture,
      tradeManagerApprovalRequired: deps.tradeManagerApprovalRequired,
      onOpenTradeCapture: (key: TradeChecklistKey) => {
        (deps.setActiveTradeCaptureKey as (key: TradeChecklistKey) => void)(key);
        (deps.setTradeCaptureOpen as (open: boolean) => void)(true);
      },
    },
    totals: {
      equipmentTotal: deps.equipmentTotal,
      attachmentTotal: deps.attachmentTotal,
      internalCostLoadTotal: deps.internalCostLoadTotal,
      pricingLineTotal: deps.pricingLineTotal,
      subtotal: deps.subtotal,
      discountTotal: deps.discountTotal,
      taxableBasis: deps.taxableBasis,
      taxTotal: deps.taxTotal,
      customerTotal: deps.customerTotal,
      marginPct: deps.marginPct,
      marginFloorPct: deps.marginFloorPct,
      marginFloorResolved: deps.marginFloorResolved,
      dealerCost: deps.dealerCost,
      netTotal: deps.netTotal,
      marginAmount: deps.marginAmount,
      inboundFreightEligible: deps.inboundFreightEligible,
    },
    pricing: {
      pricingLine: deps.pricingLine,
      upsertPricingLine: deps.upsertPricingLine,
      discountLine: deps.discountLine,
      miscChargeTitle: deps.miscChargeTitle,
      setMiscChargeTitle: deps.setMiscChargeTitle,
      miscChargeAmount: deps.miscChargeAmount,
      setMiscChargeAmount: deps.setMiscChargeAmount,
      miscCreditTitle: deps.miscCreditTitle,
      setMiscCreditTitle: deps.setMiscCreditTitle,
      miscCreditAmount: deps.miscCreditAmount,
      setMiscCreditAmount: deps.setMiscCreditAmount,
      onAddMiscPricingLine: deps.handleAddMiscPricingLine,
      taxProfiles: deps.taxProfiles,
    },
    taxFinance: {
      taxPreviewData: (deps.taxPreviewQuery as { data: unknown }).data,
      taxPreviewLoading: (deps.taxPreviewQuery as { isLoading: boolean }).isLoading,
      taxPreviewError: (deps.taxPreviewQuery as { isError: boolean }).isError,
      branchStateProvince: (deps.selectedBranch as { state_province?: string } | undefined)?.state_province,
      activeQuotePackageId: deps.activeQuotePackageId,
      allFinanceScenarios: deps.allFinanceScenarios,
      cashDown: deps.cashDown,
      amountFinanced: deps.amountFinanced,
      financingPreviewLoading: (deps.financingPreviewQuery as { isLoading: boolean }).isLoading,
      financingPreviewError: (deps.financingPreviewQuery as { isError: boolean }).isError,
      leaseQuotingEnabled: deps.leaseQuotingEnabled,
      branchDisplayName: (deps.selectedBranch as { display_name?: string } | undefined)?.display_name ?? ((deps.draft as { branchSlug?: string }).branchSlug || "Missing"),
      financeMethodLabel: deps.financeMethodLabel,
    },
    approval: {
      sendReadiness: (deps.packetReadiness as { send: QuoteWizardStepRouterProps["sendReadiness"] }).send,
      requiresManagerApproval: (deps.approvalState as { requiresManagerApproval: boolean }).requiresManagerApproval,
      userRole: (deps.userRoleQuery as { data: string | null }).data ?? null,
      canSubmitForApproval: deps.canSubmitForApproval,
      approvalPending: deps.approvalPending,
      approvalGranted: deps.approvalGranted,
      bypassApprovedWithoutCase: deps.bypassApprovedWithoutCase,
      submitApprovalPending: (deps.submitApprovalMutation as { isPending: boolean }).isPending,
      // Phase 1 quote-approval feedback loop: thread the rep's optional
      // justification through to submitApprovalMutation so the
      // submit-approval edge function persists it on the case row.
      onSubmitApproval: (submissionNote: string) => {
        (deps.submitApprovalMutation as {
          mutate: (vars: { submissionNote?: string | null }) => void;
        }).mutate({ submissionNote: submissionNote ?? null });
      },
      submitApprovalData: (deps.submitApprovalMutation as { data: unknown }).data,
      quoteStatus: deps.quoteStatus,
      onQuoteStatusChange: deps.handleQuoteStatusChange,
      onSendQuote: deps.handleVersionedEmailSend,
      quoteTitle: deps.quoteTitle,
      approvalCaseCanSend: deps.approvalCaseCanSend,
      approvalBlocker: deps.approvalBlocker,
      // Phase 3B quote-approval feedback loop: thread the rep's identity
      // and the withdraw mutation down to the Review step so the active
      // approval card can render a "Withdraw submission" affordance for
      // the submitter only.
      currentUserId: (deps.currentUserId as string | null) ?? null,
      withdrawApprovalPending: (deps.withdrawApprovalMutation as { isPending: boolean }).isPending,
      onWithdrawApproval: (input: { approvalCaseId: string; reason?: string | null }) => {
        (deps.withdrawApprovalMutation as {
          mutate: (vars: { approvalCaseId: string; reason?: string | null }) => void;
        }).mutate({ approvalCaseId: input.approvalCaseId, reason: input.reason ?? null });
      },
    },
    documentSend: {
      documentPersistenceLabel: deps.documentPersistenceLabel,
      documentFallbackGeneratedAt: deps.documentFallbackGeneratedAt,
      documentArtifact: deps.documentArtifact,
      customerFacingDocumentBlocker: deps.customerFacingDocumentBlocker,
      pdfGenerating: deps.pdfGenerating,
      quoteMediaSnapshotLoading: deps.quoteMediaSnapshotLoading,
      documentActionError: deps.documentActionError,
      documentReady: deps.documentReady,
      onGenerateDocument: () => void (deps.handleGenerateFallbackDocument as () => void)(),
      taxResolved: deps.taxResolved,
      taxResolutionBlocker: deps.taxResolutionBlocker,
      whyThisMachineRequired: deps.whyThisMachineRequired,
      whyThisMachineBlocker: deps.whyThisMachineBlocker,
      previewReadiness: deps.previewReadiness,
      emailReadiness: deps.emailReadiness,
      textReadiness: deps.textReadiness,
      textQuoteEnabled: deps.textQuoteEnabled,
      deliveryActionBusy: deps.deliveryActionBusy,
      deliveryActionMessage: deps.deliveryActionMessage,
      deliveryActionError: deps.deliveryActionError,
      savePending: (deps.saveMutation as { isPending: boolean }).isPending,
      onPreview: () => void (deps.handleQuoteSendAction as (channel: QuoteSendActionChannel) => void)("preview"),
      onEmail: () => void (deps.handleVersionedEmailSend as () => Promise<unknown>)(),
      onText: () => void (deps.handleQuoteSendAction as (channel: QuoteSendActionChannel) => void)("text"),
      onSaveFollowUp: () => void (deps.handleSaveClick as () => void)(),
    },
    } as unknown as QuoteBuilderStepRouterGroups),
    [input],
  );
}
