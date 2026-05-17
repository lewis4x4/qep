import { expect, type Page } from "@playwright/test";

/** CRM equipment UUID with `received_at` old enough for workspace bypass rules (365+ days). */
export function playwrightAgedEquipmentId(): string | null {
  const id = process.env.PLAYWRIGHT_AGED_EQUIPMENT_ID?.trim();
  return id && id.length > 0 ? id : null;
}

export async function expectWizardStep(page: Page, stepNumber: number): Promise<void> {
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`Step ${stepNumber}:`, "i") })).toBeVisible();
}

export async function startProspectQuote(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Quote for prospect/i }).click();
  await expect(page.getByText(/Walk-in prospect/i).first()).toBeVisible({ timeout: 15_000 });
}

export async function clickWizardProgressPill(page: Page, stepId: string): Promise<void> {
  await page.getByTestId(`wizard-progress-${stepId}`).click();
}

export async function advanceWizardNext(page: Page, label: string): Promise<void> {
  const progress = page.getByRole("button", { name: new RegExp(`\\. ${escapeRegExp(label)}:`, "i") });
  if (await progress.first().isVisible().catch(() => false)) {
    await progress.first().click();
    return;
  }
  await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}`, "i") }).last().click();
}

export async function clickStepFooterNext(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole("button", { name }).click();
}

export async function waitForQuoteAutosave(page: Page): Promise<void> {
  await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 120_000 });
}

export async function selectFirstCatalogEquipment(page: Page): Promise<void> {
  const catalogButtons = page.locator(".max-h-\\[420px\\] button");
  await expect(catalogButtons.first()).toBeVisible({ timeout: 90_000 });

  const inStock = catalogButtons.filter({ hasText: "In stock" });
  if ((await inStock.count()) > 0) {
    await inStock.first().click();
  } else {
    await catalogButtons.first().click();
    const availabilityCheck = page.getByRole("button", { name: "Request availability check" });
    if (await availabilityCheck.isVisible().catch(() => false)) {
      await availabilityCheck.click();
    }
  }

  await expect(page.getByRole("button", { name: /^Configure/i })).toBeEnabled({ timeout: 90_000 });
}

export async function fillWhyThisMachine(page: Page): Promise<void> {
  await page.getByPlaceholder(/Explain why this unit fits/i).fill(
    "E2E: selected for job fit, terrain, and delivery timeline.",
  );
  await page.getByRole("checkbox", { name: /I reviewed this language/i }).check();
}

export async function selectFirstQuotingBranch(page: Page): Promise<void> {
  const branchSelect = page.locator("select").filter({
    has: page.locator("option", { hasText: "Select quoting branch" }),
  });
  await expect(branchSelect).toBeVisible({ timeout: 30_000 });
  const options = branchSelect.locator("option");
  const count = await options.count();
  for (let index = 1; index < count; index += 1) {
    const value = await options.nth(index).getAttribute("value");
    if (value) {
      await branchSelect.selectOption(value);
      return;
    }
  }
  throw new Error("No quoting branch options available for e2e");
}

export async function submitForApproval(page: Page): Promise<void> {
  const submit = page.getByRole("button", { name: /Submit for approval/i });
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await submit.click();
}

export async function expectApprovalBypassApplied(page: Page): Promise<void> {
  await expect(page.getByText("Auto-approved")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Approval bypass applied/i)).toBeVisible();
  await expect(page.getByText("Approval Case", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Waiting on .+ to approve this quote/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Approval pending/i })).toHaveCount(0);
}

export async function ensureApprovalForCustomerFacing(page: Page): Promise<void> {
  const submit = page.getByRole("button", { name: /Submit for approval/i });
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  }

  await expect
    .poll(async () => {
      if (await page.getByText("Auto-approved").isVisible().catch(() => false)) return "auto";
      const approvedButton = page.getByRole("button", { name: /^Approved$/ });
      if (await approvedButton.isVisible().catch(() => false)) return "approved";
      const pending = page.getByRole("button", { name: /Approval pending/i });
      if (await pending.isVisible().catch(() => false)) return "pending";
      return "waiting";
    }, { timeout: 120_000 })
    .not.toBe("waiting");
}

export async function walkFromEquipmentToReview(page: Page): Promise<void> {
  await expectWizardStep(page, 2);
  await expect(page.getByRole("button", { name: /^Configure/i })).toBeEnabled({ timeout: 90_000 });
  await clickStepFooterNext(page, /^Configure/i);

  await expectWizardStep(page, 3);
  await clickStepFooterNext(page, /^Trade-in/i);

  await expectWizardStep(page, 4);
  await clickStepFooterNext(page, /^Pricing/i);

  await expectWizardStep(page, 5);
  await clickStepFooterNext(page, /^Promotions/i);

  await expectWizardStep(page, 6);
  await clickStepFooterNext(page, /^Financing/i);

  await expectWizardStep(page, 7);
  await page.getByRole("button", { name: "Cash" }).click();
  await clickStepFooterNext(page, /^Quote details/i);

  await expectWizardStep(page, 8);
  await fillWhyThisMachine(page);
  await clickStepFooterNext(page, /^Review/i);
  await expectWizardStep(page, 9);
}

export async function walkProspectQuoteToReview(page: Page): Promise<void> {
  await expectWizardStep(page, 1);
  await startProspectQuote(page);
  await selectFirstQuotingBranch(page);
  await advanceWizardNext(page, "Equipment");
  await selectFirstCatalogEquipment(page);
  await walkFromEquipmentToReview(page);
}

export async function generateDocumentPreview(page: Page): Promise<void> {
  const generate = page.getByRole("button", { name: "Generate Preview PDF" });
  await expect(generate).toBeEnabled({ timeout: 60_000 });
  await generate.click();
  await expect(page.getByText(/Preview generated|PDF artifact generated/i)).toBeVisible({ timeout: 90_000 });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
