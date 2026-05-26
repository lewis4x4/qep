import { expect, test } from "@playwright/test";

import {
  clickStepFooterNext,
  clickWizardProgressPill,
  expectWizardStep,
  pickFirstCrmCustomerAndStart,
  playwrightCrmCustomerQuery,
  playwrightTestCredentials,
  selectFirstCatalogEquipment,
  selectFirstQuotingBranch,
  signInWithPassword,
} from "./fixtures";

const credentials = playwrightTestCredentials();
const crmCustomerQuery = playwrightCrmCustomerQuery();

test.describe("quote wizard step navigation", () => {
  // Decision Q7 (do_not_allow): the wizard now requires a CRM-linked
  // customer, so PLAYWRIGHT_CRM_CUSTOMER_QUERY is mandatory alongside
  // the auth env vars.
  test.skip(
    !credentials || !crmCustomerQuery,
    "Set PLAYWRIGHT_TEST_EMAIL, PLAYWRIGHT_TEST_PASSWORD, and PLAYWRIGHT_CRM_CUSTOMER_QUERY for authenticated e2e",
  );

  test.beforeEach(async ({ page }) => {
    await signInWithPassword(page, credentials!.email, credentials!.password);
    await page.goto("/quote-v2");
    await expect(page.getByRole("heading", { name: "Quote Builder" })).toBeVisible();
  });

  test("progress pills jump back from pricing to configure and forward again", async ({ page }) => {
    await expectWizardStep(page, 1);
    await pickFirstCrmCustomerAndStart(page);
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
