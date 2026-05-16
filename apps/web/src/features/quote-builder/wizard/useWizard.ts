// QRM Quote Wizard — hook that reads `WizardStateContext`.
//
// Introduced as PR 4 of the IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
// Throws when used outside `<WizardStateProvider>` so future per-step
// components fail fast in dev rather than silently rendering with stale
// or undefined state.

import { useContext } from "react";

import { WizardStateContext, type WizardStateValue } from "./WizardStateProvider";

export function useWizard(): WizardStateValue {
  const ctx = useContext(WizardStateContext);
  if (ctx === null) {
    throw new Error(
      "useWizard must be used within a <WizardStateProvider>. " +
      "Wrap the consuming tree in QuoteBuilderV2Page or its descendant providers.",
    );
  }
  return ctx;
}
