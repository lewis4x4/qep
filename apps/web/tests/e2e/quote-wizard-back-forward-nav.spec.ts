import { expect, test } from "@playwright/test";

import {
  clickStepFooterNext,
  clickWizardProgressPill,
  expectWizardStep,
  playwrightTestCredentials,
  selectFirstCatalogEquipment,
  selectFirstQuotingBranch,
  signInWithPassword,
  startProspectQuote,
} from "./fixtures";

const credentials = playwrightTestCredentials();

test.describe("quote wizard step navigation", () => {
  test.skip(
    !credentials,
    "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD for authenticated e2e",
  );

  test.beforeEach(async ({ page }) => {
    await signInWithPassword(page, credentials!.email, credentials!.password);
    await page.goto("/quote-v2");
    await expect(page.getByRole("heading", { name: "Quote Builder" })).toBeVisible();
  });

  test("progress pills jump back from pricing to configure and forward again", async ({ page }) => {
    await expectWizardStep(page, 1);
    await startProspectQuote(page);
    await selectFirstQuotingBranch(page);

    await clickWizardProgressPill(page, "equipment");
    await expectWizardStep(page, 2);
    await selectFirstCatalogEquipment(page);
    await clickStepFooterNext(page, /^Configure/i);

    await expectWizardStep(page, 3);
    await clickStepFooterNext(page, /^Trade-in/i);
    await expectWizardStep(page, 4);
    await clickStepFooterNext(page, /^Pricing/i);
    await expectWizardStep(page, 5);

    await clickWizardProgressPill(page, "configure");
    await expectWizardStep(page, 3);

    await clickWizardProgressPill(page, "pricing");
    await expectWizardStep(page, 5);
    await expect(page.getByRole("button", { name: /^Configure/i })).toBeEnabled();
  });
});
