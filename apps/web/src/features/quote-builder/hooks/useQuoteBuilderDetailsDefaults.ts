/**
 * Post–PR 21 orchestrator slimming: seed details/send step defaults once.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";

import { addDaysIso } from "../lib/quote-builder-page-helpers";
import type { Step } from "../wizard/wizard-types";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderDetailsDefaultsInput {
  step: Step;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
}

export function useQuoteBuilderDetailsDefaults({
  step,
  setDraft,
}: UseQuoteBuilderDetailsDefaultsInput): void {
  useEffect(() => {
    if (step !== "details" && step !== "send") return;
    setDraft((current) => ({
      ...current,
      expiresAt: current.expiresAt ?? addDaysIso(30),
      followUpAt: current.followUpAt ?? addDaysIso(3),
      whyThisMachine: current.whyThisMachine
        ?? current.recommendation?.reasoning
        ?? current.voiceSummary
        ?? "",
      whyThisMachineConfirmed: current.whyThisMachineConfirmed ?? false,
    }));
  }, [setDraft, step]);
}
