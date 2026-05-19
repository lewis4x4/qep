#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (output) {
    console.log(`\n--- ${label} ---\n${output}`);
  }
  return result.status ?? 0;
}

function hasAny(cwd, files) {
  return files.some((file) => existsSync(join(cwd, file)));
}

function runAudit(cwd, label) {
  if (hasAny(cwd, ["package-lock.json", "npm-shrinkwrap.json"])) {
    return run(
      "npm",
      ["audit", "--omit=dev", "--audit-level=high"],
      cwd,
      `${label} (npm)`,
    );
  }

  if (hasAny(cwd, ["bun.lock", "bun.lockb"])) {
    return run("bun", ["audit", "--audit-level=high"], cwd, `${label} (bun)`);
  }

  console.log(
    `\n--- ${label} ---\nskipped: no npm or Bun lockfile in this package directory.`,
  );
  return 0;
}

const root = process.cwd();
const statuses = [runAudit(root, "repo root")];

const web = join(root, "apps/web");
if (
  hasAny(web, [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "bun.lock",
    "bun.lockb",
  ])
) {
  statuses.push(runAudit(web, "apps/web"));
} else {
  console.log(
    "\n--- apps/web ---\nskipped: workspace package uses the root lockfile.",
  );
}

if (statuses.some((status) => status !== 0)) {
  console.error(
    "\nsecurity:deps found high/critical vulnerabilities (see output above).",
  );
  process.exit(1);
}

console.log(
  "security:deps pass — no high/critical vulnerabilities in audited production deps.",
);
