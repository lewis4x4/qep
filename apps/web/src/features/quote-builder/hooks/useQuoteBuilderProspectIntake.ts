/**
 * Post–PR 21 orchestrator slimming: walk-in prospect quick-fill from wizard shell.
 * Mechanical move from `useQuoteBuilderWizardChrome.ts`.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import type { Step } from "../wizard/wizard-types";

export interface UseQuoteBuilderProspectIntakeInput {
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  setStep: (step: Step) => void;
}

export function useQuoteBuilderProspectIntake({
  setDraft,
  setStep,
}: UseQuoteBuilderProspectIntakeInput): () => void {
  return useCallback(() => {
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
}
