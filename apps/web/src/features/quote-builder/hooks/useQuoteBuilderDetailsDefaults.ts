/**
 * Post–PR 21 orchestrator slimming: seed details/send step defaults once.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";

import { buildQuoteLifecycleDefaultDates } from "../lib/quote-lifecycle-policy";
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
    const defaults = buildQuoteLifecycleDefaultDates();
    setDraft((current) => ({
      ...current,
      expiresAt: current.expiresAt ?? defaults.expiresAt,
      followUpAt: current.followUpAt ?? defaults.followUpAt,
      whyThisMachine: current.whyThisMachine
        ?? current.recommendation?.reasoning
        ?? current.voiceSummary
        ?? "",
      whyThisMachineConfirmed: current.whyThisMachineConfirmed ?? false,
    }));
  }, [setDraft, step]);
}
