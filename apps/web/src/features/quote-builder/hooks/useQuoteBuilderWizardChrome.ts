/**
 * Post–PR 21 orchestrator slimming: wizard navigation, sticky CTA labels, send readiness.
 */

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import {
  computeQuoteSendActionReadiness,
  type QuoteSendActionChannel,
} from "../lib/quote-workspace";
import {
  canJumpToWizardIndex,
  findWizardStepIndex,
  nextWizardStep as resolveNextWizardStep,
  previousWizardStep as resolvePreviousWizardStep,
  wizardMaxStepIndex0FromDraft,
  wizardReachableMaxIndex0,
} from "../wizard/wizard-navigation";
import { STEP_LABELS, wizardIndexForStep, type AutoSaveState, type Step } from "../wizard/wizard-types";
import type { WizardStateValue } from "../wizard/WizardStateProvider";

export interface UseQuoteBuilderWizardChromeInput {
  step: Step;
  setStep: Dispatch<SetStateAction<Step>>;
  draft: QuoteWorkspaceDraft;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  activeWorkspaceId: string | null;
  activeQuotePackageId: string | null;
  autoSaveState: AutoSaveState;
  setAutoSaveState: Dispatch<SetStateAction<AutoSaveState>>;
  lastSavedAt: string | null;
  setLastSavedAt: Dispatch<SetStateAction<string | null>>;
  hasCustomer: boolean;
  equipmentCanContinue: boolean;
  documentReady: boolean;
  signalsReady: boolean;
  marginPct: number;
  marginAmount: number;
  quoteStatus: QuoteWorkspaceDraft["quoteStatus"];
  savePending: boolean;
  submitApprovalPending: boolean;
  approvalCaseCanSend: boolean;
  sendReady: boolean;
  canSubmitForApproval: boolean;
  draftReady: boolean;
  taxResolved: boolean;
  whyThisMachineRequired: boolean;
  whyThisMachineConfirmed: boolean;
  textQuoteEnabled: boolean;
}

