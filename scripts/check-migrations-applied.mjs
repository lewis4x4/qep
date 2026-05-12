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
const MIGRATION_FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

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
    out.push({ version: m[1], name: m[2], filename: name });
  }
  return out.sort((a, b) => a.version.localeCompare(b.version));
}

/** Management API returns each applied migration as `{ version, name, ... }`.
 *  Older rows applied via `supabase db push` carry `version = "001"` (the
 *  3-digit prefix). Rows applied via this repo's apply-pending-migrations.mjs
 *  script — which POSTs without an explicit version — get a synthesized
 *  `YYYYMMDDHHMMSS` timestamp in `version` and the POSTed snake_case body in
 *  `name`. We return both sets so callers can match a repo file against
 *  either historic path. */
async function fetchAppliedMigrations(projectRef, token) {
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
  const names = new Set();
  for (const row of body) {
    if (typeof row?.version === "string") versions.add(row.version);
    if (typeof row?.name === "string") names.add(row.name);
  }
  return { versions, names, total: body.length };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Compute pending migrations against a fresh applied set. */
async function computePending(projectRef, token, repo) {
  const applied = await fetchAppliedMigrations(projectRef, token);
  const isApplied = (r) => applied.versions.has(r.version) || applied.names.has(r.name);
  return { pending: repo.filter((r) => !isApplied(r)), applied };
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

  // Grace window: when this workflow fires from `push: main`, the
  // commit that lands a new migration is created BEFORE the manual
  // `Apply Supabase migrations` workflow runs. Without a grace window
  // the check inevitably fails for ~1-2 minutes between push and
  // apply, sending a misleading "all jobs have failed" email even
  // though the apply lands cleanly seconds later.
  //
  // Configure CHECK_MIGRATIONS_GRACE_SECONDS in the workflow YAML to
  // tolerate that window. PR runs leave it at 0 so reviewers still
  // get fast feedback when a PR adds a migration file that hasn't
  // been applied yet.
  const graceRaw = process.env.CHECK_MIGRATIONS_GRACE_SECONDS;
  const graceSeconds = Number.isFinite(Number(graceRaw)) ? Math.max(0, Number(graceRaw)) : 0;
  const pollIntervalMs = 15_000;

  let attempt = 0;
  const startedAt = Date.now();
  // First pass: always run.
  let { pending, applied } = await computePending(projectRef, token, repo);
  info(`schema_migrations reports ${applied.total} applied versions`);

  while (pending.length > 0 && (Date.now() - startedAt) / 1000 < graceSeconds) {
    attempt += 1;
    info(
      `${pending.length} pending after attempt ${attempt}; waiting ${pollIntervalMs / 1000}s ` +
        `(grace ${graceSeconds}s) for the Apply Supabase migrations workflow to land...`,
    );
    await sleep(pollIntervalMs);
    ({ pending, applied } = await computePending(projectRef, token, repo));
  }

  if (pending.length === 0) {
    if (attempt > 0) {
      info(`drift resolved after ${attempt} retry attempt(s); ${applied.total} applied versions`);
    } else {
      info("no drift — every migration in the repo is applied to prod");
    }
    process.exit(0);
  }

  console.error(`[check-migrations] FAIL: ${pending.length} pending migration(s):`);
  for (const p of pending) {
    console.error(`  - ${p.filename}`);
  }
  if (graceSeconds > 0) {
    console.error(`\n(waited ${graceSeconds}s for the apply workflow before failing)`);
  }
  console.error("\nApply via the 'Apply Supabase migrations' workflow in GitHub Actions,");
  console.error("or locally via mcp__claude_ai_Supabase__apply_migration.");
  process.exit(1);
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack ?? err.message : String(err));
});
