#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const migrationPath = resolve(repoRoot, "supabase/migrations/615_agent_service_accounts.sql");
const provisionerPath = resolve(repoRoot, "scripts/provision-agent-service-accounts.mjs");
const handoffPath = resolve(repoRoot, "QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md");
const requiredTokens = [
  "QEP_AGENT_EMAIL",
  "QEP_AGENT_PASSWORD",
  "QEP_AGENT_ADMIN_EMAIL",
  "QEP_AGENT_ADMIN_PASSWORD",
  "is_agent_service_account",
  "agent_service_key",
  "backfill_profile",
];
const checks = [];

const migration = readIfExists(migrationPath, "migration exists");
const provisioner = readIfExists(provisionerPath, "provisioning script exists");
const handoff = readIfExists(handoffPath, "handoff exists");

if (migration) {
  checkIncludes(migration, "migration adds service-account flag", "is_agent_service_account boolean not null default false");
  checkIncludes(migration, "migration adds service-account key", "agent_service_key text");
  checkIncludes(migration, "migration enforces key for service accounts", "profiles_agent_service_account_requires_key_chk");
  checkIncludes(migration, "migration propagates service-account metadata", "account_kind");
  checkIncludes(migration, "migration refreshes metadata trigger", "after insert or update of active_workspace_id, iron_role, role, is_agent_service_account, agent_service_key");
}

if (provisioner) {
  for (const token of requiredTokens) {
    checkIncludes(provisioner, `provisioner contains ${token}`, token);
  }
  addCheck("provisioner defaults to dry-run", /const apply = args\.apply === true/.test(provisioner), "requires --apply for writes");
  addCheck("provisioner dry-run masks password values", provisioner.includes("password_configured: Boolean(account.password)") && !provisioner.includes("password_configured: account.password"), "dry-run may report configured booleans only");
  addCheck("provisioner uses Supabase Auth admin API", provisioner.includes("auth.admin.createUser") && provisioner.includes("auth.admin.updateUserById"), "create/update users");
}

if (handoff) {
  for (const token of ["Agent service accounts in Supabase Auth", "QEP_AGENT_EMAIL", "QEP_AGENT_ADMIN_PASSWORD"]) {
    checkIncludes(handoff, `handoff contains ${token}`, token);
  }
}

const result = {
  verdict: checks.every((check) => check.ok) ? "PASS" : "FAIL",
  generated_at: new Date().toISOString(),
  migration: relative(migrationPath),
  provisioner: relative(provisionerPath),
  handoff: relative(handoffPath),
  checks,
  failed: checks.filter((check) => !check.ok),
};
console.log(JSON.stringify(result, null, 2));
if (result.failed.length > 0) process.exitCode = 1;

function readIfExists(path, name) {
  const ok = existsSync(path);
  addCheck(name, ok, relative(path));
  return ok ? readFileSync(path, "utf8") : "";
}

function checkIncludes(text, name, token) {
  addCheck(name, text.includes(token), token);
}

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function relative(filePath) {
  return filePath.startsWith(`${repoRoot}/`) ? filePath.slice(repoRoot.length + 1) : filePath;
}
