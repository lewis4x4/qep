import { lazy, Suspense } from "react";
import { useIsHandheldViewport } from "@/features/sales/hooks/useIsHandheldViewport";
import type { QuoteBuilderV2PageViewProps } from "./QuoteBuilderV2PageView.types";

const QuoteBuilderDesktopViewHost = lazy(() =>
  Promise.all([
    import("./QuoteBuilderDesktopViewHost"),
    import("../steps/CustomerStep"),
  ]).then(([hostModule, customerStepModule]) => ({
    default: function QuoteBuilderDesktopViewHostWithInitialStep(
      props: QuoteBuilderV2PageViewProps,
    ) {
      return (
        <hostModule.QuoteBuilderDesktopViewHost
          {...props}
          customerStepComponent={customerStepModule.CustomerStep}
        />
      );
    },
  })),
);

const QuoteBuilderMobileViewHost = lazy(() =>
  Promise.all([
    import("./QuoteBuilderMobileViewHost"),
    import("../steps/CustomerStep"),
  ]).then(([hostModule, customerStepModule]) => ({
    default: function QuoteBuilderMobileViewHostWithInitialStep(
      props: QuoteBuilderV2PageViewProps,
    ) {
      return (
        <hostModule.QuoteBuilderMobileViewHost
          {...props}
          customerStepComponent={customerStepModule.CustomerStep}
        />
      );
    },
  })),
);

function QuoteBuilderShellLoading() {
  return (
    <div
      role="status"
      aria-label="Loading Quote Builder workspace"
      className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4 sm:px-6 lg:px-8"
    >
      <div className="h-16 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.035] motion-reduce:animate-none" />
      <div className="h-48 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.025] motion-reduce:animate-none" />
      <span className="sr-only">Loading Quote Builder workspace…</span>
    </div>
  );
}

export function QuoteBuilderV2PageView(props: QuoteBuilderV2PageViewProps) {
  const isHandheld = useIsHandheldViewport();
  const Host = isHandheld
    ? QuoteBuilderMobileViewHost
    : QuoteBuilderDesktopViewHost;

  return (
    <Suspense fallback={<QuoteBuilderShellLoading />}>
      <Host {...props} />
    </Suspense>
  );
}
