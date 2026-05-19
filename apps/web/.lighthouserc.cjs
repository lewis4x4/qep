/**
 * WAVE CI / Quality — Slice 1: Lighthouse mobile configuration.
 *
 * Drives `bun run lighthouse:mobile` (and the matching workflow in
 * .github/workflows/lighthouse-mobile.yml) against the eight highest-
 * value sales-rep routes. Thresholds are calibrated to fail PRs that
 * regress mobile performance or accessibility on these surfaces:
 *
 *   - performance >= 0.85 (error)
 *   - accessibility >= 0.95 (error)
 *   - best-practices >= 0.90 (warn)
 *   - CLS <= 0.1 (error) — layout shift is the single most painful
 *     mobile regression for a rep dictating into a field
 *
 * LHCI_BASE_URL controls the target host. CI sets it to the staging
 * host; local runs use the `lighthouse:mobile:local` script which
 * points at the Vite dev server.
 *
 * Auth modes:
 *   - LHCI_AUTHENTICATED unset / "false" (default): guest-route run.
 *     Routes redirect to login; Lighthouse measures the login surface.
 *     Used by fork PRs without secrets — the workflow surfaces a
 *     ::warning:: when it falls back to this mode.
 *   - LHCI_AUTHENTICATED="true": the puppeteerScript at
 *     scripts/lighthouse-puppeteer-auth.cjs loads the storage state
 *     captured by scripts/lighthouse-auth-setup.mjs into the headless
 *     browser before each audit, so SalesShell renders for real
 *     instead of bouncing through the login redirect.
 *   - LHCI_GUEST_FALLBACK="true": no credentials are available. Routes
 *     still prove reachability and accessibility/CLS, but performance is
 *     downgraded to a warning because the audited surface is the login
 *     shell, not the authenticated sales workspace.
 *
 * (Quality Tail Slice 1)
 */

const SALES_REP_ROUTES = [
  "/sales/today",
  "/sales/pipeline",
  "/sales/customers",
  "/sales/quotes",
  "/sales/quotes/new",
  "/sales/field-note",
  "/sales/voice-quote",
  "/sales/my-mirror",
];

const baseUrl = process.env.LHCI_BASE_URL || "https://qep.blackrockai.co";
const authenticated = process.env.LHCI_AUTHENTICATED === "true";
const guestFallback = process.env.LHCI_GUEST_FALLBACK === "true";

module.exports = {
  ci: {
    collect: {
      url: SALES_REP_ROUTES.map((path) => `${baseUrl}${path}`),
      numberOfRuns: 1,
      puppeteerScript: authenticated
        ? "./scripts/lighthouse-puppeteer-auth.cjs"
        : undefined,
      settings: {
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 3,
          disabled: false,
        },
        throttlingMethod: "simulate",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        skipAudits: [
          "uses-http2",
          "redirects-http",
        ],
        chromeFlags: "--no-sandbox --disable-dev-shm-usage",
      },
    },
    assert: {
      assertions: {
        "categories:performance": [guestFallback ? "warn" : "error", { minScore: 0.85 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "first-contentful-paint": ["warn", { maxNumericValue: 2500 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 4000 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 600 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
