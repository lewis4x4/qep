import { QuoteBuilderV2PageMobileShell } from "./QuoteBuilderV2PageMobileShell";
import type { QuoteBuilderV2PageViewProps } from "./QuoteBuilderV2PageView.types";
import { QuoteWizardStepRouter } from "../wizard/QuoteWizardStepRouter";
import { WizardStateProvider } from "../wizard/WizardStateProvider";

export function QuoteBuilderMobileViewHost({
  wizardStateValue,
  shellProps,
  stepRouterProps,
}: QuoteBuilderV2PageViewProps) {
  return (
    <WizardStateProvider value={wizardStateValue}>
      <QuoteBuilderV2PageMobileShell
        {...shellProps}
        wizardStepRouter={<QuoteWizardStepRouter {...stepRouterProps} />}
      />
    </WizardStateProvider>
  );
}
