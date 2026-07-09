import { __setSentrySdk } from "@/lib/sentry-lazy";

let instrumentationScheduled = false;

function scheduleAfterFirstPaint(callback: () => void) {
  if (typeof window === "undefined") {
    callback();
    return;
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
  };

  window.requestAnimationFrame(() => {
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(callback, { timeout: 2500 });
      return;
    }
    window.setTimeout(callback, 0);
  });
}

export function scheduleInstrumentation() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (instrumentationScheduled || typeof dsn !== "string" || dsn.length === 0) {
    return;
  }

  instrumentationScheduled = true;
  scheduleAfterFirstPaint(() => {
    void installInstrumentation(dsn);
  });
}

async function installInstrumentation(dsn: string) {
  try {
    // react and react-router-dom live in the eager entry chunk, so these
    // two resolve instantly with no extra fetch. Known cost: needing
    // matchRoutes/createRoutesFromChildren here retains ~63KB of router
    // internals (@remix-run/router matching engine) in the entry chunk
    // that DSN-less builds tree-shake away — measured 2026-07-09 via
    // sourcemap diff; neither destructure form shakes it. That is the
    // price of route-named tracing, not of the Sentry SDK (which stays
    // in the lazy vendor-sentry chunk).
    const { useEffect } = await import("react");
    const { useLocation, useNavigationType, matchRoutes, createRoutesFromChildren } =
      await import("react-router-dom");
    const [Sentry, { installSalesWebVitals }] = await Promise.all([
      import("@sentry/react"),
      import("@/features/sales/lib/web-vitals-reporter"),
    ]);

    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: `${import.meta.env.VITE_APP_VERSION ?? "0.0.0"}+${import.meta.env.VITE_GIT_SHA ?? "local"}`,
      integrations: [
        Sentry.reactRouterV6BrowserTracingIntegration({
          useEffect,
          useLocation,
          useNavigationType,
          matchRoutes,
          createRoutesFromChildren,
        }),
      ],
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    });

    // Hand the SDK to the lazy facade: flushes errors buffered before
    // first paint and wakes onSentryReady subscribers (Iron avatar).
    __setSentrySdk(Sentry);

    // Emit CLS / INP / LCP / FCP / TTFB samples from real rep phones
    // into Sentry as distribution metrics. Keep Session Replay off the
    // LCP path; error capture and web-vitals metrics remain enabled.
    installSalesWebVitals((metric) => {
      Sentry.metrics.distribution(
        `web_vitals.${metric.name.toLowerCase()}`,
        metric.value,
        {
          attributes: {
            route_prefix: "sales",
            navigation_type: metric.navigationType ?? "unknown",
          },
          unit: metric.name === "CLS" ? "none" : "millisecond",
        },
      );
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Sentry instrumentation failed to load", error);
    }
  }
}
