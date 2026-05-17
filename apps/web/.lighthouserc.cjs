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
 * Guest-route note: the eight routes require auth. When run as guest
 * (no Playwright storage state), most of them redirect to the login
 * page — Lighthouse still measures the login page. That guest-route
 * baseline is acceptable for Slice 1; an authenticated runner lands
 * in a follow-on slice once the multi-approver wave closes.
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

module.exports = {
  ci: {
    collect: {
      url: SALES_REP_ROUTES.map((path) => `${baseUrl}${path}`),
      numberOfRuns: 1,
      settings: {
        preset: "mobile",
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
        "categories:performance": ["error", { minScore: 0.85 }],
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
