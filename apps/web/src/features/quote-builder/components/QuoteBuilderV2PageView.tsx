import { WizardStateProvider } from "../wizard/WizardStateProvider";
import { QuoteWizardStepRouter } from "../wizard/QuoteWizardStepRouter";
import { QuoteBuilderV2PageShell } from "./QuoteBuilderV2PageShell";
import { QuoteBuilderV2PageMobileShell } from "./QuoteBuilderV2PageMobileShell";
import { useIsMobileViewport } from "@/features/sales/hooks/useIsMobileViewport";
import type { QuoteBuilderV2PageViewProps } from "./QuoteBuilderV2PageView.types";

export function QuoteBuilderV2PageView({
  wizardStateValue,
  shellProps,
  stepRouterProps,
}: QuoteBuilderV2PageViewProps) {
  const isMobile = useIsMobileViewport();
  const Shell = isMobile ? QuoteBuilderV2PageMobileShell : QuoteBuilderV2PageShell;
  return (
    <WizardStateProvider value={wizardStateValue}>
      <Shell
        {...shellProps}
        wizardStepRouter={<QuoteWizardStepRouter {...stepRouterProps} />}
      />
    </WizardStateProvider>
  );
}
