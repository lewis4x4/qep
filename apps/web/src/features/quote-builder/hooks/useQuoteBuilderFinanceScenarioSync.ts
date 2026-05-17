/**
 * Post–PR 21 orchestrator slimming: keep selectedFinanceScenario in sync with previews.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";

import type {
  QuoteFinanceScenario,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderFinanceScenarioSyncInput {
  allFinanceScenarios: QuoteFinanceScenario[];
  customFinanceScenario: QuoteFinanceScenario | null;
  selectedFinanceScenario: string | null | undefined;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
}

export function useQuoteBuilderFinanceScenarioSync({
  allFinanceScenarios,
  customFinanceScenario,
  selectedFinanceScenario,
  setDraft,
}: UseQuoteBuilderFinanceScenarioSyncInput): void {
  useEffect(() => {
    if (allFinanceScenarios.length === 0) {
      setDraft((current) => current.selectedFinanceScenario == null
        ? current
        : { ...current, selectedFinanceScenario: null });
      return;
    }
    const hasSelected = allFinanceScenarios.some((scenario) => scenario.label === selectedFinanceScenario);
    if (customFinanceScenario) {
      if (selectedFinanceScenario == null || selectedFinanceScenario === "Cash" || !hasSelected) {
        setDraft((current) => ({ ...current, selectedFinanceScenario: customFinanceScenario.label }));
      }
      return;
    }
    if (hasSelected) return;
    setDraft((current) => ({ ...current, selectedFinanceScenario: allFinanceScenarios[0]!.label }));
  }, [allFinanceScenarios, customFinanceScenario, selectedFinanceScenario, setDraft]);
}
