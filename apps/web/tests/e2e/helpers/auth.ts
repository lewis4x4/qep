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
  await page.locator("#login-button").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}
