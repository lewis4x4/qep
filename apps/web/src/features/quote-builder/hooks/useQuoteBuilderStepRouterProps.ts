/**
 * Post–PR 21 orchestrator slimming: memoized QuoteWizardStepRouter prop bundle.
 */

import { useMemo } from "react";

import {
  buildQuoteWizardStepRouterProps,
  type QuoteBuilderStepRouterGroups,
} from "../lib/build-quote-wizard-step-router-props";
import type { QuoteWizardStepRouterProps } from "../wizard/QuoteWizardStepRouter";

export function useQuoteBuilderStepRouterProps(
  groups: QuoteBuilderStepRouterGroups,
): QuoteWizardStepRouterProps {
  return useMemo(
    () => buildQuoteWizardStepRouterProps(groups),
    [
      groups.intake,
      groups.intelligence,
      groups.catalog,
      groups.availability,
      groups.trade,
      groups.totals,
      groups.pricing,
      groups.taxFinance,
      groups.approval,
      groups.documentSend,
    ],
  );
}
