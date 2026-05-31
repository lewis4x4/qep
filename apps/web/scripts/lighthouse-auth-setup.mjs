#!/usr/bin/env node
/**
 * WAVE Quality Tail — Slice 1: Lighthouse storage-state generator.
 *
 * Drives a Playwright sign-in against LHCI_BASE_URL with test
 * credentials, waits for the Supabase password grant + stored auth
 * token, verifies the authenticated sales canary route (/sales/today),
 * and only then writes auth state to disk. The
 * companion puppeteerScript (./lighthouse-puppeteer-auth.cjs) loads
 * that state before each Lighthouse audit so /sales/* routes audit
 * as a real rep instead of redirecting to the login page.
 *
 * Required env:
 *   LHCI_BASE_URL                  e.g. https://qep.blackrockai.co
 *   PLAYWRIGHT_TEST_EMAIL          test account email
 *   PLAYWRIGHT_TEST_PASSWORD       test account password
 *
 * Selectors match apps/web/src/components/LoginPage.tsx (the password
 * tab form, IDs #email-pw / #password / #login-button) and the
 * existing Playwright helper at apps/web/tests/e2e/helpers/auth.ts.
 * Keep the password-grant + localStorage auth-token wait in lockstep
 * with that helper so this setup does not depend on role-specific
 * post-login home redirects.
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
const AUTH_CANARY_PATH = "/sales/today";

function resolveAppUrl(origin, path) {
  return new URL(path, origin).toString();
}

async function waitForSupabasePasswordGrant(page) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/auth/v1/token") &&
      response.url().includes("grant_type=password") &&
      response.status() >= 200 &&
      response.status() < 300,
    { timeout: 30_000 },
  );
}

async function waitForStoredSupabaseAuthToken(page) {
  await page.waitForFunction(
    () =>
      Object.keys(window.localStorage).some(
        (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
      ),
    undefined,
    { timeout: 30_000 },
  );
}

async function assertAuthenticatedSalesCanary(page, canaryUrl) {
  await page.goto(canaryUrl, { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => url.pathname === AUTH_CANARY_PATH, { timeout: 30_000 });
  await page.locator('[data-testid="sales-shell"]').waitFor({ state: "visible", timeout: 30_000 });
  // Give SPA auth/route guards one more beat so we don't snapshot a transient state.
  await page.waitForTimeout(1_000);

  const finalUrl = new URL(page.url());
  if (finalUrl.pathname !== AUTH_CANARY_PATH) {
    throw new Error(
      `[lighthouse-auth-setup] authenticated canary failed: expected stable ${AUTH_CANARY_PATH}, got ${finalUrl.toString()}`,
    );
  }

  for (const selector of ["#email-pw", "#password", "#login-button"]) {
    const loginControl = page.locator(selector);
    if (await loginControl.isVisible()) {
      throw new Error(
        `[lighthouse-auth-setup] authenticated canary failed: login control ${selector} is still visible at ${finalUrl.toString()}`,
      );
    }
  }
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

try {
  // Land on the app root; unauthenticated visits redirect to the
  // login form which lives at the same route in this build.
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  // Match the selectors and auth-success signal used by
  // apps/web/tests/e2e/helpers/auth.ts. Do not wait on a role-specific
  // post-login route here: the shared CI fixture may be admin/manager and
  // therefore lands on /qrm before the Lighthouse canary navigates to
  // /sales/today.
  await page.locator("#email-pw").fill(email);
  await page.locator("#password").fill(password);
  const passwordGrant = waitForSupabasePasswordGrant(page);
  await page.locator("#login-button").click();
  await passwordGrant;
  await waitForStoredSupabaseAuthToken(page);
  const canaryUrl = resolveAppUrl(baseUrl, AUTH_CANARY_PATH);
  await assertAuthenticatedSalesCanary(page, canaryUrl);
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
