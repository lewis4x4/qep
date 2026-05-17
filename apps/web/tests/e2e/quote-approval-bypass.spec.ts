import { expect, test } from "@playwright/test";

import {
  clickWizardProgressPill,
  expectApprovalBypassApplied,
  expectWizardStep,
  playwrightAgedEquipmentId,
  playwrightTestCredentials,
  selectFirstQuotingBranch,
  signInWithPassword,
  startProspectQuote,
  submitForApproval,
  waitForQuoteAutosave,
  walkFromEquipmentToReview,
} from "./fixtures";

const credentials = playwrightTestCredentials();
const agedEquipmentId = playwrightAgedEquipmentId();

test.describe("quote approval bypass", () => {
  test.describe.configure({ timeout: 180_000 });

  test.skip(
    !credentials || !agedEquipmentId,
    "Set PLAYWRIGHT_TEST_EMAIL, PLAYWRIGHT_TEST_PASSWORD, and PLAYWRIGHT_AGED_EQUIPMENT_ID (CRM unit with received_at >= 365 days, in stock, margin >= 8%)",
  );

  test.beforeEach(async ({ page }) => {
    await signInWithPassword(page, credentials!.email, credentials!.password);
    await page.goto(`/quote-v2?crm_equipment_id=${encodeURIComponent(agedEquipmentId!)}`);
    await expect(page.getByRole("heading", { name: "Quote Builder" })).toBeVisible();
  });

  test("aged stocked CRM unit auto-approves without creating an approval case", async ({ page }) => {
    await expectWizardStep(page, 1);
    await startProspectQuote(page);
    await selectFirstQuotingBranch(page);

    await clickWizardProgressPill(page, "equipment");
    await expectWizardStep(page, 2);
    await expect(page.getByRole("button", { name: /^Configure/i })).toBeEnabled({ timeout: 90_000 });

    await walkFromEquipmentToReview(page);
    await waitForQuoteAutosave(page);

    await submitForApproval(page);
    await expectApprovalBypassApplied(page);

    await expect(page.getByRole("button", { name: /^Approved$/ })).toBeVisible();
    await expect(page.getByText(/pending_approval/i)).toHaveCount(0);
  });
});
