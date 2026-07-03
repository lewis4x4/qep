import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "722_a61_bundle_lighthouse_hardening_closeout.sql");
const rootPackage = JSON.parse(readText("package.json"));
const appPackage = JSON.parse(readText("apps", "web", "package.json"));
const bundleLimits = JSON.parse(readText("apps", "web", "bundle-size-limits.json"));
const bundleCheck = readText("scripts", "check-web-bundle-size.mjs");
const viteConfig = readText("apps", "web", "vite.config.ts");
const lighthouseConfig = readText("apps", "web", ".lighthouserc.cjs");
const lighthouseAuthSetup = readText("apps", "web", "scripts", "lighthouse-auth-setup.mjs");
const lighthousePuppeteerAuth = readText("apps", "web", "scripts", "lighthouse-puppeteer-auth.cjs");
const ciWorkflow = readText(".github", "workflows", "ci.yml");
const lighthouseWorkflow = readText(".github", "workflows", "lighthouse-mobile.yml");

describe("722_a61_bundle_lighthouse_hardening_closeout.sql contract", () => {
  it("marks only A6.1 shipped without a blocker", () => {
    const sql = compact(closeoutSql);

    expect(sql).toContain("where task_id = 'a6.1'");
    expect(sql).toContain("set ship_state = 'shipped'");
    expect(sql).toContain("blocking_decision = null");
    expect(sql).not.toContain("where task_id = 'a5.10'");
    expect(sql).not.toContain("where task_id = 'a7.1'");
  });

  it("records bundle and Lighthouse evidence with honest live-run boundaries", () => {
    const sql = compact(closeoutSql);

    expect(sql).toContain("bundle-size-limits.json");
    expect(sql).toContain("check-web-bundle-size.mjs");
    expect(sql).toContain(".lighthouserc.cjs");
    expect(sql).toContain("lighthouse-mobile.yml");
    expect(sql).toContain("mission_alignment");
    expect(sql).toContain("authenticated salesshell audits require playwright_test_email");
    expect(sql).toContain("performance and accessibility are tracked as warnings");
  });

  it("keeps root and app package scripts wired to the same guards", () => {
    expect(rootPackage.scripts["bundle:check"]).toBe("node ./scripts/check-web-bundle-size.mjs");
    expect(appPackage.scripts["bundle:check"]).toBe("node ../../scripts/check-web-bundle-size.mjs");
    expect(appPackage.scripts["lighthouse:mobile"]).toBe("lhci autorun --config=.lighthouserc.cjs");
    expect(appPackage.scripts["lighthouse:auth-setup"]).toBe("node ./scripts/lighthouse-auth-setup.mjs");
    expect(appPackage.scripts["lighthouse:mobile:authed"]).toContain("LHCI_AUTHENTICATED=true");
  });

  it("enforces the index-entry budget at baseline plus ten percent", () => {
    expect(bundleLimits.baselineBytes).toBeGreaterThan(0);
    expect(bundleLimits.indexEntryMaxBytes).toBe(Math.ceil(bundleLimits.baselineBytes * 1.1));
    expect(bundleLimits.note).toContain("baseline + 10%");

    const script = compact(bundleCheck);
    expect(script).toContain("apps/web/dist/assets");
    expect(script).toContain("bundle-size-limits.json");
    expect(script).toContain("indexentrymaxbytes");
    expect(script).toContain("run apps/web production build first");
    expect(script).toContain("exceeds limit");
  });

  it("preserves manual vendor chunks and keeps heavy libraries off the initial path", () => {
    for (const chunk of ["vendor-react-query", "vendor-supabase", "vendor-ui", "vendor-markdown", "vendor-maplibre"]) {
      expect(viteConfig).toContain(chunk);
    }

    expect(viteConfig).toContain("maplibre-gl (~1MB raw / ~280KB gzip) — only loads on map routes");
    expect(viteConfig).toContain("@react-pdf/renderer (~1.55MB raw / ~517KB gzip) — only loads when");
    expect(viteConfig).toContain("chunkSizeWarningLimit: 1600");
    expect(viteConfig).toContain("visualizer({");
  });

  it("locks mobile Lighthouse route coverage and assertions", () => {
    for (const route of [
      "/sales/today",
      "/sales/pipeline",
      "/sales/customers",
      "/sales/quotes",
      "/sales/quotes/new",
      "/sales/field-note",
      "/sales/voice-quote",
      "/sales/my-mirror",
    ]) {
      expect(lighthouseConfig).toContain(route);
    }

    expect(lighthouseConfig).toContain('formFactor: "mobile"');
    expect(lighthouseConfig).toContain("width: 390");
    expect(lighthouseConfig).toContain("height: 844");
    expect(lighthouseConfig).toContain('"cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }]');
    expect(lighthouseConfig).toContain('"categories:performance"');
    expect(lighthouseConfig).toContain('"first-contentful-paint"');
    expect(lighthouseConfig).toContain('"largest-contentful-paint"');
    expect(lighthouseConfig).toContain('"total-blocking-time"');
  });

  it("keeps authenticated Lighthouse setup guarded by a signed-in sales canary", () => {
    expect(lighthouseAuthSetup).toContain('const AUTH_CANARY_PATH = "/sales/today"');
    expect(lighthouseAuthSetup).toContain('page.locator(\'[data-testid="sales-shell"]\')');
    expect(lighthouseAuthSetup).toContain("waitForSupabasePasswordGrant");
    expect(lighthouseAuthSetup).toContain("waitForStoredSupabaseAuthToken");
    expect(lighthouseAuthSetup).toContain(".lighthouse-storage-state.json");

    expect(lighthousePuppeteerAuth).toContain("storage state not found");
    expect(lighthousePuppeteerAuth).toContain("page.setCookie");
    expect(lighthousePuppeteerAuth).toContain("window.localStorage.setItem");
    expect(lighthousePuppeteerAuth).toContain("window.sessionStorage.setItem");
  });

  it("keeps CI and deploy-preview Lighthouse coverage active", () => {
    expect(ciWorkflow).toContain("Build (full gate)");
    expect(ciWorkflow).toContain("Web bundle size guard (index entry)");
    expect(ciWorkflow).toContain("bun run bundle:check");

    expect(lighthouseWorkflow).toContain("name: Lighthouse Mobile");
    expect(lighthouseWorkflow).toContain('paths:\n      - "apps/web/**"');
    expect(lighthouseWorkflow).toContain("deploy-preview-{0}--qualityequipmentparts.netlify.app");
    expect(lighthouseWorkflow).toContain("Wait for deploy preview");
    expect(lighthouseWorkflow).toContain("Capture + verify authenticated sales storage state");
    expect(lighthouseWorkflow).toContain("Lighthouse — authenticated mobile run");
    expect(lighthouseWorkflow).toContain("Lighthouse — guest fallback when no credentials");
    expect(lighthouseWorkflow).toContain("::warning::Running Lighthouse against guest routes only");
  });
});
