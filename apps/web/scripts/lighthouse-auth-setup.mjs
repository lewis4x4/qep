#!/usr/bin/env node
/**
 * WAVE Quality Tail — Slice 1: Lighthouse storage-state generator.
 *
 * Drives a Playwright sign-in against LHCI_BASE_URL with rep test
 * credentials and writes the resulting auth state to disk. The
 * companion puppeteerScript (./lighthouse-puppeteer-auth.cjs) loads
 * that state before each Lighthouse audit so /sales/* routes audit
 * as a real rep instead of redirecting to the login page.
 *
 * Required env:
 *   LHCI_BASE_URL                  e.g. https://qep.blackrockai.co
 *   PLAYWRIGHT_TEST_EMAIL          rep account email
 *   PLAYWRIGHT_TEST_PASSWORD       rep account password
 *
 * Selectors match apps/web/src/components/LoginPage.tsx (the password
 * tab form, IDs #email-pw / #password / #login-button) and the
 * existing Playwright helper at apps/web/tests/e2e/helpers/auth.ts.
 * If LoginPage gets a redesign, update both this script and the
 * helper in lockstep.
 *
 * Output: apps/web/.lighthouse-storage-state.json (git-ignored).
 */

import { chromium } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const baseUrl = process.env.LHCI_BASE_URL;
const email = process.env.PLAYWRIGHT_TEST_EMAIL;
const password = process.env.PLAYWRIGHT_TEST_PASSWORD;

if (!baseUrl || !email || !password) {
  console.error(
    "[lighthouse-auth-setup] missing LHCI_BASE_URL / PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD",
  );
  process.exit(1);
}

const outputPath = resolve(__dirname, "..", ".lighthouse-storage-state.json");

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

try {
  // Land on the app root; unauthenticated visits redirect to the
  // login form which lives at the same route in this build.
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  // Match the IDs used by apps/web/tests/e2e/helpers/auth.ts so any
  // future selector change only has to be made in one place.
  await page.locator("#email-pw").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#login-button").click();
  // Wait until we leave /login. SalesShell drops reps on /sales/today,
  // other roles land on /floor or /dashboard.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
  await context.storageState({ path: outputPath });
  console.log(
    `[lighthouse-auth-setup] wrote storage state to ${outputPath}`,
  );
} catch (err) {
  console.error("[lighthouse-auth-setup] failed:", err);
  process.exit(1);
} finally {
  await browser.close();
}
