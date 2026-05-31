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
    const [React, Router, Sentry, WebVitals] = await Promise.all([
      import("react"),
      import("react-router-dom"),
      import("@sentry/react"),
      import("@/features/sales/lib/web-vitals-reporter"),
    ]);

    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: `${import.meta.env.VITE_APP_VERSION ?? "0.0.0"}+${import.meta.env.VITE_GIT_SHA ?? "local"}`,
      integrations: [
        Sentry.reactRouterV6BrowserTracingIntegration({
          useEffect: React.useEffect,
          useLocation: Router.useLocation,
          useNavigationType: Router.useNavigationType,
          matchRoutes: Router.matchRoutes,
          createRoutesFromChildren: Router.createRoutesFromChildren,
        }),
      ],
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    });

    // Emit CLS / INP / LCP / FCP / TTFB samples from real rep phones
    // into Sentry as distribution metrics. Keep Session Replay off the
    // LCP path; error capture and web-vitals metrics remain enabled.
    WebVitals.installSalesWebVitals((metric) => {
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
