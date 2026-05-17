/**
 * WAVE CI / Quality — Slice 5: real-user web-vitals reporting on
 * the /sales/* rep surface.
 *
 * Sentry already runs in prod (see apps/web/src/instrument.ts). This
 * module wires the web-vitals library so we collect CLS / INP / LCP /
 * FCP / TTFB samples from real rep phones and emit them to Sentry as
 * distribution metrics tagged `route_prefix=sales`. The Slice 1
 * Lighthouse synthetic baseline tells us the ceiling; this gives us
 * the field reality.
 *
 * Scoped exclusively to /sales/* paths — non-sales routes are still
 * measured by the underlying library (you can't get a per-route lock
 * out of web-vitals' singleton API) but the reporter callback drops
 * the metric on the floor when window.location.pathname doesn't
 * start with "/sales/".
 *
 * Idempotent: calling installSalesWebVitals more than once is a
 * no-op so React Strict Mode / hot-reload double-mounts don't
 * double-subscribe.
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

export type SalesWebVitalsReporter = (metric: Metric) => void;

let installed = false;

/**
 * Test seam — call from a unit test to reset the install latch.
 * Production code should never call this.
 */
export function resetSalesWebVitalsForTests(): void {
  installed = false;
}

export function isSalesRoute(pathname: string): boolean {
  return pathname.startsWith("/sales/");
}

export function installSalesWebVitals(
  reporter: SalesWebVitalsReporter,
  options: {
    /** Override for tests — defaults to window.location.pathname. */
    getPathname?: () => string;
  } = {},
): void {
  if (installed) return;
  installed = true;

  const getPathname =
    options.getPathname ??
    (() => (typeof window === "undefined" ? "" : window.location.pathname));

  const guarded: SalesWebVitalsReporter = (metric) => {
    if (!isSalesRoute(getPathname())) return;
    reporter(metric);
  };

  onCLS(guarded);
  onINP(guarded);
  onLCP(guarded);
  onFCP(guarded);
  onTTFB(guarded);
}
