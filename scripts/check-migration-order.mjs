#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

// Known gaps: migration numbers that exist in the DB but were never committed
// as .sql files (e.g. applied directly during early dev before the repo was the
// source of truth). Add to scripts/migration-gaps.json to suppress the gap error.
const gapsFile = join(process.cwd(), "scripts", "migration-gaps.json");
let knownGaps = new Set();
try {
  knownGaps = new Set(JSON.parse(readFileSync(gapsFile, "utf8")));
} catch {
  // No gaps file — all gaps are unexpected.
}

function fail(message) {
  console.error(`migration check failed: ${message}`);
  process.exit(1);
}

let files;
try {
  files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
} catch (error) {
  fail(`unable to read migrations directory (${migrationsDir}): ${String(error)}`);
}

if (files.length === 0) {
  fail("no .sql migration files found");
}

const pattern = /^(\d{3})_[a-z0-9_]+\.sql$/;
const numbers = [];

for (const name of files) {
  const match = name.match(pattern);
  if (!match) {
    fail(
      `invalid migration filename "${name}". Expected 3-digit prefix and snake_case body, e.g. 032_feature_name.sql`
    );
  }
  numbers.push(Number(match[1]));
}

for (let i = 1; i < numbers.length; i += 1) {
  if (numbers[i] === numbers[i - 1]) {
    fail(`duplicate migration number ${numbers[i].toString().padStart(3, "0")}`);
  }
}

// Check that every integer from 1..max is either present in repo OR in the
// known-gaps allowlist. Any other missing number is an unexpected gap → fail.
const maxNum = numbers[numbers.length - 1];
const numSet = new Set(numbers);
for (let n = 1; n <= maxNum; n += 1) {
  if (!numSet.has(n) && !knownGaps.has(n)) {
    fail(
      `unexpected gap at migration ${n.toString().padStart(3, "0")} — if this is intentional, add it to scripts/migration-gaps.json`
    );
  }
}

console.log(
  `migration check passed: ${files.length} files, sequence ${numbers[0]
    .toString()
    .padStart(3, "0")}..${numbers[numbers.length - 1].toString().padStart(3, "0")}`
);
