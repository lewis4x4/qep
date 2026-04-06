#!/usr/bin/env bun
/**
 * P0-C-style guard: ensure production sign-off still documents Path A vs Path B
 * (pg_cron vs GitHub Actions) so operators do not enable both at full cadence.
 *
 * Run in CI or locally: `bun run service:cron:path-check`
 * Does not query the database — doc + workflow presence only.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const signoffPath = join(root, "docs/SERVICE_ENGINE_PRODUCTION_SIGNOFF.md");
const workflowPath = join(root, ".github/workflows/service-cron.yml");

let failed = false;

function fail(msg) {
  console.error(msg);
  failed = true;
}

if (!existsSync(signoffPath)) {
  fail(`service:cron:path-check: missing ${signoffPath}`);
} else {
  const txt = readFileSync(signoffPath, "utf8");
  if (!txt.includes("Path A") || !txt.includes("Path B")) {
    fail("service:cron:path-check: sign-off must document Path A and Path B");
  }
  if (!/duplicate|both firing|Do not/i.test(txt)) {
    fail(
      "service:cron:path-check: sign-off must warn about duplicate cron paths (Path A + B)",
    );
  }
}

if (!existsSync(workflowPath)) {
  console.warn(
    "service:cron:path-check: .github/workflows/service-cron.yml missing — Path B default not present in repo",
  );
} else {
  const w = readFileSync(workflowPath, "utf8");
  if (!w.includes("service-tat-monitor") && !w.includes("workflow_dispatch")) {
    console.warn(
      "service:cron:path-check: service-cron.yml may not match expected service workers",
    );
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  "service:cron:path-check OK — use one of Path A (pg_cron) or Path B (GitHub Actions), not both at full cadence.",
);
process.exit(0);
