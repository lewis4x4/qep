#!/usr/bin/env node
// Check drift between the repo's migration files and what's been applied to
// the linked Supabase project.
//
// Catches the failure mode that produced migrations 362/363/364 sitting on
// `main` for a week without touching prod: a PR lands a new migration, the
// PR merges, nobody runs `supabase db push`, and the next user hitting that
// code path discovers a missing table.
//
// This repo uses 3-digit-prefix migrations (`001_name.sql`) which the
// Supabase CLI's `migration list` ignores — the CLI only recognizes
// timestamp-prefixed names. So instead of parsing CLI output, we call the
// Supabase Management API directly:
//
//   GET https://api.supabase.com/v1/projects/{ref}/database/migrations
//
// and diff the returned `version` list against the 3-digit prefixes in
// supabase/migrations/*.sql.
//
// Exits:
//   0 — no drift (or the env is intentionally unconfigured)
//   1 — drift detected OR a configuration error the reader should see
//
// Required secrets when run against prod:
//   SUPABASE_ACCESS_TOKEN — a personal access token
//     (generate at https://supabase.com/dashboard/account/tokens)
//   SUPABASE_PROJECT_REF  — the ref (e.g. "iciddijgonywtxoelous")
//
// If either secret is unset the script prints a clear "skipped" message and
// exits 0, so introducing this check doesn't retroactively break PRs.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATION_FILE_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;

function info(msg) {
  console.log(`[check-migrations] ${msg}`);
}
function fail(msg) {
  console.error(`[check-migrations] FAIL: ${msg}`);
  process.exit(1);
}
function skip(msg) {
  console.log(`[check-migrations] SKIP: ${msg}`);
  process.exit(0);
}

function repoVersions() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const out = [];
  for (const name of files) {
    const m = name.match(MIGRATION_FILE_RE);
    if (!m) continue;
    out.push({ version: m[1], filename: name });
  }
  return out.sort((a, b) => a.version.localeCompare(b.version));
}

/** Management API returns each applied migration as `{ version, name, ... }`.
 *  For this project `version` is the 3-digit prefix as a string. */
async function fetchAppliedVersions(projectRef, token) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`Management API returned ${res.status}: ${body.slice(0, 400)}`);
  }
  const body = await res.json();
  if (!Array.isArray(body)) fail(`unexpected response shape (not an array): ${JSON.stringify(body).slice(0, 200)}`);
  const versions = new Set();
  for (const row of body) {
    if (typeof row?.version === "string") versions.add(row.version);
  }
  return versions;
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;

  if (!token || !projectRef) {
    skip(
      "SUPABASE_ACCESS_TOKEN and/or SUPABASE_PROJECT_REF not set. To enable the check, add both as repo secrets. Generate a token at https://supabase.com/dashboard/account/tokens.",
    );
  }

  const repo = repoVersions();
  if (repo.length === 0) fail("no .sql migration files found in supabase/migrations/");

  info(`found ${repo.length} migration files in repo (newest: ${repo[repo.length - 1].version})`);

  const applied = await fetchAppliedVersions(projectRef, token);
  info(`schema_migrations reports ${applied.size} applied versions`);

  const pending = repo.filter((r) => !applied.has(r.version));
  if (pending.length === 0) {
    info("no drift — every migration in the repo is applied to prod");
    process.exit(0);
  }

  console.error(`[check-migrations] FAIL: ${pending.length} pending migration(s):`);
  for (const p of pending) {
    console.error(`  - ${p.filename}`);
  }
  console.error("\nApply via the 'Apply Supabase migrations' workflow in GitHub Actions,");
  console.error("or locally via mcp__claude_ai_Supabase__apply_migration.");
  process.exit(1);
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack ?? err.message : String(err));
});
