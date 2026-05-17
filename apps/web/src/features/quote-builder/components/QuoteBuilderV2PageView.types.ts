import type { ReactNode } from "react";
import type { WizardStateValue } from "../wizard/WizardStateProvider";
import type { QuoteWizardStepRouterProps } from "../wizard/QuoteWizardStepRouter";
import type { QuoteBuilderV2PageShellProps } from "./QuoteBuilderV2PageShell";

export interface QuoteBuilderV2PageViewProps {
  wizardStateValue: WizardStateValue;
  shellProps: Omit<QuoteBuilderV2PageShellProps, "wizardStepRouter">;
  stepRouterProps: QuoteWizardStepRouterProps;
}
