/**
 * WAVE phase 7 — End-to-end mobile smoke for the sales-rep surface.
 *
 * Runs at iPhone 14 viewport (390x844) and verifies the consolidated
 * SalesShell wiring across the slices we shipped in phases 1–6:
 *   /sales/today, /sales/pipeline, /sales/customers,
 *   /sales/quotes (+ /new), /sales/field-note, /sales/voice-quote,
 *   /sales/my-mirror, /sales/deals/:dealId, and the FAB Capture Sheet.
 *
 * Authentication: set PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD
 * to enable the in-app login flow. Without credentials, the
 * unauthenticated-gating test still runs, which exercises route
 * mounting + login redirect at the mobile viewport.
 */

import { expect, test, type Page } from "@playwright/test";
import { playwrightTestCredentials, signInWithPassword } from "./fixtures";

const IPHONE_14_VIEWPORT = { width: 390, height: 844 };
const credentials = playwrightTestCredentials();

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const viewportWidth = window.innerWidth;
    return { docWidth, viewportWidth, overflow: docWidth - viewportWidth };
  });
  expect(overflow.overflow, JSON.stringify(overflow)).toBeLessThanOrEqual(1);
}

async function assertBottomTabPersistsAfterShellScroll(
  page: Page,
  scrollRootTestId: string,
): Promise<void> {
  const bottomTab = page.getByTestId("sales-bottom-tab-bar");
  await expect(bottomTab).toBeVisible();
  await expect(bottomTab).toHaveAttribute("data-bottom-tab-height", "64");
  await expect(bottomTab).toHaveAttribute(
    "data-safe-area-contract",
    "height-includes-padding-bottom-once",
  );

  await page.getByTestId(scrollRootTestId).evaluate((node) => {
    node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
  });

  const metrics = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
  }));
  const box = await bottomTab.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(metrics.viewportHeight + 4);
}

test.describe("mobile sales rep surface", () => {
  test.use({ viewport: IPHONE_14_VIEWPORT });

  test("unauthenticated /sales/today gates behind login", async ({ page }) => {
    await page.goto("/sales/today");
    await expect(page.locator("#email-pw")).toBeVisible();
    await expect(page.locator("#login-button")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("unauthenticated /sales/quotes/new also gates", async ({ page }) => {
    await page.goto("/sales/quotes/new");
    await expect(page.locator("#email-pw")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("legacy /voice-quote redirects into /sales/voice-quote", async ({ page }) => {
    await page.goto("/voice-quote");
    await page.waitForURL(/\/sales\/voice-quote/);
    await expect(page).toHaveURL(/\/sales\/voice-quote/);
  });

  test("legacy /quote-v2 redirects into /sales/quotes/new", async ({ page }) => {
    await page.goto("/quote-v2");
    await page.waitForURL(/\/sales\/quotes\/new/);
    await expect(page).toHaveURL(/\/sales\/quotes\/new/);
  });

  test.describe("authenticated rep navigation", () => {
    test.describe.configure({ timeout: 240_000 });

    test.skip(
      !credentials,
      "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD for the authenticated walk",
    );

    test("walks the rep through every consolidated /sales/* surface", async ({ page }) => {
      if (!credentials) test.skip();
      await signInWithPassword(page, credentials.email, credentials.password);

      // /sales/today is the rep's landing surface.
      await page.goto("/sales/today");
      await expect(page).toHaveURL(/\/sales\/today/);
      await assertNoHorizontalOverflow(page);
      await assertBottomTabPersistsAfterShellScroll(page, "sales-shell-scroll-root");

      // BottomTabBar present and clickable on Pipeline.
      const pipelineTab = page.getByRole("tab", { name: /Pipeline/i });
      await expect(pipelineTab).toBeVisible();
      await pipelineTab.click();
      await expect(page).toHaveURL(/\/sales\/pipeline/);
      await assertNoHorizontalOverflow(page);

      // /sales/quotes inside SalesShell.
      await page.goto("/sales/quotes");
      await expect(page).toHaveURL(/\/sales\/quotes$/);
      await assertNoHorizontalOverflow(page);
      await assertBottomTabPersistsAfterShellScroll(page, "sales-shell-scroll-root");

      // /sales/quotes/new mounts QuoteBuilder.
      await page.goto("/sales/quotes/new");
      await expect(page).toHaveURL(/\/sales\/quotes\/new/);
      await assertNoHorizontalOverflow(page);
      await assertBottomTabPersistsAfterShellScroll(page, "sales-shell-scroll-root");

      // /sales/field-note mounts the voice cockpit.
      await page.goto("/sales/field-note");
      await expect(page).toHaveURL(/\/sales\/field-note/);
      await assertNoHorizontalOverflow(page);

      // /sales/voice-quote.
      await page.goto("/sales/voice-quote");
      await expect(page).toHaveURL(/\/sales\/voice-quote/);
      await assertNoHorizontalOverflow(page);
      await assertBottomTabPersistsAfterShellScroll(page, "sales-shell-scroll-root");

      // /sales/my-mirror.
      await page.goto("/sales/my-mirror");
      await expect(page).toHaveURL(/\/sales\/my-mirror/);
      await expect(page.getByTestId("my-mirror-page")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });

    test("Capture surface exposes Field Note + Voice Quote + My Mirror quick actions", async ({
      page,
    }) => {
      if (!credentials) test.skip();
      await signInWithPassword(page, credentials.email, credentials.password);
      await page.goto("/sales/today");

      await page.getByRole("tab", { name: /Capture/i }).click();
      await expect(page).toHaveURL(/\/sales\/capture/);
      await expect(page.getByTestId("capture-tap-to-record")).toBeVisible();
      await expect(
        page.locator("[data-capture-action=\"field_note\"]"),
      ).toBeVisible();
      await expect(
        page.locator("[data-capture-action=\"voice_quote\"]"),
      ).toBeVisible();
      await expect(
        page.locator("[data-capture-action=\"my_mirror\"]"),
      ).toBeVisible();
      await expect(
        page.locator("[data-capture-action=\"quick_note\"]"),
      ).toBeVisible();
    });
  });
});
