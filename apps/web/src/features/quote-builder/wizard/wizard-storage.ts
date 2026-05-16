// QRM Quote Wizard — session-storage persistence for the current step.
//
// Extracted from `QuoteBuilderV2Page.tsx` as PR 1 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence.
// SSR-safe (guards on `typeof window`).

import { isWizardStepId, type Step } from "./wizard-types";

export const STEP_STORAGE_PREFIX = "qep.quote-builder.last-step.";

export function readPersistedStep(quotePackageId: string | null): Step | null {
  if (!quotePackageId || typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(`${STEP_STORAGE_PREFIX}${quotePackageId}`);
  return isWizardStepId(raw) ? raw : null;
}

export function persistStep(quotePackageId: string | null, step: Step): void {
  if (!quotePackageId || typeof window === "undefined") return;
  window.sessionStorage.setItem(`${STEP_STORAGE_PREFIX}${quotePackageId}`, step);
}
