import type { Page } from "@playwright/test";

export function playwrightTestCredentials(): { email: string; password: string } | null {
  const email = process.env.PLAYWRIGHT_TEST_EMAIL?.trim();
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export async function signInWithPassword(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.locator("#email-pw").fill(email);
  await page.locator("#password").fill(password);

  const passwordGrant = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/v1/token") &&
      response.url().includes("grant_type=password") &&
      response.status() >= 200 &&
      response.status() < 300,
    { timeout: 30_000 },
  );

  await page.locator("#login-button").click();
  await passwordGrant;
  await page.waitForFunction(
    () =>
      Object.keys(window.localStorage).some(
        (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
      ),
    undefined,
    { timeout: 30_000 },
  );
}
