#!/usr/bin/env node
/**
 * CDO gate for The Floor.
 *
 * Runs authenticated desktop/mobile browser checks for /floor, captures
 * screenshots, and executes a lightweight a11y scan. This intentionally
 * fails when auth credentials are missing: the old stub let UI changes pass
 * without seeing the product.
 */
require("./instrument.js");

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const reportPath = "/tmp/qep-design-review-report.json";
const artifactDir = path.join(repoRoot, "test-results", "design-review");
const IGNORED_LOCAL_PREVIEW_CONSOLE_PATTERNS = [
  /floor-narrative/i,
  /net::ERR_FAILED/i,
  /status of 400/i,
  /status of 404/i,
];

main().catch((error) => {
  writeReport({
    gate: "cdo.design-review",
    verdict: "fail",
    mission_alignment: "fail",
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  });
  console.error(error);
  process.exit(1);
});

async function main() {
  const { loadLocalEnv } = await import("./_shared/local-env.mjs");
  loadLocalEnv(repoRoot);

  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    throw new Error("playwright is required. Install with: bun add -d playwright");
  }

  fs.mkdirSync(artifactDir, { recursive: true });
  const { baseUrl, cleanup } = await resolveBaseUrl();
  const browser = await playwright.chromium.launch({ headless: true });
  const consoleErrors = [];
  const artifacts = [];
  const checks = [];

  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await injectAuth(desktop, baseUrl);
    const desktopPage = await desktop.newPage();
    desktopPage.on("console", (msg) => {
      if (msg.type() === "error" && !isIgnoredConsoleError(msg.text(), baseUrl)) {
        consoleErrors.push(msg.text());
      }
    });

    await visitAndAssert({
      page: desktopPage,
      baseUrl,
      route: "/floor",
      screenshotName: "floor-desktop.png",
      requiredText: ["Role Home", "Work Queue"],
      forbiddenText: ["Role preview", "COMPOSE"],
      checks,
      artifacts,
    });
    await runA11yScan(desktopPage, "/floor desktop", checks);

    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await injectAuth(mobile, baseUrl);
    const mobilePage = await mobile.newPage();
    mobilePage.on("console", (msg) => {
      if (msg.type() === "error" && !isIgnoredConsoleError(msg.text(), baseUrl)) {
        consoleErrors.push(msg.text());
      }
    });
    await visitAndAssert({
      page: mobilePage,
      baseUrl,
      route: "/floor",
      screenshotName: "floor-mobile.png",
      requiredText: ["Role Home", "Work Queue"],
      forbiddenText: ["Role preview", "COMPOSE"],
      checks,
      artifacts,
    });
    await runA11yScan(mobilePage, "/floor mobile", checks);
    await mobile.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanup();
  }

  if (consoleErrors.length > 0) {
    checks.push({
      id: "browser.console-errors",
      verdict: "fail",
      detail: consoleErrors.slice(0, 10),
    });
  } else {
    checks.push({ id: "browser.console-errors", verdict: "pass", detail: "zero console errors" });
  }

  const failures = checks.filter((check) => check.verdict === "fail");
  const report = {
    gate: "cdo.design-review",
    verdict: failures.length === 0 ? "pass" : "fail",
    mission_alignment:
      failures.length === 0
        ? "pass: The operator Floor rendered in authenticated desktop and mobile contexts."
        : "fail: The Floor could not be proven visually ready.",
    base_url: baseUrl,
    checks,
    artifacts,
    timestamp: new Date().toISOString(),
  };
  writeReport(report);

  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) process.exit(1);
}

async function resolveBaseUrl() {
  if (process.env.FLOOR_DESIGN_BASE_URL) {
    return { baseUrl: trimTrailingSlash(process.env.FLOOR_DESIGN_BASE_URL), cleanup: async () => {} };
  }

  const port = Number.parseInt(process.env.FLOOR_DESIGN_PREVIEW_PORT ?? "4173", 10);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn("bun", [
    "run",
    "--filter",
    "@qep/web",
    "preview",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  await waitForUrl(baseUrl, 20_000, () => output);
  return {
    baseUrl,
    cleanup: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
  };
}

async function injectAuth(context, baseUrl) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const email = process.env.FLOOR_AUDIT_EMAIL ?? process.env.QEP_AUDIT_EMAIL;
  const password = process.env.FLOOR_AUDIT_PASSWORD ?? process.env.QEP_AUDIT_PASSWORD;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Authenticated Floor design review requires SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const session = email && password
    ? await signInWithPassword(createClient, supabaseUrl, anonKey, email, password)
    : await signInWithServiceMagicLink(createClient, supabaseUrl, anonKey);

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  await context.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    { key: storageKey, session },
  );

  await context.addCookies([
    {
      name: "qep-floor-audit",
      value: "1",
      domain: new URL(baseUrl).hostname,
      path: "/",
      httpOnly: false,
      secure: baseUrl.startsWith("https://"),
      sameSite: "Lax",
    },
  ]);
}

