import { expect, test } from "@playwright/test";

import {
  clickStepFooterNext,
  ensureApprovalForCustomerFacing,
  expectWizardStep,
  generateDocumentPreview,
  playwrightTestCredentials,
  signInWithPassword,
  waitForQuoteAutosave,
  walkProspectQuoteToReview,
} from "./fixtures";

const credentials = playwrightTestCredentials();

test.describe("quote wizard happy path", () => {
  test("unauthenticated visit is gated behind login", async ({ page }) => {
    await page.goto("/quote-v2");
    await expect(page.getByRole("heading", { name: "Quote Builder" })).not.toBeVisible();
    await expect(page.locator("#email-pw")).toBeVisible();
    await expect(page.locator("#login-button")).toBeVisible();
  });

  test.describe("authenticated prospect flow", () => {
    test.describe.configure({ timeout: 180_000 });

    test.skip(
      !credentials,
      "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD for authenticated e2e",
    );

    test.beforeEach(async ({ page }) => {
      await signInWithPassword(page, credentials!.email, credentials!.password);
      await page.goto("/quote-v2");
      await expect(page.getByRole("heading", { name: "Quote Builder" })).toBeVisible();
    });

    test("prospect quote flows through configure, pricing, review, PDF preview, and send preview", async ({
      page,
    }) => {
      await walkProspectQuoteToReview(page);
      await waitForQuoteAutosave(page);
      await ensureApprovalForCustomerFacing(page);
      await clickStepFooterNext(page, /^Document/i);

      await expectWizardStep(page, 10);
      await generateDocumentPreview(page);
      await clickStepFooterNext(page, /^Send & log/i);

      await expectWizardStep(page, 11);
      const preview = page.getByRole("button", { name: /Preview Quote/i });
      await expect(preview).toBeVisible();
      await preview.click();
    });
  });
});
