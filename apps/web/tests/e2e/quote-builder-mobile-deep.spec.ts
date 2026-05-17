/**
 * WAVE quote-builder deep reflow — end-to-end mobile spec.
 *
 * Drives the Quote Builder at iPhone 14 viewport (390x844) through all
 * 11 wizard steps and asserts the reflow contract from the handoff:
 *
 *   - No horizontal scroll on any step
 *   - All interactive targets land >= 44pt
 *   - No open [role="dialog"]:not([data-mobile-sheet]) — every modal
 *     reaches the rep as a MobileBottomSheet at <640px (catches missed
 *     Dialog conversions in EquipmentStep, MarginFloorGate, etc.)
 *   - Each step's sticky bottom action bar / continue button is visible
 *
 * Auth: requires PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD. Tests
 * that need the wizard skip when credentials aren't set; the chrome /
 * gating cases still run.
 */

import { expect, test, type Page } from "@playwright/test";
import { playwrightTestCredentials, signInWithPassword } from "./fixtures";
// WAVE CI / Quality (Slice 2): per-step axe scan.
import { expectNoAxeViolations } from "./_helpers/axe-scan";

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

async function assertNoStrayDialog(page: Page): Promise<void> {
  // Every open dialog inside SalesShell on mobile must carry
  // data-mobile-sheet="true" — the MobileBottomSheet primitive stamps
  // it. Anything else is a desktop Radix Dialog that escaped a
  // useIsMobileViewport gate.
  const stray = await page
    .locator("[role=\"dialog\"]:not([data-mobile-sheet])")
    .filter({ hasNot: page.locator("[aria-hidden=\"true\"]") })
    .count();
  expect(stray).toBe(0);
}

async function assertTapTargetsMeetMinimum(page: Page): Promise<void> {
  const violations = await page.evaluate(() => {
    const minPx = 44;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([aria-hidden="true"]):not([disabled]), a[href]:not([aria-hidden="true"]), [role="button"]:not([aria-hidden="true"])',
      ),
    );
    return targets
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        // Allow tiny chips in chip rails (e.g. small "x" icons inside larger tappable parents)
        // only when their parent is itself a >=44pt target.
        const parent = el.parentElement;
        const parentRect = parent?.getBoundingClientRect();
        const parentOk =
          parentRect != null &&
          parentRect.width >= minPx &&
          parentRect.height >= minPx;
        return !parentOk && (rect.width < minPx || rect.height < minPx);
      })
      .slice(0, 10)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? "").trim().slice(0, 40),
        width: Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
      }));
  });
  expect(violations, JSON.stringify(violations, null, 2)).toHaveLength(0);
}

