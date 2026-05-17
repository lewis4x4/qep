/**
 * WAVE CI / Quality — Slice 2: sales-rep route a11y sweep.
 *
 * Loads each of the eight highest-value sales-rep routes at iPhone 14
 * viewport (390x844) and asserts zero serious/critical axe violations.
 * Unauthenticated rep would be redirected to login on most of these
 * routes — that's fine, the login page is part of the rep's mobile
 * path and must also be a11y-clean.
 *
 * Auth is intentionally not required here: this slice is the baseline
 * a11y scan. An authenticated companion sweep lands once Playwright
 * storage state is wired up (queued behind the Lighthouse auth slice
 * deferred in Slice 1).
 */

import { test } from "@playwright/test";
import { expectNoAxeViolations } from "./_helpers/axe-scan";

const SALES_REP_ROUTES = [
  { path: "/sales/today", name: "today" },
  { path: "/sales/pipeline", name: "pipeline" },
  { path: "/sales/customers", name: "customers" },
  { path: "/sales/quotes", name: "quote-list" },
  { path: "/sales/quotes/new", name: "quote-new" },
  { path: "/sales/field-note", name: "field-note" },
  { path: "/sales/voice-quote", name: "voice-quote" },
  { path: "/sales/my-mirror", name: "my-mirror" },
];

test.describe("Sales rep route a11y", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of SALES_REP_ROUTES) {
    test(`${route.name} has no serious/critical axe violations`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page, route.name);
    });
  }
});
