/**
 * Post–PR 21 orchestrator slimming: sticky bar primary CTA routing.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useCallback } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import type { Step } from "../wizard/wizard-types";

export interface UseQuoteBuilderPrimaryActionInput {
  quoteStatus: QuoteWorkspaceDraft["quoteStatus"];
  currentStep: Step;
  approvalCaseCanSend: boolean;
  sendReady: boolean;
  canSubmitForApproval: boolean;
  requiresApprovalJustification: boolean;
  onSave: () => void | Promise<void>;
  onSubmitApproval: () => void;
  setStep: (step: Step) => void;
}

export function useQuoteBuilderPrimaryAction({
  quoteStatus,
  currentStep,
  approvalCaseCanSend,
  sendReady,
  canSubmitForApproval,
  requiresApprovalJustification,
  onSave,
  onSubmitApproval,
  setStep,
}: UseQuoteBuilderPrimaryActionInput): () => void {
  return useCallback(() => {
    if (quoteStatus === "sent" || quoteStatus === "accepted") {
      void onSave();
      return;
    }
    if (approvalCaseCanSend && sendReady) {
      setStep("review");
      return;
    }
    if (canSubmitForApproval) {
      if (requiresApprovalJustification || currentStep !== "review") {
        setStep("review");
        return;
      }
      onSubmitApproval();
      return;
    }
    void onSave();
  }, [
    approvalCaseCanSend,
    canSubmitForApproval,
    currentStep,
    onSave,
    onSubmitApproval,
    quoteStatus,
    requiresApprovalJustification,
    sendReady,
    setStep,
  ]);
}
