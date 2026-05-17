#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function runAudit(cwd, label) {
  const result = spawnSync(
    "npm",
    ["audit", "--omit=dev", "--audit-level=high"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (output) {
    console.log(`\n--- ${label} ---\n${output}`);
  }
  return result.status ?? 0;
}

const rootStatus = runAudit(process.cwd(), "repo root");
const webStatus = runAudit(`${process.cwd()}/apps/web`, "apps/web");

if (rootStatus !== 0 || webStatus !== 0) {
  console.error("\nsecurity:deps found high/critical vulnerabilities (see output above).");
  process.exit(1);
}

console.log("security:deps pass — no high/critical vulnerabilities in production deps.");
