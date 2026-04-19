#!/usr/bin/env bun
/**
 * run-unit-tests.mjs — run all unit tests, each file in its own bun process.
 *
 * Slice 08 CP6/CP8 / H1 test-isolation lesson: `mock.module()` registrations
 * are process-global in Bun and persist for the lifetime of the process.
 * Running many test files in a single `bun test` invocation means mocks
 * from one file can contaminate another — a pre-existing footgun that
 * Slice 08's new integration tests amplified.
 *
 * This script sidesteps the issue by running each test file in its own
 * bun subprocess. Slower (each process has startup cost) but bulletproof.
 *
 * Explicitly excludes `*.integration.test.tsx` — those run via
 * run-integration-tests.mjs, also one-per-process.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SEARCH_ROOTS = ["apps"];

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (
      /\.test\.(ts|tsx)$/.test(entry) &&
      !/\.integration\.test\.(ts|tsx)$/.test(entry)
    ) {
      if (relative(ROOT, full).startsWith("supabase/")) continue;
      out.push(full);
    }
  }
}

const files = [];
for (const root of SEARCH_ROOTS) {
  walk(join(ROOT, root), files);
}
files.sort();

if (files.length === 0) {
  console.log("[run-unit-tests] none discovered");
  process.exit(0);
}

console.log(`[run-unit-tests] running ${files.length} unit test file(s), each in its own process`);
let failures = 0;
let totalPass = 0, totalFail = 0;
const WEB_DIR = join(ROOT, "apps/web");

for (const f of files) {
  // Web tests need cwd=apps/web so .env.local resolves for import.meta.env
  // (some tests import @/lib/supabase which pulls VITE_SUPABASE_URL etc).
  const isWeb = f.startsWith(WEB_DIR);
  const cwd = isWeb ? WEB_DIR : ROOT;
  const relFromCwd = relative(cwd, f);
  const r = spawnSync("bun", ["test", relFromCwd], {
    cwd,
    encoding: "utf-8",
  });
  const combined = (r.stdout ?? "") + (r.stderr ?? "");
  // Parse the bun test summary line: " N pass" / " N fail"
  const passMatch = combined.match(/\n\s*(\d+)\s+pass\b/);
  const failMatch = combined.match(/\n\s*(\d+)\s+fail\b/);
  const pass = passMatch ? Number(passMatch[1]) : 0;
  const fail = failMatch ? Number(failMatch[1]) : 0;
  totalPass += pass;
  totalFail += fail;
  const relPath = relative(ROOT, f);
  if ((r.status ?? 1) !== 0 || fail > 0) {
    failures++;
    console.log(`✗ ${relPath}  (${pass} pass, ${fail} fail)`);
    // Only dump full output on failure
    process.stdout.write(combined);
  } else {
    console.log(`✓ ${relPath}  (${pass} pass)`);
  }
}

console.log(`\n[run-unit-tests] total: ${totalPass} pass, ${totalFail} fail across ${files.length} files`);
process.exit(failures > 0 ? 1 : 0);
