import { QuoteBuilderV2PageShell } from "./QuoteBuilderV2PageShell";
import type { QuoteBuilderV2PageViewHostProps } from "./QuoteBuilderV2PageView.types";
import { QuoteWizardStepRouter } from "../wizard/QuoteWizardStepRouter";
import { WizardStateProvider } from "../wizard/WizardStateProvider";

export function QuoteBuilderDesktopViewHost({
  wizardStateValue,
  shellProps,
  stepRouterProps,
  customerStepComponent,
}: QuoteBuilderV2PageViewHostProps) {
  return (
    <WizardStateProvider value={wizardStateValue}>
      <QuoteBuilderV2PageShell
        {...shellProps}
        wizardStepRouter={(
          <QuoteWizardStepRouter
            {...stepRouterProps}
            customerStepComponent={customerStepComponent}
          />
        )}
      />
    </WizardStateProvider>
  );
}