export function useQuoteBuilderWizardChrome({
  step,
  setStep,
  draft,
  setDraft,
  activeWorkspaceId,
  activeQuotePackageId,
  autoSaveState,
  setAutoSaveState,
  lastSavedAt,
  setLastSavedAt,
  hasCustomer,
  equipmentCanContinue,
  documentReady,
  signalsReady,
  marginPct,
  marginAmount,
  quoteStatus,
  savePending,
  submitApprovalPending,
  approvalCaseCanSend,
  sendReady,
  canSubmitForApproval,
  draftReady,
  taxResolved,
  whyThisMachineRequired,
  whyThisMachineConfirmed,
  textQuoteEnabled,
}: UseQuoteBuilderWizardChromeInput) {
  const currentWizardStepNumber = wizardIndexForStep(step);
  const previousWizardStep = resolvePreviousWizardStep(currentWizardStepNumber);
  const nextWizardStep = resolveNextWizardStep(currentWizardStepNumber);
  const nextWizardLabel = nextWizardStep ? STEP_LABELS[nextWizardStep] : null;

  const wizardNextDisabled =
    !nextWizardStep
    || (step === "customer" && !hasCustomer)
    || (step === "equipment" && !equipmentCanContinue)
    || (step === "document" && !documentReady);

  const wizardNextHelp = step === "customer" && !hasCustomer
    ? "Pick a customer or use Quote for prospect first."
    : step === "equipment" && !equipmentCanContinue
      ? "Select equipment and resolve source-required availability first."
      : step === "document" && !documentReady
        ? "Generate the document preview before send/log."
        : "Completed steps stay editable — click any finished step below to jump back.";

  const pricingWizardIndex = findWizardStepIndex("pricing");
  const wizardMaxStepIndex0 = wizardMaxStepIndex0FromDraft(draft.wizardStep);
  const wizardCurrentIndex0 = findWizardStepIndex(step);
  const wizardReachableMaxIndex0Value = wizardReachableMaxIndex0(wizardMaxStepIndex0, wizardCurrentIndex0);
  const wizardPricingJumpAllowed =
    signalsReady
    && canJumpToWizardIndex(pricingWizardIndex, wizardReachableMaxIndex0Value)
    && step !== "pricing";

  const handleQuoteForProspect = useCallback(() => {
    setDraft((cur) => ({
      ...cur,
      customerName: cur.customerName || "Walk-in prospect",
      customerCompany: cur.customerCompany || "Walk-in prospect",
      contactId: undefined,
      companyId: undefined,
      customerSignals: null,
      customerWarmth: cur.customerWarmth ?? "new",
    }));
    setStep("equipment");
  }, [setDraft, setStep]);

  const primaryActionLabel =
    savePending || submitApprovalPending
      ? "Working..."
      : quoteStatus === "sent" || quoteStatus === "accepted"
        ? "Update"
        : approvalCaseCanSend && sendReady
          ? "Review & Send"
          : canSubmitForApproval
            ? "Submit Approval"
            : "Save Draft";

  const primaryActionDisabled =
    savePending
    || submitApprovalPending
    || (!draftReady && primaryActionLabel !== "Review & Send");

  const buildSendReadiness = useCallback((channel: QuoteSendActionChannel) =>
    computeQuoteSendActionReadiness({
      channel,
      quotePackageId: activeQuotePackageId,
      approvalCaseCanSend,
      followUpAt: draft.followUpAt ?? null,
      documentReady,
      taxResolved,
      whyThisMachineRequired,
      whyThisMachineConfirmed,
      ...(channel === "email" ? { customerEmail: draft.customerEmail ?? null } : {}),
      ...(channel === "text" ? { customerPhone: draft.customerPhone ?? null } : {}),
    }), [
    activeQuotePackageId,
    approvalCaseCanSend,
    documentReady,
    draft.customerEmail,
    draft.customerPhone,
    draft.followUpAt,
    taxResolved,
    whyThisMachineConfirmed,
    whyThisMachineRequired,
  ]);

  const previewReadiness = useMemo(() => buildSendReadiness("preview"), [buildSendReadiness]);
  const emailReadiness = useMemo(() => buildSendReadiness("email"), [buildSendReadiness]);
  const textReadiness = useMemo(() => buildSendReadiness("text"), [buildSendReadiness]);

  const wizardStateValue = useMemo<WizardStateValue>(() => ({
    step,
    setStep,
    previousWizardStep,
    nextWizardStep,
    currentWizardStepNumber,
    maxCompletedStepIndex: wizardMaxStepIndex0,
    reachableMaxStepIndex: wizardReachableMaxIndex0Value,
    draft,
    setDraft,
    activeWorkspaceId,
    activeQuotePackageId,
    autoSaveState,
    setAutoSaveState,
    lastSavedAt,
    setLastSavedAt,
  }), [
    step,
    setStep,
    previousWizardStep,
    nextWizardStep,
    currentWizardStepNumber,
    wizardMaxStepIndex0,
    wizardReachableMaxIndex0Value,
    draft,
    setDraft,
    activeWorkspaceId,
    activeQuotePackageId,
    autoSaveState,
    setAutoSaveState,
    lastSavedAt,
    setLastSavedAt,
  ]);

  return {
    currentWizardStepNumber,
    previousWizardStep,
    nextWizardStep,
    nextWizardLabel,
    wizardNextDisabled,
    wizardNextHelp,
    wizardMaxStepIndex0,
    wizardReachableMaxIndex0Value,
    wizardPricingJumpAllowed,
    handleQuoteForProspect,
    primaryActionLabel,
    primaryActionDisabled,
    previewReadiness,
    emailReadiness,
    textReadiness,
    textQuoteEnabled,
    wizardStateValue,
  };
}
