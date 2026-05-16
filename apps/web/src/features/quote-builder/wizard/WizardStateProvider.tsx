// QRM Quote Wizard — context provider for shared step state.
//
// Introduced as PR 4 of the IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15
// strangler-fig sequence. This is the structural enabler that lets future
// step extractions (PRs 10–20) reach `draft`, `setDraft`, `setStep`, and
// the wizard derivations through a hook instead of threading 15+ props.
//
// The provider itself is a thin shell: state still lives in the page; the
// page builds a memoized `WizardStateValue` and passes it in. Behavior is
// unchanged in PR 4 — no consumer reads from the context yet.

import { createContext, type ReactNode } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

import type { AutoSaveState, Step } from "./wizard-types";

export interface WizardStateValue {
  step: Step;
  setStep: Dispatch<SetStateAction<Step>>;

  /** The Step that comes before the current step, or `null` at step 1. */
  previousWizardStep: Step | null;
  /** The Step that comes after the current step, or `null` at step 11. */
  nextWizardStep: Step | null;
  /** 1-based step number for the current step (1 → "customer"). */
  currentWizardStepNumber: number;
  /** 0-based highest step the rep has previously completed (from `draft.wizardStep`). */
  maxCompletedStepIndex: number;
  /** 0-based reachable upper bound (max(maxCompleted, currentIndex), clamped to last step). */
  reachableMaxStepIndex: number;

  draft: QuoteWorkspaceDraft;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;

  activeWorkspaceId: string | null;
  activeQuotePackageId: string | null;

  autoSaveState: AutoSaveState;
  setAutoSaveState: Dispatch<SetStateAction<AutoSaveState>>;
  lastSavedAt: string | null;
  setLastSavedAt: Dispatch<SetStateAction<string | null>>;
}

export const WizardStateContext = createContext<WizardStateValue | null>(null);

export interface WizardStateProviderProps {
  value: WizardStateValue;
  children: ReactNode;
}

export function WizardStateProvider({ value, children }: WizardStateProviderProps) {
  return (
    <WizardStateContext.Provider value={value}>
      {children}
    </WizardStateContext.Provider>
  );
}
