#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..", "..");
loadLocalEnv(repoRoot);

const productionUrl = trimTrailingSlash(
  process.env.QRM_PRODUCTION_URL ??
    process.env.INTELLIDEALER_PRODUCTION_URL ??
    process.env.FLOOR_PRODUCTION_URL ??
    "https://qualityequipmentparts.netlify.app",
);
const artifactDir = resolve(repoRoot, "test-results", "qrm-follow-up-sequence-production-smoke");
mkdirSync(artifactDir, { recursive: true });

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Requires SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const session = await resolveBrowserSession();
const runKey = `codex-sequence-${Date.now()}`;
const createName = `Codex RPC Smoke ${runKey}`;
const updatedName = `${createName} Updated`;
const updatedDescription = `Updated by production smoke ${runKey}`;
const createdIds = new Set();
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

  await page.goto(`${productionUrl}/admin/sequences`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByRole("heading", { name: "QRM Sequences", exact: true }).waitFor({ timeout: 20_000 });

  await page.getByRole("button", { name: "New sequence", exact: true }).click();
  await page.getByRole("heading", { name: "New sequence", exact: true }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Create sequence", exact: true }).waitFor({ timeout: 20_000 });
  await page.locator("#crm-sequence-name").fill(createName);
  await page.locator("#crm-sequence-description").fill("");
  await page.locator('input[inputmode="numeric"]').first().fill("2");
  await page.getByPlaceholder("Checking in on your quote").fill("Initial smoke subject");
  await page.getByPlaceholder("Use {{contact_name}}, {{deal_name}}, and {{rep_name}} where needed.")
    .fill("Initial smoke body");
  await page.getByRole("button", { name: "Create sequence", exact: true }).click();

  const created = await waitForSequenceByName(createName);
  createdIds.add(created.id);
  const createdCard = page.locator(".rounded-xl", { hasText: createName }).first();
  await createdCard.waitFor({ timeout: 60_000 });
  let steps = await loadSteps(created.id);
  const createChecks = [
    check("created sequence row", Boolean(created.id), created.id),
    check("create omitted description stored null", created.description === null, String(created.description)),
    check("create kept active flag", created.is_active === true, String(created.is_active)),
    check("create step count", steps.length === 1, String(steps.length)),
    check("create step offset", steps[0]?.day_offset === 2, String(steps[0]?.day_offset)),
    check("create step subject", steps[0]?.subject === "Initial smoke subject", String(steps[0]?.subject)),
  ];

  await createdCard.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("heading", { name: "Edit sequence", exact: true }).waitFor({ timeout: 20_000 });
  await page.locator("#crm-sequence-name").waitFor({ timeout: 20_000 });
  await page.locator("#crm-sequence-name").fill(updatedName);
  await page.locator("#crm-sequence-description").fill(updatedDescription);
  await page.locator('input[inputmode="numeric"]').first().fill("4");
  await page.getByPlaceholder("Checking in on your quote").fill("Updated smoke subject");
  await page.getByPlaceholder("Use {{contact_name}}, {{deal_name}}, and {{rep_name}} where needed.")
    .fill("Updated smoke body");
  await page.getByRole("button", { name: "Save sequence", exact: true }).click();

  const updated = await waitForSequenceUpdate(created.id, updatedName);
  await page.getByText(updatedName, { exact: true }).waitFor({ timeout: 60_000 });
  steps = await loadSteps(created.id);
  const updateChecks = [
    check("updated same sequence", updated.id === created.id, `${updated.id} vs ${created.id}`),
    check("update saved name", updated.name === updatedName, updated.name),
    check("update saved description", updated.description === updatedDescription, String(updated.description)),
    check("update replaced steps", steps.length === 1, String(steps.length)),
    check("update step offset", steps[0]?.day_offset === 4, String(steps[0]?.day_offset)),
    check("update step subject", steps[0]?.subject === "Updated smoke subject", String(steps[0]?.subject)),
    check("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | ")),
    check("no 5xx responses", responseErrors.length === 0, JSON.stringify(responseErrors.slice(0, 3))),
  ];

  const screenshot = resolve(artifactDir, "qrm-follow-up-sequence-production-smoke.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.close();
  await context.close();

  const checks = [...createChecks, ...updateChecks];
  const failed = checks.filter((item) => !item.ok);
  if (failed.length > 0) {
    throw new Error(JSON.stringify({ verdict: "FAIL", sequence_id: created.id, checks }, null, 2));
  }

  console.log(JSON.stringify({
    verdict: "PASS",
    sequence_id: created.id,
    screenshot,
    checks,
    console_errors: consoleErrors.slice(0, 5),
    response_errors: responseErrors.slice(0, 10),
  }, null, 2));
} catch (error) {
  if (page) {
    const screenshot = resolve(artifactDir, "qrm-follow-up-sequence-production-smoke-failure.png");
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    const bodyText = await page.locator("body").innerText().catch(() => "");
    console.error(JSON.stringify({
      verdict: "FAIL",
      created_ids: [...createdIds],
      screenshot,
      body: bodyText.slice(0, 3000),
      console_errors: consoleErrors.slice(0, 10),
      response_errors: responseErrors.slice(0, 10),
    }, null, 2));
  }
  throw error;
} finally {
  await browser.close().catch(() => {});
  await cleanupCreatedSequences([...createdIds]);
  await cleanupNamedSequences([createName, updatedName]);
}

async function resolveBrowserSession() {
  const email = process.env.QRM_AUDIT_EMAIL ?? process.env.INTELLIDEALER_AUDIT_EMAIL ?? process.env.FLOOR_AUDIT_EMAIL ?? process.env.QEP_AUDIT_EMAIL;
  const password = process.env.QRM_AUDIT_PASSWORD ?? process.env.INTELLIDEALER_AUDIT_PASSWORD ?? process.env.FLOOR_AUDIT_PASSWORD ?? process.env.QEP_AUDIT_PASSWORD;
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
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.email) {
    throw new Error(`Could not resolve audit user email: ${error?.message ?? "no admin profile email"}`);
  }
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

async function loadSequence(id) {
  const { data, error } = await adminClient
    .from("follow_up_sequences")
    .select("id, name, description, trigger_stage, is_active, created_by")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error(`Could not load sequence ${id}: ${error?.message ?? "not found"}`);
  return data;
}

async function loadSequenceByName(name) {
  const { data, error } = await adminClient
    .from("follow_up_sequences")
    .select("id, name, description, trigger_stage, is_active, created_by")
    .eq("name", name)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`Could not load sequence ${name}: ${error?.message ?? "not found"}`);
  return data;
}

