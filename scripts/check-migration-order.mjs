#!/usr/bin/env bun

import { readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

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

for (let i = 0; i < numbers.length; i += 1) {
  const expected = i + 1;
  if (numbers[i] !== expected) {
    fail(
      `non-canonical sequence at index ${i}: expected ${expected
        .toString()
        .padStart(3, "0")} but found ${numbers[i].toString().padStart(3, "0")}`
    );
  }
}

console.log(
  `migration check passed: ${files.length} files, sequence ${numbers[0]
    .toString()
    .padStart(3, "0")}..${numbers[numbers.length - 1].toString().padStart(3, "0")}`
);
