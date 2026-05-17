/**
 * Post–PR 21 orchestrator slimming: `step === …` switch extracted from
 * `QuoteBuilderV2Page.tsx`. Mechanical move — behavior unchanged.
 */

import type { CustomerStepProps } from "../steps/CustomerStep";
import { CustomerStep } from "../steps/CustomerStep";
import type { EquipmentStepProps } from "../steps/EquipmentStep";
import { EquipmentStep } from "../steps/EquipmentStep";
import type { ConfigureStepProps } from "../steps/ConfigureStep";
import { ConfigureStep } from "../steps/ConfigureStep";
import type { TradeInStepProps } from "../steps/TradeInStep";
import { TradeInStep } from "../steps/TradeInStep";
import type { PricingStepProps } from "../steps/PricingStep";
import { PricingStep } from "../steps/PricingStep";
import type { PromotionsStepProps } from "../steps/PromotionsStep";
import { PromotionsStep } from "../steps/PromotionsStep";
import type { FinancingStepProps } from "../steps/FinancingStep";
import { FinancingStep } from "../steps/FinancingStep";
import { DetailsStep } from "../steps/DetailsStep";
import type { ReviewStepProps } from "../steps/ReviewStep";
import { ReviewStep } from "../steps/ReviewStep";
import type { DocumentStepProps } from "../steps/DocumentStep";
import { DocumentStep } from "../steps/DocumentStep";
import type { SendStepProps } from "../steps/SendStep";
import { SendStep } from "../steps/SendStep";
import {
  equipmentKeyForLine,
  metadataForCatalogEntry,
  type CatalogEntryMatch,
} from "../lib/quote-builder-page-helpers";
import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";
import { useWizard } from "./useWizard";

export type QuoteWizardStepRouterProps =
  CustomerStepProps
  & Omit<EquipmentStepProps, "onEquipmentCatalogSelect" | "onEquipmentRecommendation">
  & ConfigureStepProps
  & TradeInStepProps
  & PricingStepProps
  & PromotionsStepProps
  & FinancingStepProps
  & ReviewStepProps
  & DocumentStepProps
  & SendStepProps;

