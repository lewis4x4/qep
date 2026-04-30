#!/usr/bin/env bun
import { existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..", "..");
loadLocalEnv(repoRoot);

const productionUrl = trimTrailingSlash(
  process.env.INTELLIDEALER_PRODUCTION_URL ??
    process.env.FLOOR_PRODUCTION_URL ??
    "https://qualityequipmentparts.netlify.app",
);
const workbook = resolve(repoRoot, process.argv[2] ?? "docs/IntelliDealer/Customer Master.xlsx");
const artifactDir = resolve(repoRoot, "test-results", "intellidealer-browser-stage-flow");
mkdirSync(artifactDir, { recursive: true });

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Requires SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.");
}
if (!existsSync(workbook)) throw new Error(`Workbook not found: ${workbook}`);

const expectedCounts = {
  master_stage_count: 5_136,
  contacts_stage_count: 4_657,
  contact_memos_stage_count: 1_179,
  ar_agency_stage_count: 19_466,
  profitability_stage_count: 9_894,
};
const stageTables = [
  "qrm_intellidealer_customer_master_stage",
  "qrm_intellidealer_customer_contacts_stage",
  "qrm_intellidealer_customer_contact_memos_stage",
  "qrm_intellidealer_customer_ar_agency_stage",
  "qrm_intellidealer_customer_profitability_stage",
];

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const session = await resolveBrowserSession();
let runId = null;
let storagePath = null;
const consoleErrors = [];
const responseErrors = [];
let page = null;

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await injectAuth(context, session);
  page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      responseErrors.push({ status: response.status(), url: response.url() });
    }
  });

  await page.goto(`${productionUrl}/admin/intellidealer-imports`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByText("Upload preview", { exact: true }).waitFor({ timeout: 20_000 });
  await page.locator('input[type="file"]').setInputFiles(workbook);
  await page.getByText("Preview audit passed", { exact: false }).waitFor({ timeout: 180_000 });

  const previewRun = await loadLatestPreviewRun();
  runId = previewRun.id;
  storagePath = previewRun.metadata?.source_storage_path ?? null;

  await page.getByRole("button", { name: "Stage rows", exact: true }).click();
  await page.getByText("Staging complete", { exact: false }).waitFor({ timeout: 900_000 });

  const screenshot = resolve(artifactDir, "browser-stage-flow.png");
  await page.screenshot({ path: screenshot, fullPage: true });

  const run = await loadDashboardRun(runId);
  const checks = [
    check("run reached staged status", run.status === "staged", run.status),
    check("source file name matches workbook", run.source_file_name === basename(workbook), `${run.source_file_name} vs ${basename(workbook)}`),
    check("metadata no longer preview-only", run.metadata?.preview_only === false, String(run.metadata?.preview_only)),
    ...Object.entries(expectedCounts).map(([key, expected]) => check(key, run[key] === expected, `${run[key]} vs ${expected}`)),
    check("no import errors", run.import_errors_count === 0, String(run.import_errors_count)),
  ];

  const unguardedCommit = await invokeImportAction({ action: "commit", run_id: runId });
  checks.push(check(
    "commit without preflight token rejected",
    unguardedCommit.status === 409 && unguardedCommit.body.includes("preflight token"),
    `${unguardedCommit.status}: ${unguardedCommit.body.slice(0, 160)}`,
  ));

  await page.getByRole("button", { name: "Preflight commit", exact: true }).click();
  await page.getByText("Commit preflight: passed", { exact: false }).waitFor({ timeout: 120_000 });
  await page.getByText("committed run already uses this source file hash", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("Token expires in", { exact: false }).waitFor({ timeout: 20_000 });

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Discard staged", exact: true }).click();
  await page.getByText("Discarded staged run", { exact: false }).waitFor({ timeout: 120_000 });
  const discardedRun = await loadImportRun(runId);
  const remainingStageRows = await countRemainingStageRows(runId);
  checks.push(
    check("discard control marked run cancelled", discardedRun.status === "cancelled", discardedRun.status),
    check("discard control cleared staged rows", remainingStageRows === 0, String(remainingStageRows)),
  );

  await page.close();
  await context.close();

  const failed = checks.filter((item) => !item.ok);
  if (failed.length > 0) {
    throw new Error(JSON.stringify({ verdict: "FAIL", run_id: runId, checks }, null, 2));
  }

  console.log(JSON.stringify({
    verdict: "PASS",
    run_id: runId,
    storage_path: storagePath,
    screenshot,
    checks,
    console_errors: consoleErrors.slice(0, 5),
    response_errors: responseErrors.slice(0, 10),
  }, null, 2));
} catch (error) {
  if (page) {
    const screenshot = resolve(artifactDir, "browser-stage-flow-failure.png");
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    const bodyText = await page.locator("body").innerText().catch(() => "");
    console.error(JSON.stringify({
      verdict: "FAIL",
      run_id: runId,
      storage_path: storagePath,
      screenshot,
      body: bodyText.slice(0, 3000),
      console_errors: consoleErrors.slice(0, 10),
      response_errors: responseErrors.slice(0, 10),
    }, null, 2));
  }
  throw error;
} finally {
  await browser.close().catch(() => {});
  if (runId) await cleanupRun(runId);
  if (storagePath) await cleanupStorage(storagePath);
}

async function resolveBrowserSession() {
  const email = process.env.INTELLIDEALER_AUDIT_EMAIL ?? process.env.FLOOR_AUDIT_EMAIL ?? process.env.QEP_AUDIT_EMAIL;
  const password = process.env.INTELLIDEALER_AUDIT_PASSWORD ?? process.env.FLOOR_AUDIT_PASSWORD ?? process.env.QEP_AUDIT_PASSWORD;
  if (email && password) return signInWithPassword(email, password);
  return signInWithMagicLink(email);
}

async function signInWithPassword(email, password) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Could not sign in audit user: ${error?.message ?? "missing session"}`);
  return data.session;
}

async function signInWithMagicLink(explicitEmail) {
  const email = explicitEmail ?? await resolveAuditEmail();
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    throw new Error(`Could not generate audit login link: ${linkError?.message ?? "missing token"}`);
  }

  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: verifyError } = await publicClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError || !sessionData.session) {
    throw new Error(`Could not verify audit login link: ${verifyError?.message ?? "missing session"}`);
  }
  return sessionData.session;
}

async function resolveAuditEmail() {
  const { data, error } = await adminClient
    .from("profiles")
    .select("email")
    .in("role", ["admin", "manager", "owner"])
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data?.email) throw new Error(`Could not resolve audit email: ${error?.message ?? "not found"}`);
  return data.email;
}

async function injectAuth(context, authSession) {
  const projectRefFromUrl = new URL(supabaseUrl).hostname.split(".")[0];
  await context.addInitScript(
    ({ storageKey, authSession }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(authSession));
    },
    { storageKey: `sb-${projectRefFromUrl}-auth-token`, authSession },
  );
}

async function loadLatestPreviewRun() {
  const { data, error } = await adminClient
    .from("qrm_intellidealer_customer_import_runs")
    .select("id, metadata, created_at")
    .eq("source_file_name", basename(workbook))
    .eq("status", "audited")
    .eq("metadata->>preview_only", "true")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`Could not find latest preview run: ${error?.message ?? "not found"}`);
  return data;
}

async function loadDashboardRun(id) {
  const { data, error } = await adminClient
    .from("qrm_intellidealer_customer_import_dashboard")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error(`Could not load staged dashboard run: ${error?.message ?? "not found"}`);
  return data;
}

async function loadImportRun(id) {
  const { data, error } = await adminClient
    .from("qrm_intellidealer_customer_import_runs")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error(`Could not load import run ${id}: ${error?.message ?? "not found"}`);
  return data;
}

async function countRemainingStageRows(id) {
  let total = 0;
  for (const table of stageTables) {
    const { count } = await withRetry(
      () => adminClient
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("run_id", id),
      `count ${table} for run ${id}`,
    );
    total += count ?? 0;
  }
  return total;
}

async function invokeImportAction(body) {
  const response = await fetch(`${supabaseUrl}/functions/v1/intellidealer-customer-import`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.text(),
  };
}

async function cleanupRun(id) {
  for (const table of ["qrm_intellidealer_customer_import_errors", ...stageTables]) {
    await withRetry(
      () => adminClient
        .from(table)
        .delete()
        .eq("run_id", id),
      `cleanup ${table} for run ${id}`,
    );
  }

  for (const table of stageTables) {
    const { count } = await withRetry(
      () => adminClient
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("run_id", id),
      `verify cleanup for ${table}`,
    );
    if (count !== 0) throw new Error(`Cleanup left ${count} rows in ${table} for run ${id}`);
  }

  await withRetry(
    () => adminClient
      .from("qrm_intellidealer_customer_import_runs")
      .delete()
      .eq("id", id),
    `cleanup import run ${id}`,
  );
}

async function cleanupStorage(fullPath) {
  if (!fullPath.startsWith("intellidealer-customer-imports/")) return;
  const objectPath = fullPath.slice("intellidealer-customer-imports/".length);
  const { error } = await adminClient.storage.from("intellidealer-customer-imports").remove([objectPath]);
  if (error) throw new Error(`Could not cleanup uploaded workbook ${objectPath}: ${error.message}`);
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

async function withRetry(operation, label, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      if (!result?.error) return result;
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(750 * attempt);
  }
  throw new Error(`Could not ${label}: ${formatError(lastError)}`);
}

function formatError(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  return JSON.stringify(error);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, "");
}