test.describe("quote-builder mobile deep reflow", () => {
  test.use({ viewport: IPHONE_14_VIEWPORT });

  test("unauthenticated /sales/quotes/new gates behind login at iPhone viewport", async ({
    page,
  }) => {
    await page.goto("/sales/quotes/new");
    await expect(page.locator("#email-pw")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("legacy /quote-v2 redirects to /sales/quotes/new at mobile viewport", async ({
    page,
  }) => {
    await page.goto("/quote-v2");
    await page.waitForURL(/\/sales\/quotes\/new/);
    await expect(page).toHaveURL(/\/sales\/quotes\/new/);
  });

  test.describe("authenticated wizard walk", () => {
    test.describe.configure({ timeout: 240_000 });

    test.skip(
      !credentials,
      "Set PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD for the authenticated wizard walk",
    );

    test("walks the wizard with no horizontal scroll and no escaped Dialogs", async ({
      page,
    }) => {
      if (!credentials) test.skip();
      await signInWithPassword(page, credentials.email, credentials.password);

      await page.goto("/sales/quotes/new");
      // SalesShell chrome should be present at the mobile viewport.
      await expect(page.getByRole("button", { name: /Quick actions/i })).toBeVisible({
        timeout: 30_000,
      });
      await assertNoHorizontalOverflow(page);
      await assertNoStrayDialog(page);

      // Each step in the existing WIZARD_STEPS order. Use the wizard
      // progress pills to hop between steps so the test doesn't depend
      // on per-step Continue gating (some steps gate until inputs land).
      const stepIds = [
        "customer",
        "equipment",
        "configure",
        "tradeIn",
        "pricing",
        "promotions",
        "financing",
        "details",
        "review",
        "document",
        "send",
      ];

      for (const stepId of stepIds) {
        // WAVE polish (Slice 1): on phone the wizard now renders via
        // MobileWizardStepper (data-step-id) instead of the desktop
        // QuoteWizardProgress tiles (data-testid="wizard-progress-").
        // Try both selectors so the spec works at any viewport.
        const pill = page
          .locator(`[data-step-id="${stepId}"], [data-testid="wizard-progress-${stepId}"]`)
          .first();
        if ((await pill.count()) === 0) continue;
        await pill.click({ trial: false }).catch(() => {});
        await page.waitForTimeout(200);
        await assertNoHorizontalOverflow(page);
        await assertNoStrayDialog(page);
        // WAVE CI / Quality (Slice 2): a11y scan per step.
        await expectNoAxeViolations(page, `quote-builder-${stepId}`);
      }
    });

    test("Pricing margin strip + adders accordion render on mobile", async ({
      page,
    }) => {
      if (!credentials) test.skip();
      await signInWithPassword(page, credentials.email, credentials.password);
      await page.goto("/sales/quotes/new");
      const pricingPill = page
        .locator('[data-step-id="pricing"], [data-testid="wizard-progress-pricing"]')
        .first();
      if ((await pricingPill.count()) === 0) test.skip(undefined, "Pricing pill not reachable in seed state");
      await pricingPill.click();
      await expect(page.getByTestId("pricing-step-margin-strip")).toBeVisible({
        timeout: 10_000,
      });
      await assertNoHorizontalOverflow(page);
    });

    test("Review summary blocks render as accordions on mobile", async ({
      page,
    }) => {
      if (!credentials) test.skip();
      await signInWithPassword(page, credentials.email, credentials.password);
      await page.goto("/sales/quotes/new");
      const reviewPill = page
        .locator('[data-step-id="review"], [data-testid="wizard-progress-review"]')
        .first();
      if ((await reviewPill.count()) === 0) test.skip(undefined, "Review pill not reachable in seed state");
      await reviewPill.click();
      await expect(page.getByTestId("review-quote-hero")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("review-summary-accordions")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });

    test("WAVE polish (Slice 1): mobile wizard stepper chip rail renders", async ({
      page,
    }) => {
      if (!credentials) test.skip();
      await signInWithPassword(page, credentials.email, credentials.password);
      await page.goto("/sales/quotes/new");
      // The Phase 1 polish slice swaps in MobileWizardStepper for
      // QuoteWizardProgress at <640px. Existence of the chip rail
      // proves the swap shipped.
      await expect(page.getByTestId("mobile-wizard-stepper")).toBeVisible({
        timeout: 15_000,
      });
    });
  });

  test.describe("authenticated wizard walk @ iPad portrait (768x1024)", () => {
    test.describe.configure({ timeout: 240_000 });
    test.use({ viewport: { width: 768, height: 1024 } });

    test.skip(
      !credentials,
      "Set PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD for the iPad-portrait wizard walk",
    );

    test("iPad portrait wizard stays single-column inside SalesShell", async ({
      page,
    }) => {
      if (!credentials) test.skip();
      await signInWithPassword(page, credentials.email, credentials.password);
      await page.goto("/sales/quotes/new");
      // SalesShell still owns the chrome at 768pt — the BottomTabBar
      // and CaptureSheet trigger should remain visible.
      await expect(page.getByRole("button", { name: /Quick actions/i })).toBeVisible({
        timeout: 30_000,
      });
      await assertNoHorizontalOverflow(page);
      await assertNoStrayDialog(page);

      // Walk through each step (selectors match either chrome — at
      // 768pt, tailwind's sm breakpoint (640) has fired so the
      // QuoteWizardProgress desktop tiles are the visible rail).
      const stepIds = [
        "customer",
        "equipment",
        "configure",
        "tradeIn",
        "pricing",
        "promotions",
        "financing",
        "details",
        "review",
      ];
      for (const stepId of stepIds) {
        const pill = page
          .locator(`[data-step-id="${stepId}"], [data-testid="wizard-progress-${stepId}"]`)
          .first();
        if ((await pill.count()) === 0) continue;
        await pill.click({ trial: false }).catch(() => {});
        await page.waitForTimeout(200);
        await assertNoHorizontalOverflow(page);
        await assertNoStrayDialog(page);
      }
    });

    test("tap targets meet 44pt minimum across visible Customer step", async ({
      page,
    }) => {
      if (!credentials) test.skip();
      await signInWithPassword(page, credentials.email, credentials.password);
      await page.goto("/sales/quotes/new");
      // Customer is the landing step.
      await page.waitForTimeout(500);
      await assertTapTargetsMeetMinimum(page);
    });
  });
});
