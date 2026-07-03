#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const requiredStatuses = [
  "draft_low_margin",
  "approved_with_conditions",
  "changes_requested",
  "pending_approval",
];

const files = [
  "shared/qep-moonshot-contracts.ts",
  "apps/web/src/features/quote-builder/lib/quote-api.ts",
  "apps/web/src/features/quote-builder/lib/saved-quote-draft.ts",
  "supabase/functions/quote-builder-v2/index.ts",
  "supabase/migrations/378_quote_packages_status_widen.sql",
  "supabase/migrations/719_a58_save_draft_reason_logging.sql",
];

const failures = [];
const evidence = [];

for (const relativePath of files) {
  const absolutePath = resolve(repoRoot, relativePath);
  const source = readFileSync(absolutePath, "utf8");
  const statusesToCheck = relativePath.endsWith("378_quote_packages_status_widen.sql")
    ? requiredStatuses.filter((status) => status !== "draft_low_margin")
    : requiredStatuses;
  const missing = statusesToCheck.filter((status) => !source.includes(status));
  evidence.push({ file: relativePath, required_statuses_present: statusesToCheck.filter((status) => !missing.includes(status)) });
  if (missing.length > 0) {
    failures.push(`${relativePath} missing statuses: ${missing.join(", ")}`);
  }
}

const migration = readFileSync(resolve(repoRoot, "supabase/migrations/378_quote_packages_status_widen.sql"), "utf8");
if (!/quote_packages_status_check/.test(migration)) {
  failures.push("migration 378 does not modify quote_packages_status_check");
}
const a58Migration = readFileSync(resolve(repoRoot, "supabase/migrations/719_a58_save_draft_reason_logging.sql"), "utf8");
if (!/quote_packages_status_check/.test(a58Migration) || !/draft_low_margin/.test(a58Migration)) {
  failures.push("migration 719 does not widen quote_packages_status_check for draft_low_margin");
}

if (failures.length > 0) {
  console.error(JSON.stringify({ verdict: "FAIL", failures, evidence }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ verdict: "PASS", required_statuses: requiredStatuses, evidence }, null, 2));
