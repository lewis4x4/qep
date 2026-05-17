/**
 * Post–PR 21 orchestrator slimming: persist wizard step + max wizardStep on draft.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";

import { persistStep } from "../wizard/wizard-storage";
import type { Step } from "../wizard/wizard-types";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderWizardPersistInput {
  activeQuotePackageId: string | null;
  step: Step;
  currentWizardStepNumber: number;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
}

export function useQuoteBuilderWizardPersist({
  activeQuotePackageId,
  step,
  currentWizardStepNumber,
  setDraft,
}: UseQuoteBuilderWizardPersistInput): void {
  useEffect(() => {
    persistStep(activeQuotePackageId, step);
    setDraft((current) => current.wizardStep === Math.max(current.wizardStep ?? 1, currentWizardStepNumber)
      ? current
      : { ...current, wizardStep: Math.max(current.wizardStep ?? 1, currentWizardStepNumber) });
  }, [activeQuotePackageId, currentWizardStepNumber, setDraft, step]);
}
