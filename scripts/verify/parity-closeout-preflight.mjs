#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..", "..");
loadLocalEnv(repoRoot);

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "KB_TEST_ADMIN_TOKEN",
  "KB_TEST_REP_TOKEN",
];

const WORKBOOKS = {
  repo: resolve(repoRoot, "docs/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx"),
  desktop: "/Users/brianlewis/Desktop/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx",
};

const REQUIRED_DOCS = [
  "docs/IntelliDealer/_Manifests/QEP_PARITY_EXTERNAL_DECISION_QUEUE_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_PARITY_REVIEW_AGENT_CLOSEOUT_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_PARITY_VERIFICATION_STATUS_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_EQUIPMENT_REVERSAL_FINANCE_POLICY_PACKET_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_JD_PROVIDER_DECISION_PACKET_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_OEM_BASE_OPTIONS_IMPORT_DECISION_PACKET_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_VESIGN_PROVIDER_DECISION_PACKET_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_TETHR_PROVIDER_DECISION_PACKET_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_SERVICE_MOBILE_UAT_EXECUTION_PACKET_2026-05-04.md",
  "docs/IntelliDealer/_Manifests/QEP_IRONGUIDES_DECISION_PACKET_2026-05-04.md",
];

const checks = [];

checkRequiredEnv();
checkWorkbookCopies();
checkRequiredDocs();

const failed = checks.filter((check) => !check.ok);
const result = {
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  generated_at: new Date().toISOString(),
  checks,
  failed,
  next_commands: [
    "bun run wave5:provider:verify",
    "bun run segment:gates --segment parity-closeout --ui --no-chaos",
  ],
};

console.log(JSON.stringify(result, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}

function checkRequiredEnv() {
  for (const key of REQUIRED_ENV) {
    const present = Boolean(process.env[key]?.trim());
    addCheck(`env present: ${key}`, present, present ? "present" : "missing");
  }
}

function checkWorkbookCopies() {
  const repoExists = existsSync(WORKBOOKS.repo);
  const desktopExists = existsSync(WORKBOOKS.desktop);

  addCheck("repo workbook exists", repoExists, WORKBOOKS.repo);
  addCheck("desktop workbook exists", desktopExists, WORKBOOKS.desktop);

  if (!repoExists || !desktopExists) return;

  const repoHash = sha256File(WORKBOOKS.repo);
  const desktopHash = sha256File(WORKBOOKS.desktop);
  const repoSize = statSync(WORKBOOKS.repo).size;
  const desktopSize = statSync(WORKBOOKS.desktop).size;

  addCheck("workbook SHA-256 copies match", repoHash === desktopHash, `repo=${repoHash}; desktop=${desktopHash}`);
  addCheck("workbook byte sizes match", repoSize === desktopSize, `repo=${repoSize}; desktop=${desktopSize}`);
}

function checkRequiredDocs() {
  for (const relativePath of REQUIRED_DOCS) {
    const absolutePath = resolve(repoRoot, relativePath);
    addCheck(`required closeout doc exists: ${relativePath}`, existsSync(absolutePath), relativePath);
  }
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail });
}
