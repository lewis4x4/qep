import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, "../..");
const viteEnv = loadEnv("development", repoRoot, "");

const defaultPort = process.env.PLAYWRIGHT_PORT ?? "4173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${defaultPort}`;
const webServerUrl = new URL(baseURL);
const webServerPort = webServerUrl.port || (webServerUrl.protocol === "https:" ? "443" : "80");
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1" || process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";

/** Same fallbacks as apps/web/test-setup/env-vars.ts — lets the Vite dev server boot without a local .env. */
const supabaseUrl =
  process.env.VITE_SUPABASE_URL ??
  viteEnv.VITE_SUPABASE_URL ??
  "http://test-supabase.local";
const supabaseAnonKey =
  process.env.VITE_SUPABASE_ANON_KEY ??
  viteEnv.VITE_SUPABASE_ANON_KEY ??
  "test-anon-key-not-real";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: `bun run dev --host 127.0.0.1 --port ${webServerPort}`,
        url: baseURL,
        reuseExistingServer,
        timeout: 120_000,
        env: {
          ...process.env,
          VITE_SUPABASE_URL: supabaseUrl,
          VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
        },
      },
});
