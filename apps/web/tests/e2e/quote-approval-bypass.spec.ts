import { expect, test } from "@playwright/test";

import {
  clickWizardProgressPill,
  expectApprovalBypassApplied,
  expectWizardStep,
  pickFirstCrmCustomerAndStart,
  playwrightAgedEquipmentId,
  playwrightCrmCustomerQuery,
  playwrightTestCredentials,
  selectFirstQuotingBranch,
  signInWithPassword,
  submitForApproval,
  waitForQuoteAutosave,
  walkFromEquipmentToReview,
} from "./fixtures";

const credentials = playwrightTestCredentials();
const agedEquipmentId = playwrightAgedEquipmentId();
const crmCustomerQuery = playwrightCrmCustomerQuery();

test.describe("quote approval bypass", () => {
  test.describe.configure({ timeout: 180_000 });

  // Decision Q7 (do_not_allow): the wizard now requires a CRM-linked
  // customer, so PLAYWRIGHT_CRM_CUSTOMER_QUERY is mandatory alongside
  // the existing equipment + auth env vars.
  test.skip(
    !credentials || !agedEquipmentId || !crmCustomerQuery,
    "Set PLAYWRIGHT_TEST_EMAIL, PLAYWRIGHT_TEST_PASSWORD, PLAYWRIGHT_AGED_EQUIPMENT_ID, and PLAYWRIGHT_CRM_CUSTOMER_QUERY",
  );

  test.beforeEach(async ({ page }) => {
    await signInWithPassword(page, credentials!.email, credentials!.password);
    await page.goto(`/quote-v2?crm_equipment_id=${encodeURIComponent(agedEquipmentId!)}`);
    await expect(page.getByRole("heading", { name: "Quote Builder" })).toBeVisible();
  });

  test("aged stocked CRM unit auto-approves without creating an approval case", async ({ page }) => {
    await expectWizardStep(page, 1);
    await pickFirstCrmCustomerAndStart(page);
    await selectFirstQuotingBranch(page);

    await clickWizardProgressPill(page, "equipment");
    await expectWizardStep(page, 2);
    await expect(page.getByRole("button", { name: /^Configure/i }).last()).toBeEnabled({ timeout: 90_000 });

    await walkFromEquipmentToReview(page);
    await waitForQuoteAutosave(page);

    await submitForApproval(page);
    await expectApprovalBypassApplied(page);

    await expect(page.getByRole("button", { name: /^Approved$/ })).toBeVisible();
    await expect(page.getByText(/pending_approval/i)).toHaveCount(0);
  });
});