async function signInWithPassword(createClient, supabaseUrl, anonKey, email, password) {
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Could not sign in Floor audit user: ${error?.message ?? "missing session"}`);
  }
  return data.session;
}

async function signInWithServiceMagicLink(createClient, supabaseUrl, anonKey) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Set FLOOR_AUDIT_EMAIL/FLOOR_AUDIT_PASSWORD or SUPABASE_SERVICE_ROLE_KEY for authenticated Floor design review.",
    );
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auditEmail = await resolveAuditEmail(adminClient);
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: auditEmail,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    throw new Error(`Could not generate Floor audit login link: ${linkError?.message ?? "missing token"}`);
  }

  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: verifyError } = await publicClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError || !sessionData.session) {
    throw new Error(`Could not verify Floor audit login link: ${verifyError?.message ?? "missing session"}`);
  }
  return sessionData.session;
}

async function resolveAuditEmail(adminClient) {
  const explicit = process.env.FLOOR_AUDIT_EMAIL ?? process.env.QEP_AUDIT_EMAIL;
  if (explicit) return explicit;
  const { data, error } = await adminClient
    .from("profiles")
    .select("email")
    .in("role", ["admin", "manager", "owner"])
    .not("email", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.email) {
    throw new Error(`Could not resolve an audit user email: ${error?.message ?? "no admin profile email"}`);
  }
  return data.email;
}

async function visitAndAssert({ page, baseUrl, route, screenshotName, requiredText, forbiddenText = [], checks, artifacts }) {
  const url = `${baseUrl}${route}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(750);

  const screenshotPath = path.join(artifactDir, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  artifacts.push(screenshotPath);

  const pathOk = new URL(page.url()).pathname.startsWith(route);
  checks.push({
    id: `route${route}.path`,
    verdict: pathOk ? "pass" : "fail",
    detail: page.url(),
  });

  for (const text of requiredText) {
    const count = await page.getByText(text, { exact: false }).count();
    checks.push({
      id: `route${route}.text.${text}`,
      verdict: count > 0 ? "pass" : "fail",
      detail: `${count} matches`,
    });
  }

  for (const text of forbiddenText) {
    const count = await page.getByText(text, { exact: false }).count();
    checks.push({
      id: `route${route}.forbidden.${text}`,
      verdict: count === 0 ? "pass" : "fail",
      detail: `${count} matches`,
    });
  }

  const stat = fs.statSync(screenshotPath);
  checks.push({
    id: `route${route}.screenshot.${screenshotName}`,
    verdict: stat.size > 10_000 ? "pass" : "fail",
    detail: `${screenshotPath} (${stat.size} bytes)`,
  });
}

async function runA11yScan(page, label, checks) {
  const issues = await page.evaluate(() => {
    const isVisible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const result = [];

    for (const button of Array.from(document.querySelectorAll("button"))) {
      if (!isVisible(button)) continue;
      const labelText = [
        button.textContent?.trim(),
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
      ].filter(Boolean).join(" ").trim();
      if (!labelText) result.push(`button without accessible name: ${button.outerHTML.slice(0, 120)}`);
    }

    for (const input of Array.from(document.querySelectorAll("input, select, textarea"))) {
      if (!isVisible(input) || input.getAttribute("type") === "hidden") continue;
      const id = input.getAttribute("id");
      const hasLabel =
        Boolean(input.getAttribute("aria-label") || input.getAttribute("title")) ||
        Boolean(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
      if (!hasLabel) result.push(`form control without label: ${input.outerHTML.slice(0, 120)}`);
    }

    for (const img of Array.from(document.querySelectorAll("img"))) {
      if (!isVisible(img)) continue;
      if (!img.hasAttribute("alt")) result.push(`image without alt: ${img.outerHTML.slice(0, 120)}`);
    }

    return result;
  });

  checks.push({
    id: `a11y.${label}`,
    verdict: issues.length === 0 ? "pass" : "fail",
    detail: issues,
  });
}

async function waitForUrl(url, timeoutMs, getOutput) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // preview not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}. Preview output:\n${getOutput()}`);
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function writeReport(report) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function isIgnoredConsoleError(text, baseUrl) {
  if (!baseUrl.startsWith("http://127.0.0.1")) return false;
  return IGNORED_LOCAL_PREVIEW_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}
