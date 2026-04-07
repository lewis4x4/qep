/**
 * Wave 6.11 Flare Phase I — Web Vitals collection via PerformanceObserver.
 *
 * Subscribes to LCP / FID / CLS performance entries and exposes the
 * latest values to captureContext. Replaces the placeholder nulls in
 * the Phase B captureContext.collectPerformanceMetrics function.
 *
 * Memory model: one module-level singleton, installed once by
 * FlareProvider on mount. The observers run for the life of the tab
 * and update the cached values in place.
 *
 * No web-vitals npm dep — implemented inline against the standard
 * PerformanceObserver API. Safari support: LCP/CLS yes, FID partial.
 * Falls back to null on any browser that doesn't support an entry type.
 */

interface VitalsCache {
  lcp_ms: number | null;
  fid_ms: number | null;
  cls: number | null;
}

const cache: VitalsCache = {
  lcp_ms: null,
  fid_ms: null,
  cls: null,
};

let installed = false;

/**
 * Subscribe to LCP / FID / CLS PerformanceObserver entries. Idempotent.
 * Returns a teardown function that disconnects all observers.
 */
export function installWebVitals(): () => void {
  if (installed) return () => void 0;
  if (typeof window === "undefined" || !("PerformanceObserver" in window)) {
    return () => void 0;
  }
  installed = true;

  const observers: PerformanceObserver[] = [];

  // LCP — largest-contentful-paint
  try {
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & { renderTime?: number; loadTime?: number };
      if (last) {
        cache.lcp_ms = Math.round(last.renderTime ?? last.loadTime ?? last.startTime);
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    observers.push(lcpObserver);
  } catch { /* unsupported */ }

  // FID — first-input
  try {
    const fidObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const first = entries[0] as PerformanceEventTiming | undefined;
      if (first && cache.fid_ms == null) {
        cache.fid_ms = Math.round(first.processingStart - first.startTime);
      }
    });
    fidObserver.observe({ type: "first-input", buffered: true });
    observers.push(fidObserver);
  } catch { /* unsupported */ }

  // CLS — layout-shift (cumulative, exclude session boundaries)
  try {
    let clsValue = 0;
    let sessionValue = 0;
    let sessionEntries: Array<PerformanceEntry & { hadRecentInput?: boolean; value: number }> = [];
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value: number }>) {
        if (entry.hadRecentInput) continue;
        const firstSessionEntry = sessionEntries[0];
        const lastSessionEntry = sessionEntries[sessionEntries.length - 1];
        if (
          sessionValue
          && entry.startTime - lastSessionEntry.startTime < 1000
          && entry.startTime - firstSessionEntry.startTime < 5000
        ) {
          sessionValue += entry.value;
          sessionEntries.push(entry);
        } else {
          sessionValue = entry.value;
          sessionEntries = [entry];
        }
        if (sessionValue > clsValue) {
          clsValue = sessionValue;
          cache.cls = Math.round(clsValue * 1000) / 1000;
        }
      }
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
    observers.push(clsObserver);
  } catch { /* unsupported */ }

  return () => {
    observers.forEach((o) => o.disconnect());
    installed = false;
  };
}

export function getWebVitals(): VitalsCache {
  return { ...cache };
}
