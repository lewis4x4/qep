#!/usr/bin/env node
/**
 * Runs `deno check` on each path listed in deno-check-edge-functions.allowlist.
 * Requires Deno on PATH. Expand the allowlist as more functions type-check cleanly.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const listPath = join(__dirname, "deno-check-edge-functions.allowlist");

const raw = readFileSync(listPath, "utf8");
const files = raw
  .split("\n")
  .map((line) => line.replace(/#.*/, "").trim())
  .filter(Boolean)
  .map((rel) => join(root, rel))
  .filter((p) => {
    if (!existsSync(p)) {
      console.error(`deno-check-edge-functions: missing ${p}`);
      return false;
    }
    return true;
  });

if (files.length === 0) {
  console.error("deno-check-edge-functions: no paths in allowlist");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const rel = file.slice(root.length + 1);
  console.log(`deno check ${rel}`);
  const r = spawnSync("deno", ["check", file], { stdio: "inherit", cwd: root });
  if (r.status !== 0) failed++;
}

if (failed > 0) {
  console.error(`edge:deno-check failed (${failed} function(s))`);
  process.exit(1);
}

console.log(`edge:deno-check OK (${files.length} allowlisted function(s))`);