export function QuoteWizardStepRouter(props: QuoteWizardStepRouterProps) {
  const { step, setDraft } = useWizard();

  const onEquipmentCatalogSelect = (entry: CatalogEntryMatch) => {
    props.setAvailableOptions(entry.attachments ?? []);
    props.setAvailableOptionsLabel(`${entry.make} ${entry.model}`);
    const nextLine: QuoteLineItemDraft = {
      kind: "equipment",
      id: entry.id,
      sourceCatalog: entry.sourceCatalog ?? "qb_equipment_models",
      sourceId: entry.sourceId ?? entry.id ?? null,
      dealerCost: entry.dealerCost ?? null,
      title: `${entry.make} ${entry.model}`.trim(),
      make: entry.make,
      model: entry.model,
      year: entry.year,
      quantity: 1,
      unitPrice: entry.list_price || 0,
      metadata: metadataForCatalogEntry(entry),
    };
    const nextKey = equipmentKeyForLine(nextLine);
    setDraft((current) => ({
      ...current,
      equipment: current.equipment.some((item) => equipmentKeyForLine(item) === nextKey)
        ? current.equipment
        : [...current.equipment, nextLine],
    }));
  };

  return (
    <>
      {step === "customer" && (
        <CustomerStep
          aiPrompt={props.aiPrompt}
          setAiPrompt={props.setAiPrompt}
          intakeRecorderOpen={props.intakeRecorderOpen}
          setIntakeRecorderOpen={props.setIntakeRecorderOpen}
          onVoiceRecorded={props.onVoiceRecorded}
          voiceMutationPending={props.voiceMutationPending}
          onBuildWithAi={props.onBuildWithAi}
          aiIntakeMutationPending={props.aiIntakeMutationPending}
          aiIntakeMessage={props.aiIntakeMessage}
          winProbContext={props.winProbContext}
          factorVerdicts={props.factorVerdicts}
          shadowHistory={props.shadowHistory}
          shadowCalibration={props.shadowCalibration}
          intelligencePanel={props.intelligencePanel}
        />
      )}

      {step === "equipment" && (
        <EquipmentStep
          winProbContext={props.winProbContext}
          factorVerdicts={props.factorVerdicts}
          shadowHistory={props.shadowHistory}
          shadowCalibration={props.shadowCalibration}
          intelligencePanel={props.intelligencePanel}
          onEquipmentCatalogSelect={onEquipmentCatalogSelect}
          onEquipmentRecommendation={(recommendation) => {
            setDraft((current) => ({ ...current, recommendation }));
          }}
          setAvailableOptions={props.setAvailableOptions}
          setAvailableOptionsLabel={props.setAvailableOptionsLabel}
          availableOptionsLabel={props.availableOptionsLabel}
          equipmentKeyForLine={props.equipmentKeyForLine}
          availabilityStatusForLine={props.availabilityStatusForLine}
          availabilityRequestIdForLine={props.availabilityRequestIdForLine}
          availabilityRequestCreatedAtForLine={props.availabilityRequestCreatedAtForLine}
          availabilityRequestLabel={props.availabilityRequestLabel}
          availabilityLabel={props.availabilityLabel}
          liveAvailabilityRequestForLine={props.liveAvailabilityRequestForLine}
          liveAvailabilityStatusForLine={props.liveAvailabilityStatusForLine}
          markAvailabilityConfirmationRequested={props.markAvailabilityConfirmationRequested}
          markAllAvailabilityConfirmationRequested={props.markAllAvailabilityConfirmationRequested}
          availabilityRequestMutationPending={props.availabilityRequestMutationPending}
          sourceRequiredAwaitingConfirmation={props.sourceRequiredAwaitingConfirmation}
          sourceRequiredUnavailable={props.sourceRequiredUnavailable}
          equipmentCanContinue={props.equipmentCanContinue}
        />
      )}

      {step === "configure" && (
        <ConfigureStep
          configureTab={props.configureTab}
          setConfigureTab={props.setConfigureTab}
          availableOptions={props.availableOptions}
          availableOptionsLabel={props.availableOptionsLabel}
          setPackageItemSearchOpen={props.setPackageItemSearchOpen}
          customLineTitle={props.customLineTitle}
          setCustomLineTitle={props.setCustomLineTitle}
          customLinePrice={props.customLinePrice}
          setCustomLinePrice={props.setCustomLinePrice}
          addConfigLine={props.addConfigLine}
        />
      )}

      {step === "tradeIn" && (
        <TradeInStep
          appliedValuationSnapshot={props.appliedValuationSnapshot}
          onPointShootApply={props.onPointShootApply}
          tradeChecklist={props.tradeChecklist}
          tradeCapture={props.tradeCapture}
          tradeManagerApprovalRequired={props.tradeManagerApprovalRequired}
          onOpenTradeCapture={props.onOpenTradeCapture}
        />
      )}

      {step === "pricing" && (
        <PricingStep
          equipmentTotal={props.equipmentTotal}
          attachmentTotal={props.attachmentTotal}
          internalCostLoadTotal={props.internalCostLoadTotal}
          pricingLineTotal={props.pricingLineTotal}
          subtotal={props.subtotal}
          discountTotal={props.discountTotal}
          taxableBasis={props.taxableBasis}
          taxTotal={props.taxTotal}
          customerTotal={props.customerTotal}
          marginPct={props.marginPct}
          dealerCost={props.dealerCost}
          netTotal={props.netTotal}
          marginAmount={props.marginAmount}
          inboundFreightEligible={props.inboundFreightEligible}
          pricingLine={props.pricingLine}
          upsertPricingLine={props.upsertPricingLine}
          discountLine={props.discountLine}
          miscChargeTitle={props.miscChargeTitle}
          setMiscChargeTitle={props.setMiscChargeTitle}
          miscChargeAmount={props.miscChargeAmount}
          setMiscChargeAmount={props.setMiscChargeAmount}
          miscCreditTitle={props.miscCreditTitle}
          setMiscCreditTitle={props.setMiscCreditTitle}
          miscCreditAmount={props.miscCreditAmount}
          setMiscCreditAmount={props.setMiscCreditAmount}
          onAddMiscPricingLine={props.onAddMiscPricingLine}
          taxProfiles={props.taxProfiles}
          taxPreviewData={props.taxPreviewData}
          taxPreviewLoading={props.taxPreviewLoading}
          taxPreviewError={props.taxPreviewError}
          branchStateProvince={props.branchStateProvince}
        />
      )}

      {step === "promotions" && (
        <PromotionsStep activeQuotePackageId={props.activeQuotePackageId} />
      )}

      {step === "financing" && (
        <FinancingStep
          allFinanceScenarios={props.allFinanceScenarios}
          customerTotal={props.customerTotal}
          cashDown={props.cashDown}
          amountFinanced={props.amountFinanced}
          financingPreviewLoading={props.financingPreviewLoading}
          financingPreviewError={props.financingPreviewError}
          leaseQuotingEnabled={props.leaseQuotingEnabled}
        />
      )}

      {step === "details" && (
        <DetailsStep />
      )}

      {step === "review" && (
        <ReviewStep
          branchDisplayName={props.branchDisplayName}
          financeMethodLabel={props.financeMethodLabel}
          availabilityAwaitingCount={props.availabilityAwaitingCount}
          subtotal={props.subtotal}
          discountTotal={props.discountTotal}
          taxableBasis={props.taxableBasis}
          taxTotal={props.taxTotal}
          customerTotal={props.customerTotal}
          cashDown={props.cashDown}
          amountFinanced={props.amountFinanced}
          netTotal={props.netTotal}
          marginPct={props.marginPct}
          dealerCost={props.dealerCost}
          marginAmount={props.marginAmount}
          activeQuotePackageId={props.activeQuotePackageId}
          allFinanceScenarios={props.allFinanceScenarios}
          sendReadiness={props.sendReadiness}
          requiresManagerApproval={props.requiresManagerApproval}
          userRole={props.userRole}
          canSubmitForApproval={props.canSubmitForApproval}
          approvalPending={props.approvalPending}
          approvalGranted={props.approvalGranted}
          bypassApprovedWithoutCase={props.bypassApprovedWithoutCase}
          submitApprovalPending={props.submitApprovalPending}
          onSubmitApproval={props.onSubmitApproval}
          submitApprovalData={props.submitApprovalData}
          quoteStatus={props.quoteStatus}
          onQuoteStatusChange={props.onQuoteStatusChange}
        />
      )}

      {step === "document" && (
        <DocumentStep
          quoteTitle={props.quoteTitle}
          customerTotal={props.customerTotal}
          financeMethodLabel={props.financeMethodLabel}
          documentPersistenceLabel={props.documentPersistenceLabel}
          documentFallbackGeneratedAt={props.documentFallbackGeneratedAt}
          documentArtifact={props.documentArtifact}
          customerFacingDocumentBlocker={props.customerFacingDocumentBlocker}
          pdfGenerating={props.pdfGenerating}
          quoteMediaSnapshotLoading={props.quoteMediaSnapshotLoading}
          documentActionError={props.documentActionError}
          documentReady={props.documentReady}
          onGenerateDocument={props.onGenerateDocument}
        />
      )}

      {step === "send" && (
        <SendStep
          customerFacingDocumentBlocker={props.customerFacingDocumentBlocker}
          approvalCaseCanSend={props.approvalCaseCanSend}
          approvalBlocker={props.approvalBlocker}
          documentReady={props.documentReady}
          documentPersistenceLabel={props.documentPersistenceLabel}
          taxResolved={props.taxResolved}
          taxResolutionBlocker={props.taxResolutionBlocker}
          whyThisMachineRequired={props.whyThisMachineRequired}
          whyThisMachineBlocker={props.whyThisMachineBlocker}
          previewReadiness={props.previewReadiness}
          emailReadiness={props.emailReadiness}
          textReadiness={props.textReadiness}
          textQuoteEnabled={props.textQuoteEnabled}
          deliveryActionBusy={props.deliveryActionBusy}
          pdfGenerating={props.pdfGenerating}
          deliveryActionMessage={props.deliveryActionMessage}
          deliveryActionError={props.deliveryActionError}
          savePending={props.savePending}
          onPreview={props.onPreview}
          onEmail={props.onEmail}
          onText={props.onText}
          onSaveFollowUp={props.onSaveFollowUp}
        />
      )}
    </>
  );
}
