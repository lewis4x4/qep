import type { ComponentType } from "react";
import type { CustomerStepProps } from "../steps/CustomerStep";
import type { WizardStateValue } from "../wizard/WizardStateProvider";
import type { QuoteWizardStepRouterProps } from "../wizard/QuoteWizardStepRouter";
import type { QuoteBuilderV2PageShellProps } from "./QuoteBuilderV2PageShell";

export interface QuoteBuilderV2PageViewProps {
  wizardStateValue: WizardStateValue;
  shellProps: Omit<QuoteBuilderV2PageShellProps, "wizardStepRouter">;
  stepRouterProps: QuoteWizardStepRouterProps;
}

export interface QuoteBuilderV2PageViewHostProps extends QuoteBuilderV2PageViewProps {
  customerStepComponent: ComponentType<CustomerStepProps>;
}
