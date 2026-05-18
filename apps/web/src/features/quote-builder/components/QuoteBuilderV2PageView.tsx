import { WizardStateProvider } from "../wizard/WizardStateProvider";
import { QuoteWizardStepRouter } from "../wizard/QuoteWizardStepRouter";
import { QuoteBuilderV2PageShell } from "./QuoteBuilderV2PageShell";
import { QuoteBuilderV2PageMobileShell } from "./QuoteBuilderV2PageMobileShell";
import { useIsHandheldViewport } from "@/features/sales/hooks/useIsHandheldViewport";
import type { QuoteBuilderV2PageViewProps } from "./QuoteBuilderV2PageView.types";

export function QuoteBuilderV2PageView({
  wizardStateValue,
  shellProps,
  stepRouterProps,
}: QuoteBuilderV2PageViewProps) {
  const isHandheld = useIsHandheldViewport();
  const Shell = isHandheld ? QuoteBuilderV2PageMobileShell : QuoteBuilderV2PageShell;
  return (
    <WizardStateProvider value={wizardStateValue}>
      <Shell
        {...shellProps}
        wizardStepRouter={<QuoteWizardStepRouter {...stepRouterProps} />}
      />
    </WizardStateProvider>
  );
}
