// QRM Quote Wizard — pure navigation helpers.
//
// Extracted from `QuoteBuilderV2Page.tsx` as PR 3 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence.
// All functions are pure — no React state, no side effects, fully unit
// testable in isolation. Step-specific business gates (hasCustomer,
// equipmentCanContinue, documentReady, etc.) stay in the page.

import { WIZARD_STEPS, type Step } from "./wizard-types";

/**
 * The Step that comes before `currentStepNumber` (1-based) in `WIZARD_STEPS`,
 * or `null` when there is no previous step.
 */
export function previousWizardStep(currentStepNumber: number): Step | null {
  return WIZARD_STEPS[currentStepNumber - 2]?.id ?? null;
}

/**
 * The Step that comes after `currentStepNumber` (1-based) in `WIZARD_STEPS`,
 * or `null` when there is no next step.
 */
export function nextWizardStep(currentStepNumber: number): Step | null {
  return WIZARD_STEPS[currentStepNumber]?.id ?? null;
}

/**
 * The 0-based position of `step` in `WIZARD_STEPS`, or `-1` if it is not a
 * recognized step id. Use this when you need the absolute index for jump-back
 * math (the `wizardIndexForStep` helper in `wizard-types` is 1-based and
 * step-number-oriented; this returns the raw array index).
 */
export function findWizardStepIndex(step: Step): number {
  return WIZARD_STEPS.findIndex((item) => item.id === step);
}

/**
 * The 0-based "max completed" index derived from `draft.wizardStep` (1-based
 * persisted progress). `wizardStep` of 1 → 0; null/undefined → 0.
 */
export function wizardMaxStepIndex0FromDraft(draftWizardStep: number | null | undefined): number {
  return Math.max(0, (draftWizardStep ?? 1) - 1);
}

/**
 * The 0-based reachable upper bound — the largest pill index a rep can click
 * given (a) the previously-completed progress and (b) where they're currently
 * standing. Clamped to the array length.
 */
export function wizardReachableMaxIndex0(
  maxStepIndex0: number,
  currentIndex0: number,
  totalSteps: number = WIZARD_STEPS.length,
): number {
  return Math.min(
    Math.max(maxStepIndex0, currentIndex0 >= 0 ? currentIndex0 : 0),
    totalSteps - 1,
  );
}

/**
 * `true` when `targetIndex0` is within reach given `reachableMaxIndex0`.
 * Used by both the step-pill nav (WizardProgress) and the page-level
 * "jump to pricing" affordance.
 */
export function canJumpToWizardIndex(targetIndex0: number, reachableMaxIndex0: number): boolean {
  return targetIndex0 >= 0 && targetIndex0 <= reachableMaxIndex0;
}
