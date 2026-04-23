#!/usr/bin/env node
// Apply pending migrations to the linked Supabase project via the
// Management API (POST /v1/projects/{ref}/database/migrations).
//
// Why not `supabase db push`: the CLI's push path expects timestamp-
// prefixed filenames (20240101000000_name.sql). This repo uses 3-digit
// prefixes (001_name.sql), which the CLI silently skips. The Management
// API endpoint doesn't care about filename format — it just needs a
// `name` and a `query` — so we loop through pending files and POST each
// one in ascending version order.
//
// Safety:
//   - Only runs when --apply is passed. Default is dry-run — prints the
//     pending list and exits.
//   - Applies migrations in version order. Stops on the first failure so
//     a partial apply never leaves you with a corrupt half-state.
//
// Required env:
//   SUPABASE_ACCESS_TOKEN — personal access token
//   SUPABASE_PROJECT_REF  — project ref

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATION_FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

function info(msg) {
  console.log(`[apply-migrations] ${msg}`);
}
function fail(msg) {
  console.error(`[apply-migrations] FAIL: ${msg}`);
  process.exit(1);
}

function repoMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const out = [];
  for (const name of files) {
    const m = name.match(MIGRATION_FILE_RE);
    if (!m) continue;
    out.push({
      version: m[1],
      name: m[2], // snake_case body without the 3-digit prefix
      filename: name,
      path: join(MIGRATIONS_DIR, name),
    });
  }
  return out.sort((a, b) => a.version.localeCompare(b.version));
}

async function fetchAppliedVersions(projectRef, token) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`Management API GET returned ${res.status}: ${body.slice(0, 400)}`);
  }
  const body = await res.json();
  const versions = new Set();
  for (const row of body) if (typeof row?.version === "string") versions.add(row.version);
  return versions;
}

async function applyOne(projectRef, token, migration) {
  const query = readFileSync(migration.path, "utf8");
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: migration.name, query }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `${res.status} ${body.slice(0, 600)}` };
  }
  return { ok: true };
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const apply = process.argv.includes("--apply");

  if (!token || !projectRef) {
    fail("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.");
  }

  const repo = repoMigrations();
  const applied = await fetchAppliedVersions(projectRef, token);
  const pending = repo.filter((r) => !applied.has(r.version));

  info(`repo has ${repo.length} migrations, ${applied.size} applied, ${pending.length} pending`);

  if (pending.length === 0) {
    info("no drift — nothing to apply");
    process.exit(0);
  }

  info("pending:");
  for (const p of pending) info(`  - ${p.filename}`);

  if (!apply) {
    info("dry run — pass --apply to actually run these migrations");
    process.exit(0);
  }

  // Apply in ascending version order, one at a time, stopping on first failure.
  for (const m of pending) {
    info(`applying ${m.filename}...`);
    const result = await applyOne(projectRef, token, m);
    if (!result.ok) {
      fail(`${m.filename} failed:\n${result.error}`);
    }
    info(`  ✓ ${m.filename}`);
  }

  // Verify drift is now zero.
  const finalApplied = await fetchAppliedVersions(projectRef, token);
  const stillPending = repo.filter((r) => !finalApplied.has(r.version));
  if (stillPending.length > 0) {
    fail(`post-apply verification shows ${stillPending.length} still pending — inspect manually`);
  }
  info(`✓ all ${pending.length} pending migration(s) applied and verified`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack ?? err.message : String(err));
});
