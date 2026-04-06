#!/usr/bin/env bun
/**
 * Full stack demo: CRM seed + service/parts seed + verify.
 *
 *   bun ./scripts/demo/full-seed.mjs [seed|baseline-local] [--scenario=name]
 *
 * baseline-local: QEP_DEMO_PREFER_LOCAL=1 full CRM local db reset + CRM seed + service seed + verify
 * seed: CRM seed + service seed + verify (no forced local db reset)
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

const argv = process.argv.slice(2);
const scenarioArg = argv.filter((a) => a.startsWith("--scenario="));
const cmd = argv.find((a) => !a.startsWith("--")) ?? "seed";

if (cmd === "baseline-local") {
  run("bun", ["./scripts/demo/crm-demo-data.mjs", "seed"], {
    QEP_DEMO_PREFER_LOCAL: "1",
  });
  run("bun", ["./scripts/demo/service-parts-seed.mjs", "seed", ...scenarioArg]);
  run("bun", ["./scripts/demo/verify-seed.mjs", ...scenarioArg]);
  console.log("\nFull local baseline seed complete.");
  process.exit(0);
}

if (cmd === "seed") {
  run("bun", ["./scripts/demo/crm-demo-data.mjs", "seed"]);
  run("bun", ["./scripts/demo/service-parts-seed.mjs", "seed", ...scenarioArg]);
  run("bun", ["./scripts/demo/verify-seed.mjs", ...scenarioArg]);
  console.log("\nFull demo seed complete.");
  process.exit(0);
}

console.error("Usage: full-seed.mjs [seed|baseline-local] [--scenario=name]");
process.exit(1);
