/**
 * Post–PR 21 orchestrator slimming: sticky bar primary CTA routing.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useCallback } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import type { Step } from "../wizard/wizard-types";

export interface UseQuoteBuilderPrimaryActionInput {
  quoteStatus: QuoteWorkspaceDraft["quoteStatus"];
  approvalCaseCanSend: boolean;
  sendReady: boolean;
  canSubmitForApproval: boolean;
  onSave: () => void | Promise<void>;
  onSubmitApproval: () => void;
  setStep: (step: Step) => void;
}

export function useQuoteBuilderPrimaryAction({
  quoteStatus,
  approvalCaseCanSend,
  sendReady,
  canSubmitForApproval,
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
      setStep("document");
      return;
    }
    if (canSubmitForApproval) {
      onSubmitApproval();
      return;
    }
    void onSave();
  }, [
    approvalCaseCanSend,
    canSubmitForApproval,
    onSave,
    onSubmitApproval,
    quoteStatus,
    sendReady,
    setStep,
  ]);
}
