#!/usr/bin/env bun
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
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
const artifactDir = resolve(repoRoot, "test-results", "intellidealer-production-smoke");
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

const company = await resolveImportedCompany();
const contact = await resolveImportedContact(company.id);
const session = await resolveBrowserSession();
const evidence = [];

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await injectAuth(desktop, session);
  await smokeAccountIntelliDealerTab(desktop, company, "desktop");
  await smokeCompanyLegacySearch(desktop, company);
  await smokeCompanyEditorProfile(desktop, company);
  await smokeContactEditorProfile(desktop, contact);
  await smokeAdminDashboard(desktop);
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await injectAuth(mobile, session);
  await smokeAccountIntelliDealerTab(mobile, company, "mobile");
  await mobile.close();
} finally {
  await browser.close().catch(() => {});
}

console.log(JSON.stringify({ verdict: "PASS", company, evidence }, null, 2));

async function resolveImportedCompany() {
  const explicitCompanyId = process.env.INTELLIDEALER_SMOKE_COMPANY_ID;
  if (explicitCompanyId) {
    const { data, error } = await adminClient
      .from("qrm_companies")
      .select("id, name, legacy_customer_number")
      .eq("id", explicitCompanyId)
      .maybeSingle();
    if (error || !data) throw new Error(`Could not load explicit smoke company: ${error?.message ?? "not found"}`);
    return data;
  }

  const { data, error } = await adminClient
    .from("qrm_customer_profitability_import_facts")
    .select("company_id, qrm_companies!inner(id, name, legacy_customer_number)")
    .eq("area_code", "T")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (error || !data?.qrm_companies) {
    throw new Error(`Could not resolve imported smoke company: ${error?.message ?? "no imported company"}`);
  }

  return data.qrm_companies;
}

