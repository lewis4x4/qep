#!/usr/bin/env bun

import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..", "..");
loadLocalEnv(repoRoot);

const siteId = process.env.NETLIFY_SITE_ID ?? "d92f4e0f-33f4-46a8-b2c2-9cce622dbc96";
const projectRef = process.env.SUPABASE_PROJECT_REF ?? "iciddijgonywtxoelous";
const productionUrl = trimTrailingSlash(
  process.env.FLOOR_PRODUCTION_URL ?? "https://qualityequipmentparts.netlify.app",
);
const artifactDir = resolve(repoRoot, "test-results", "floor-production-audit");
mkdirSync(artifactDir, { recursive: true });

const evidence = [];

const head = (await run("git", ["rev-parse", "HEAD"], repoRoot)).stdout.trim();
await verifyNetlify(head);
await verifySupabaseMigrations();
await verifyFloorNarrativeFunction();
await verifyProductionBrowser();

console.log(JSON.stringify({ verdict: "PASS", evidence }, null, 2));

async function verifyNetlify(head) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  const deploys = token
    ? await listNetlifyDeploysWithToken(token)
    : await listNetlifyDeploysWithCli();
  const deploysWithCommits = deploys?.filter((deploy) => deploy.commit_ref)
    ?? [];
  const mainDeploys = deploysWithCommits.filter((deploy) => deploy.context === "production" && deploy.branch === "main")
    ?? deploysWithCommits.filter((deploy) => deploy.branch === "main")
    ?? deploys
    ?? [];
  const latest = mainDeploys[0];
  if (!latest) throw new Error(`Netlify site ${siteId} returned no production deploys.`);

  evidence.push({
    check: "netlify.production_deploy",
    deploy_id: latest.id,
    state: latest.state,
    commit_ref: latest.commit_ref,
    error_message: latest.error_message ?? null,
  });

  if (
    latest.commit_ref === head
    && latest.state === "error"
    && /no content change/i.test(latest.error_message ?? "")
  ) {
    const readyDeploy = mainDeploys.find((deploy) => deploy.state === "ready");
    if (!readyDeploy) {
      throw new Error("Latest Netlify deploy skipped for no content change, but no previous ready production deploy was found.");
    }
    evidence.push({
      check: "netlify.active_content_deploy",
      deploy_id: readyDeploy.id,
      state: readyDeploy.state,
      commit_ref: readyDeploy.commit_ref,
      note: "HEAD produced no publishable app-content change; Netlify left the previous ready production deploy active.",
    });
    return;
  }

  if (latest.state !== "ready") {
    throw new Error(`Latest Netlify deploy is ${latest.state}, expected ready.`);
  }
  if (latest.commit_ref !== head) {
    throw new Error(`Latest Netlify commit_ref ${latest.commit_ref} does not match HEAD ${head}.`);
  }
}

async function listNetlifyDeploysWithToken(token) {
  const response = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Netlify deploy lookup failed: HTTP ${response.status}`);
  return response.json();
}

async function listNetlifyDeploysWithCli() {
  const result = await run("netlify", [
    "api",
    "listSiteDeploys",
    "--data",
    JSON.stringify({ site_id: siteId, per_page: "20" }),
  ], repoRoot);
  return JSON.parse(result.stdout);
}

async function verifySupabaseMigrations() {
  const localVersions = (await run("bash", ["-lc", "ls supabase/migrations/*.sql | sed 's#.*/##; s#_.*##' | sort -n | tail -1"], repoRoot)).stdout.trim();
  const list = await run("supabase", ["migration", "list", "--linked"], repoRoot);
  evidence.push({
    check: "supabase.migrations",
    latest_local_version: localVersions,
    output_excerpt: list.stdout.slice(-2000),
  });
  if (!list.stdout.includes(localVersions)) {
    throw new Error(`Remote migration list does not include latest local version ${localVersions}.`);
  }
}

async function verifyFloorNarrativeFunction() {
  const list = await run("supabase", ["functions", "list", "--project-ref", projectRef], repoRoot);
  evidence.push({
    check: "supabase.functions",
    output_excerpt: list.stdout.slice(-2000),
  });
  if (!/floor-narrative/i.test(list.stdout)) {
    throw new Error("floor-narrative was not found in Supabase functions list.");
  }
}

async function verifyProductionBrowser() {
  const browser = await chromium.launch({ headless: true });
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await injectAuth(desktop);
    const page = await desktop.newPage();
    await smokeRoute(page, "/floor", "floor-production-desktop.png", ["Sales Quote Flow Redesign", "Entry", "Customer", "Equipment", "Trade-In", "Financing", "Review"], ["QEP Role Home", "Role Home", "Work Queue", "Role preview", "View as", "COMPOSE", "NARRATIVE", "ACTIONS"]);
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await injectAuth(mobile);
    const mobilePage = await mobile.newPage();
    await smokeRoute(mobilePage, "/floor", "floor-production-mobile.png", ["Sales Quote Flow Redesign", "Entry", "Customer", "Equipment", "Trade-In", "Financing", "Review"], ["QEP Role Home", "Role Home", "Work Queue", "Role preview", "View as", "COMPOSE", "NARRATIVE", "ACTIONS"]);
    await mobile.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function smokeRoute(page, route, screenshotName, requiredText, forbiddenText = []) {
  await page.goto(`${productionUrl}${route}`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(750);
  const pathname = new URL(page.url()).pathname;
  if (!pathname.startsWith(route)) throw new Error(`${route} redirected to ${page.url()}`);
  for (const text of requiredText) {
    const count = await page.getByText(text, { exact: false }).count();
    if (count === 0) throw new Error(`${route} missing expected text: ${text}`);
  }
  for (const text of forbiddenText) {
    const count = await page.getByText(text, { exact: false }).count();
    if (count > 0) throw new Error(`${route} still contains removed text: ${text}`);
  }
  const screenshotPath = resolve(artifactDir, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const size = statSync(screenshotPath).size;
  if (size < 10_000) throw new Error(`${screenshotPath} looked blank (${size} bytes).`);
  evidence.push({ check: `browser${route}`, screenshot: screenshotPath, bytes: size });
}

async function injectAuth(context) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const email = process.env.FLOOR_AUDIT_EMAIL ?? process.env.QEP_AUDIT_EMAIL;
  const password = process.env.FLOOR_AUDIT_PASSWORD ?? process.env.QEP_AUDIT_PASSWORD;
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Production browser smoke requires SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }

  const session = email && password
    ? await signInWithPassword(supabaseUrl, anonKey, email, password)
    : await signInWithServiceMagicLink(supabaseUrl, anonKey);

  const projectRefFromUrl = new URL(supabaseUrl).hostname.split(".")[0];
  await context.addInitScript(
    ({ storageKey, session }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    },
    { storageKey: `sb-${projectRefFromUrl}-auth-token`, session },
  );
}

async function signInWithPassword(supabaseUrl, anonKey, email, password) {
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Could not sign in Floor audit user: ${error?.message ?? "missing session"}`);
  }
  return data.session;
}

async function signInWithServiceMagicLink(supabaseUrl, anonKey) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Set FLOOR_AUDIT_EMAIL/FLOOR_AUDIT_PASSWORD or SUPABASE_SERVICE_ROLE_KEY for authenticated browser smoke.",
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

async function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
