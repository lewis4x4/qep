import { expect, test } from "@playwright/test";

/**
 * Bootstrap e2e — proves /quote-v2 is wired and auth gating works.
 * Unauthenticated users see login; authenticated reps see the wizard shell.
 */
test.describe("quote builder route", () => {
  test("unauthenticated visit is gated behind login", async ({ page }) => {
    await page.goto("/quote-v2");
    await expect(page.getByRole("heading", { name: "Quote Builder" })).not.toBeVisible();
    await expect(page.getByLabel("Email address").first()).toBeVisible();
    await expect(page.locator("#login-button")).toBeVisible();
  });
});