async function waitForSequenceByName(name) {
  return retry(() => loadSequenceByName(name), `load sequence ${name}`);
}

async function waitForSequenceUpdate(id, expectedName) {
  return retry(async () => {
    const sequence = await loadSequence(id);
    if (sequence.name !== expectedName) throw new Error(`found ${sequence.name}`);
    return sequence;
  }, `load updated sequence ${id}`);
}

async function loadSteps(sequenceId) {
  const { data, error } = await adminClient
    .from("follow_up_steps")
    .select("id, sequence_id, step_number, day_offset, step_type, subject, body_template, task_priority")
    .eq("sequence_id", sequenceId)
    .order("step_number", { ascending: true });
  if (error) throw new Error(`Could not load steps for ${sequenceId}: ${error.message}`);
  return data ?? [];
}

async function retry(operation, label, attempts = 40) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 750));
  }
  throw new Error(`Could not ${label}: ${lastError?.message ?? String(lastError)}`);
}

async function cleanupCreatedSequences(ids) {
  if (ids.length === 0) return;
  const { error } = await adminClient.from("follow_up_sequences").delete().in("id", ids);
  if (error) throw new Error(`Could not cleanup follow-up sequences: ${error.message}`);
}

async function cleanupNamedSequences(names) {
  const { data, error } = await adminClient
    .from("follow_up_sequences")
    .select("id")
    .in("name", names);
  if (error || !data || data.length === 0) return;
  await cleanupCreatedSequences(data.map((row) => row.id));
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, "");
}
