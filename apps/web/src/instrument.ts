import * as React from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import * as Sentry from "@sentry/react";

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
}
