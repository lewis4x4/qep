/**
 * WAVE Quality Tail — Slice 1: Lighthouse puppeteerScript hook.
 *
 * Lighthouse calls this module before each audit when
 * LHCI_AUTHENTICATED=true. We load the storage state captured by
 * scripts/lighthouse-auth-setup.mjs and prime the headless browser
 * context (cookies + localStorage + sessionStorage) so the audit
 * lands inside the SalesShell instead of bouncing through the login
 * redirect.
 *
 * The storage-state JSON format is the standard Playwright shape:
 *   {
 *     "cookies": [...],
 *     "origins": [{ origin, localStorage: [...], sessionStorage: [...] }]
 *   }
 *
 * Puppeteer's setCookie takes a slightly different shape than
 * Playwright's storage state, hence the mapping below. localStorage
 * gets restored by visiting the origin first then calling setItem
 * inside an evaluate(). The same trick handles sessionStorage.
 */

const fs = require("node:fs");
const path = require("node:path");

const STATE_PATH = path.resolve(
  __dirname,
  "..",
  ".lighthouse-storage-state.json",
);

function mapSameSite(value) {
  if (value === "Strict") return "Strict";
  if (value === "Lax") return "Lax";
  return "None";
}

/** @type {(browser: import('puppeteer').Browser, context: { url: string }) => Promise<void>} */
module.exports = async (browser /* , context */) => {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(
      `[lighthouse-auth] storage state not found at ${STATE_PATH}. ` +
        `Run scripts/lighthouse-auth-setup.mjs first.`,
    );
  }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const page = await browser.newPage();

  try {
    if (Array.isArray(state.cookies) && state.cookies.length > 0) {
      await page.setCookie(
        ...state.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: mapSameSite(c.sameSite),
        })),
      );
    }

    if (Array.isArray(state.origins)) {
      for (const origin of state.origins) {
        if (!origin.origin) continue;
        // Visit the origin so localStorage / sessionStorage writes
        // land against the right window.
        await page.goto(origin.origin, { waitUntil: "domcontentloaded" });
        await page.evaluate((store) => {
          for (const item of store.localStorage ?? []) {
            try {
              window.localStorage.setItem(item.name, item.value);
            } catch {
              // Storage quota / private-mode — ignore; cookie auth
              // typically suffices for SalesShell entry.
            }
          }
          for (const item of store.sessionStorage ?? []) {
            try {
              window.sessionStorage.setItem(item.name, item.value);
            } catch {
              // ignore
            }
          }
        }, origin);
      }
    }
  } finally {
    await page.close();
  }
};
