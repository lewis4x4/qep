import * as React from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import * as Sentry from "@sentry/react";
// WAVE CI / Quality (Slice 5): real-user web-vitals for /sales/* routes.
import { installSalesWebVitals } from "@/features/sales/lib/web-vitals-reporter";

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (typeof dsn === "string" && dsn.length > 0) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: `${import.meta.env.VITE_APP_VERSION ?? "0.0.0"}+${import.meta.env.VITE_GIT_SHA ?? "local"}`,
    integrations: [
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect: React.useEffect,
        useLocation,
        useNavigationType,
        matchRoutes,
        createRoutesFromChildren,
      }),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,
  });

  // Emit CLS / INP / LCP / FCP / TTFB samples from real rep phones
  // into Sentry as distribution metrics. v10 uses `attributes` (the v7
  // name was `tags`) — the dashboard can split web_vitals.* by
  // route_prefix + navigation_type using those attributes. Only
  // /sales/* routes — non-sales surfaces are dropped by the
  // reporter's pathname guard.
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
}