async function resolveImportedContact(companyId) {
  const { data, error } = await adminClient
    .from("qrm_contacts")
    .select("id, first_name, last_name, metadata")
    .eq("primary_company_id", companyId)
    .eq("metadata->>source_system", "intellidealer")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Could not resolve imported smoke contact: ${error?.message ?? "no imported contact"}`);
  }

  return {
    id: data.id,
    name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim(),
    source_customer_number: data.metadata?.source_customer_number ?? null,
    source_contact_number: data.metadata?.source_contact_number ?? null,
  };
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
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.email) {
    throw new Error(`Could not resolve audit user email: ${error?.message ?? "no admin profile email"}`);
  }
  return data.email;
}

async function injectAuth(context, session) {
  const projectRefFromUrl = new URL(supabaseUrl).hostname.split(".")[0];
  await context.addInitScript(
    ({ storageKey, authSession }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(authSession));
    },
    { storageKey: `sb-${projectRefFromUrl}-auth-token`, authSession: session },
  );
}

async function smokeAccountIntelliDealerTab(context, company, label) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${productionUrl}/qrm/accounts/${company.id}/command`, {
    waitUntil: "networkidle",
    timeout: 45_000,
  });
  await page.getByRole("tab", { name: "IntelliDealer" }).click();
  await page.getByText("IntelliDealer source identity", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("A/R exposure", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("Next best action", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("Contact coverage", { exact: false }).first().waitFor({ timeout: 20_000 });
  await page.getByText("A/R agency assignments", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("Imported profitability", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("Memo history", { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Show period detail" }).click({ force: true });
  await page.getByText("Current month sales", { exact: false }).first().waitFor({ timeout: 20_000 });
  await page.getByText("Fiscal LY sales", { exact: false }).first().waitFor({ timeout: 20_000 });
  const redactedCardRows = page.getByText("Card redacted", { exact: false });
  await redactedCardRows.first().waitFor({ timeout: 20_000 });

  const bodyText = await page.locator("body").innerText();
  if (/REDACTED:[a-f0-9]{64}/i.test(bodyText)) {
    throw new Error("UI leaked a stored card redaction token.");
  }

  const screenshot = resolve(artifactDir, `account-intellidealer-${label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const bytes = statSync(screenshot).size;
  if (bytes < 10_000) throw new Error(`${screenshot} looked blank (${bytes} bytes).`);

  evidence.push({
    check: `browser.account_intellidealer.${label}`,
    route: `/qrm/accounts/${company.id}/command`,
    screenshot,
    bytes,
    redacted_card_rows_visible: await redactedCardRows.count(),
    console_errors: consoleErrors.slice(0, 5),
  });
  await page.close();
}

async function smokeAdminDashboard(context) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${productionUrl}/admin/intellidealer-imports`, {
    waitUntil: "networkidle",
    timeout: 45_000,
  });
  await page.getByText("IntelliDealer Customer Import", { exact: false }).waitFor({ timeout: 20_000 });
  try {
    await page.getByText("Stage count match", { exact: false }).waitFor({ timeout: 20_000 });
  } catch (error) {
    const screenshot = resolve(artifactDir, "admin-intellidealer-imports-failure.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    const bodyText = (await page.locator("body").innerText()).slice(0, 2000);
    throw new Error(`Admin dashboard did not render reconciliation cards. Screenshot: ${screenshot}. Body: ${bodyText}`);
  }
  await page.getByText("A/R card redaction", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("Source fingerprint", { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText("Operational readiness", { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText("SHA-256 hash", { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByRole("cell", { name: "Customer master", exact: true }).waitFor({ timeout: 20_000 });
  await page.getByRole("columnheader", { name: "Delta", exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText("No import errors recorded", { exact: false }).waitFor({ timeout: 20_000 });

  const screenshot = resolve(artifactDir, "admin-intellidealer-imports.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  const bytes = statSync(screenshot).size;
  if (bytes < 10_000) throw new Error(`${screenshot} looked blank (${bytes} bytes).`);

  evidence.push({
    check: "browser.admin_intellidealer_imports",
    route: "/admin/intellidealer-imports",
    screenshot,
    bytes,
    console_errors: consoleErrors.slice(0, 5),
  });
  await page.close();
}

async function smokeCompanyLegacySearch(context, company) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${productionUrl}/qrm/companies`, {
    waitUntil: "networkidle",
    timeout: 45_000,
  });
  await page.locator("#crm-companies-search").fill(company.legacy_customer_number);
  await page.getByText(company.name, { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText(`IntelliDealer ${company.legacy_customer_number}`, { exact: false }).waitFor({ timeout: 20_000 });

  const screenshot = resolve(artifactDir, "companies-legacy-search.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  const bytes = statSync(screenshot).size;
  if (bytes < 10_000) throw new Error(`${screenshot} looked blank (${bytes} bytes).`);

  evidence.push({
    check: "browser.companies_legacy_search",
    route: "/qrm/companies",
    search: company.legacy_customer_number,
    screenshot,
    bytes,
    console_errors: consoleErrors.slice(0, 5),
  });
  await page.close();
}

async function smokeCompanyEditorProfile(context, company) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${productionUrl}/qrm/companies/${company.id}`, {
    waitUntil: "networkidle",
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "Edit Company" }).click();
  await page.getByRole("heading", { name: "Edit company" }).waitFor({ timeout: 20_000 });
  await page.getByText("IntelliDealer operating profile", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("Imported source", { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText(company.legacy_customer_number, { exact: true }).waitFor({ timeout: 20_000 });
  await page.locator("#crm-company-product-category").waitFor({ timeout: 20_000 });
  await page.locator("#crm-company-ar-type").waitFor({ timeout: 20_000 });
  await page.locator("#crm-company-do-not-contact").waitFor({ timeout: 20_000 });
  await page.locator("#crm-company-opt-out-sale-pi").waitFor({ timeout: 20_000 });

  const bodyText = await page.locator("body").innerText();
  if (/REDACTED:[a-f0-9]{64}/i.test(bodyText)) {
    throw new Error("Company editor leaked a stored card redaction token.");
  }

  const screenshot = resolve(artifactDir, "company-editor-intellidealer-profile.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  const bytes = statSync(screenshot).size;
  if (bytes < 10_000) throw new Error(`${screenshot} looked blank (${bytes} bytes).`);

  evidence.push({
    check: "browser.company_editor_intellidealer_profile",
    route: `/qrm/companies/${company.id}`,
    screenshot,
    bytes,
    console_errors: consoleErrors.slice(0, 5),
  });
  await page.close();
}

async function smokeContactEditorProfile(context, contact) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${productionUrl}/qrm/contacts/${contact.id}`, {
    waitUntil: "networkidle",
    timeout: 45_000,
  });
  if (contact.name) {
    await page.getByText(contact.name, { exact: false }).waitFor({ timeout: 20_000 });
  }
  await page.getByRole("button", { name: "Edit Contact" }).click();
  await page.getByRole("heading", { name: "Edit contact" }).waitFor({ timeout: 20_000 });
  await page.getByText("IntelliDealer contact profile", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByText("Imported source", { exact: true }).waitFor({ timeout: 20_000 });
  if (contact.source_customer_number) {
    await page.getByText(contact.source_customer_number, { exact: true }).waitFor({ timeout: 20_000 });
  }
  if (contact.source_contact_number) {
    await page.getByText(contact.source_contact_number, { exact: true }).waitFor({ timeout: 20_000 });
  }
  await page.locator("#crm-contact-cell").waitFor({ timeout: 20_000 });
  await page.locator("#crm-contact-direct-phone").waitFor({ timeout: 20_000 });
  await page.locator("#crm-contact-birth-date").waitFor({ timeout: 20_000 });
  await page.locator("#crm-contact-sms-opt-in").waitFor({ timeout: 20_000 });

  const bodyText = await page.locator("body").innerText();
  if (/raw_row/i.test(bodyText)) {
    throw new Error("Contact editor exposed raw imported row metadata.");
  }

  const screenshot = resolve(artifactDir, "contact-editor-intellidealer-profile.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  const bytes = statSync(screenshot).size;
  if (bytes < 10_000) throw new Error(`${screenshot} looked blank (${bytes} bytes).`);

  evidence.push({
    check: "browser.contact_editor_intellidealer_profile",
    route: `/qrm/contacts/${contact.id}`,
    contact: contact.name,
    screenshot,
    bytes,
    console_errors: consoleErrors.slice(0, 5),
  });
  await page.close();
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
