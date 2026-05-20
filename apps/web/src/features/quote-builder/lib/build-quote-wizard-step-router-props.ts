/**
 * Post–PR 21 orchestrator slimming: QuoteWizardStepRouter prop assembly.
 */

import type { QuoteWizardStepRouterProps } from "../wizard/QuoteWizardStepRouter";

export type QuoteBuilderStepRouterIntakeProps = Pick<QuoteWizardStepRouterProps, "aiPrompt" | "setAiPrompt" | "intakeRecorderOpen" | "setIntakeRecorderOpen" | "onVoiceRecorded" | "voiceMutationPending" | "onBuildWithAi" | "aiIntakeMutationPending" | "aiIntakeMessage">;

export type QuoteBuilderStepRouterIntelligenceProps = Pick<QuoteWizardStepRouterProps, "winProbContext" | "factorVerdicts" | "shadowHistory" | "shadowCalibration" | "intelligencePanel">;

export type QuoteBuilderStepRouterCatalogProps = Pick<QuoteWizardStepRouterProps, "setAvailableOptions" | "setAvailableOptionsLabel" | "availableOptionsLabel" | "configureTab" | "setConfigureTab" | "availableOptions" | "setPackageItemSearchOpen" | "customLineTitle" | "setCustomLineTitle" | "customLinePrice" | "setCustomLinePrice" | "addConfigLine">;

export type QuoteBuilderStepRouterAvailabilityProps = Pick<QuoteWizardStepRouterProps, "equipmentKeyForLine" | "availabilityStatusForLine" | "availabilityRequestIdForLine" | "availabilityRequestCreatedAtForLine" | "availabilityRequestLabel" | "availabilityLabel" | "liveAvailabilityRequestForLine" | "liveAvailabilityStatusForLine" | "markAvailabilityConfirmationRequested" | "markAllAvailabilityConfirmationRequested" | "availabilityRequestMutationPending" | "sourceRequiredAwaitingConfirmation" | "sourceRequiredUnavailable" | "equipmentCanContinue" | "availabilityAwaitingCount">;

export type QuoteBuilderStepRouterTradeProps = Pick<QuoteWizardStepRouterProps, "appliedValuationSnapshot" | "onPointShootApply" | "tradeChecklist" | "tradeCapture" | "tradeManagerApprovalRequired" | "onOpenTradeCapture">;

export type QuoteBuilderStepRouterTotalsProps = Pick<QuoteWizardStepRouterProps, "equipmentTotal" | "attachmentTotal" | "internalCostLoadTotal" | "pricingLineTotal" | "subtotal" | "discountTotal" | "taxableBasis" | "taxTotal" | "customerTotal" | "marginPct" | "dealerCost" | "netTotal" | "marginAmount" | "inboundFreightEligible">;

export type QuoteBuilderStepRouterPricingProps = Pick<QuoteWizardStepRouterProps, "pricingLine" | "upsertPricingLine" | "discountLine" | "miscChargeTitle" | "setMiscChargeTitle" | "miscChargeAmount" | "setMiscChargeAmount" | "miscCreditTitle" | "setMiscCreditTitle" | "miscCreditAmount" | "setMiscCreditAmount" | "onAddMiscPricingLine" | "taxProfiles">;

export type QuoteBuilderStepRouterTaxFinanceProps = Pick<QuoteWizardStepRouterProps, "taxPreviewData" | "taxPreviewLoading" | "taxPreviewError" | "branchStateProvince" | "activeQuotePackageId" | "allFinanceScenarios" | "cashDown" | "amountFinanced" | "financingPreviewLoading" | "financingPreviewError" | "leaseQuotingEnabled" | "branchDisplayName" | "financeMethodLabel">;

export type QuoteBuilderStepRouterApprovalProps = Pick<QuoteWizardStepRouterProps, "sendReadiness" | "requiresManagerApproval" | "userRole" | "canSubmitForApproval" | "approvalPending" | "approvalGranted" | "bypassApprovedWithoutCase" | "submitApprovalPending" | "onSubmitApproval" | "submitApprovalData" | "quoteStatus" | "onQuoteStatusChange" | "onSendQuote" | "quoteTitle" | "approvalCaseCanSend" | "approvalBlocker" | "currentUserId" | "onWithdrawApproval" | "withdrawApprovalPending">;

export type QuoteBuilderStepRouterDocumentSendProps = Pick<QuoteWizardStepRouterProps, "documentPersistenceLabel" | "documentFallbackGeneratedAt" | "documentArtifact" | "customerFacingDocumentBlocker" | "pdfGenerating" | "quoteMediaSnapshotLoading" | "documentActionError" | "documentReady" | "onGenerateDocument" | "taxResolved" | "taxResolutionBlocker" | "whyThisMachineRequired" | "whyThisMachineBlocker" | "previewReadiness" | "emailReadiness" | "textReadiness" | "textQuoteEnabled" | "deliveryActionBusy" | "deliveryActionMessage" | "deliveryActionError" | "savePending" | "onPreview" | "onEmail" | "onText" | "onSaveFollowUp">;

export interface QuoteBuilderStepRouterGroups {
  intake: QuoteBuilderStepRouterIntakeProps;
  intelligence: QuoteBuilderStepRouterIntelligenceProps;
  catalog: QuoteBuilderStepRouterCatalogProps;
  availability: QuoteBuilderStepRouterAvailabilityProps;
  trade: QuoteBuilderStepRouterTradeProps;
  totals: QuoteBuilderStepRouterTotalsProps;
  pricing: QuoteBuilderStepRouterPricingProps;
  taxFinance: QuoteBuilderStepRouterTaxFinanceProps;
  approval: QuoteBuilderStepRouterApprovalProps;
  documentSend: QuoteBuilderStepRouterDocumentSendProps;
}

export function buildQuoteWizardStepRouterProps(groups: QuoteBuilderStepRouterGroups): QuoteWizardStepRouterProps {
  return {
    ...groups.intake,
    ...groups.intelligence,
    ...groups.catalog,
    ...groups.availability,
    ...groups.trade,
    ...groups.totals,
    ...groups.pricing,
    ...groups.taxFinance,
    ...groups.approval,
    ...groups.documentSend,
  };
}
