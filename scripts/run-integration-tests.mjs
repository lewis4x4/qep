#!/usr/bin/env bun
/**
 * run-integration-tests.mjs — run each `*.integration.test.tsx` in its own
 * bun process so `mock.module()` registrations don't leak between tests.
 *
 * Slice 08 CP6/CP8 companion to run-unit-tests.mjs. Keeps the overall CI
 * story clean: `bun run test` = unit + integration, in that order, with
 * process-level isolation between the two batches and between each
 * integration file.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.integration\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
}

const files = [];
walk(join(ROOT, "apps"), files);
files.sort();

if (files.length === 0) {
  console.log("[run-integration-tests] none discovered");
  process.exit(0);
}

console.log(`[run-integration-tests] running ${files.length} integration test file(s), each in its own process`);
const WEB_DIR = join(ROOT, "apps/web");
let failures = 0;
for (const f of files) {
  // Web tests need cwd=apps/web so .env.local resolves via vite env
  const isWeb = f.startsWith(WEB_DIR);
  const cwd = isWeb ? WEB_DIR : ROOT;
  const relFromCwd = f.startsWith(cwd + "/") ? f.slice(cwd.length + 1) : f;
  console.log(`\n── ${relFromCwd}`);
  const r = spawnSync("bun", ["test", relFromCwd], { stdio: "inherit", cwd });
  if ((r.status ?? 1) !== 0) failures++;
}

if (failures > 0) {
  console.error(`\n[run-integration-tests] ${failures} file(s) failed`);
  process.exit(1);
}
console.log(`\n[run-integration-tests] all ${files.length} file(s) green`);
