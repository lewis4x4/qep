import { lazy, Suspense } from "react";
import { useIsHandheldViewport } from "@/features/sales/hooks/useIsHandheldViewport";
import type { QuoteBuilderV2PageViewProps } from "./QuoteBuilderV2PageView.types";

const QuoteBuilderDesktopViewHost = lazy(() =>
  import("./QuoteBuilderDesktopViewHost").then((module) => ({
    default: module.QuoteBuilderDesktopViewHost,
  })),
);

const QuoteBuilderMobileViewHost = lazy(() =>
  import("./QuoteBuilderMobileViewHost").then((module) => ({
    default: module.QuoteBuilderMobileViewHost,
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
