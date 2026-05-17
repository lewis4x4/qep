import { WizardStateProvider } from "../wizard/WizardStateProvider";
import { QuoteWizardStepRouter } from "../wizard/QuoteWizardStepRouter";
import { QuoteBuilderV2PageShell } from "./QuoteBuilderV2PageShell";
import type { QuoteBuilderV2PageViewProps } from "./QuoteBuilderV2PageView.types";

export function QuoteBuilderV2PageView({
  wizardStateValue,
  shellProps,
  stepRouterProps,
}: QuoteBuilderV2PageViewProps) {
  return (
    <WizardStateProvider value={wizardStateValue}>
      <QuoteBuilderV2PageShell
        {...shellProps}
        wizardStepRouter={<QuoteWizardStepRouter {...stepRouterProps} />}
      />
    </WizardStateProvider>
  );
}
