import { expect, test } from "@playwright/test";

import { playwrightTestCredentials, signInWithPassword } from "./helpers/auth";

const credentials = playwrightTestCredentials();

test.describe("quote wizard step navigation", () => {
  test.skip(!credentials, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD for authenticated e2e");

  test.beforeEach(async ({ page }) => {
    await signInWithPassword(page, credentials!.email, credentials!.password);
    await page.goto("/quote-v2");
    await expect(page.getByRole("heading", { name: "Quote Builder" })).toBeVisible();
  });

  test("wizard progress rail jumps forward and back without losing the shell", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 2, name: /Step 1:/i })).toBeVisible();

    await page.getByRole("button", { name: /Quote for prospect/i }).click();
    await page.getByRole("button", { name: /Equipment/i }).click();

    await expect(page.getByRole("heading", { level: 2, name: /Step 2:/i })).toBeVisible();

    await page.getByRole("button", { name: "1. Customer: editable step" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /Step 1:/i })).toBeVisible();
  });
});
