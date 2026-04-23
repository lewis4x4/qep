#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const BASELINE_MIGRATION = 366;
const RAW_PATTERNS = [
  "public.get_my_workspace()",
  "public.get_my_role()",
  "public.get_my_audience()",
  "auth.uid()",
  "auth.role()",
];
const SAFE_PATTERNS = new Map([
  ["public.get_my_workspace()", "(select public.get_my_workspace())"],
  ["public.get_my_role()", "(select public.get_my_role())"],
  ["public.get_my_audience()", "(select public.get_my_audience())"],
  ["auth.uid()", "(select auth.uid())"],
  ["auth.role()", "(select auth.role())"],
]);

function statementLineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function sanitizeStatement(statement) {
  let sanitized = statement;
  for (const safe of SAFE_PATTERNS.values()) {
    sanitized = sanitized.split(safe).join("");
  }
  return sanitized;
}

function isPolicyStatement(statement) {
  return /\b(create|alter)\s+policy\b/i.test(statement);
}

const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d+_.*\.sql$/.test(name))
  .sort();

const failures = [];

for (const file of files) {
  const match = file.match(/^(\d+)_/);
  if (!match) continue;
  const migrationNumber = Number(match[1]);
  if (!Number.isFinite(migrationNumber) || migrationNumber < BASELINE_MIGRATION) {
    continue;
  }

  const fullPath = path.join(MIGRATIONS_DIR, file);
  const sql = fs.readFileSync(fullPath, "utf8");
  const statements = [...sql.matchAll(/(?:create|alter)\s+policy[\s\S]*?;/gi)];

  for (const stmt of statements) {
    const statement = stmt[0];
    if (!isPolicyStatement(statement)) continue;
    const sanitized = sanitizeStatement(statement);
    const rawMatch = RAW_PATTERNS.find((pattern) => sanitized.includes(pattern));
    if (!rawMatch) continue;
    failures.push({
      file,
      line: statementLineNumber(sql, stmt.index ?? 0),
      pattern: rawMatch,
    });
  }
}

if (failures.length > 0) {
  console.error("rls initplan check failed:");
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line} contains raw ${failure.pattern}`);
  }
  process.exit(1);
}

console.log(
  `rls initplan check passed: scanned ${files.filter((name) => Number(name.slice(0, 3)) >= BASELINE_MIGRATION).length} post-baseline migrations`
);
