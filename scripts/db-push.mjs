#!/usr/bin/env bun
// ============================================================================
// scripts/db-push.mjs
//
// Applies pending migrations to the remote Supabase Postgres, using direct
// psql execution so the NNN_snake_case.sql convention keeps working without
// renaming every file to the `<timestamp>_name.sql` format that recent
// `supabase db push` versions require.
//
// Why this exists:
//   * The repo has used 3-digit sequential migration numbers since day one
//     (336 files and counting), guarded by scripts/check-migration-order.mjs.
//   * Supabase CLI 2.84+ rejects non-timestamp filenames at `db push` time
//     with "file name must match pattern <timestamp>_name.sql". Renaming the
//     whole history would churn every open PR and break all the ticket
//     references to "migration 293" etc.
//   * Prior to this script, committers have worked around the CLI by
//     applying SQL out-of-band (direct psql, SQL editor, etc.), which left
//     the remote schema_migrations table out of sync with the repo. That's
//     why `supabase migration list` currently shows 30+ pending rows.
//
// What this does:
//   1. Resolves the connection URL (SUPABASE_DB_URL, or builds one from
//      SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD against the project's
//      pooler endpoint).
//   2. Reads every NNN_name.sql in supabase/migrations/.
//   3. Queries supabase_migrations.schema_migrations on the remote to see
//      which version strings ("293", "304", ...) are already applied.
//   4. In ascending order, for each pending migration:
//        a. Opens a transaction via psql --single-transaction.
//        b. Runs the migration file.
//        c. Inserts/upserts the NNN into schema_migrations within the same
//           transaction so a rollback removes the stamp too.
//      Stops on the first failure (ON_ERROR_STOP=1).
//   5. Prints a compact report.
//
// Usage:
//   # Dry-run (no writes):
//   SUPABASE_DB_URL='postgresql://...' bun run db:push
//
//   # Apply:
//   SUPABASE_DB_URL='postgresql://...' bun run db:push -- --apply
//
//   # Or using password + project ref:
//   SUPABASE_PROJECT_REF=iciddijgonywtxoelous \
//   SUPABASE_DB_PASSWORD='...' \
//     bun run db:push -- --apply
//
// Safety:
//   * Dry-run is the default. --apply is required to mutate the database.
//   * Every migration file runs inside a single transaction; partial apply
//     is impossible (modulo DDL that can't run in a transaction — there
//     are none in this repo).
//   * The script bails at the first failure. Already-applied migrations
//     in the run are kept; the failing one is rolled back.
// ============================================================================

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const CONFIG_TOML = join(REPO_ROOT, "supabase", "config.toml");
const FILENAME_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const VERBOSE = args.has("--verbose") || args.has("-v");

function die(msg, code = 1) {
  console.error(`db-push: ${msg}`);
  process.exit(code);
}

function info(msg) {
  console.log(`db-push: ${msg}`);
}

function vinfo(msg) {
  if (VERBOSE) console.log(`db-push: ${msg}`);
}

// ── 1. Resolve connection URL ──────────────────────────────────────────────
function resolveConnUrl() {
  const direct = process.env.SUPABASE_DB_URL;
  if (direct && direct.startsWith("postgresql://")) {
    vinfo("using SUPABASE_DB_URL from environment");
    return direct;
  }

  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (!pw) {
    die(
      "missing connection. Set SUPABASE_DB_URL='postgresql://...' OR " +
      "(SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD). " +
      "Project ref is read from supabase/config.toml when not passed.",
    );
  }

  let ref = process.env.SUPABASE_PROJECT_REF;
  if (!ref) {
    try {
      const toml = readFileSync(CONFIG_TOML, "utf8");
      const m = toml.match(/^project_id\s*=\s*"([a-z0-9]+)"/m);
      if (m) ref = m[1];
    } catch {
      /* fall through */
    }
  }
  if (!ref) die("no project ref — set SUPABASE_PROJECT_REF or ensure supabase/config.toml has project_id");

  // Direct-connection URL. The Supabase pooler also works but session-pinned
  // migrations (DDL with advisory locks) are safer on the direct endpoint.
  const encoded = encodeURIComponent(pw);
  const url = `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
  vinfo(`built URL for project ref ${ref}`);
  return url;
}

// ── 2. Local migrations ────────────────────────────────────────────────────
function readLocalMigrations() {
  const entries = readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort();
  const out = [];
  for (const name of entries) {
    const m = name.match(FILENAME_PATTERN);
    if (!m) die(`filename does not match NNN_name.sql: ${name}`);
    out.push({ version: m[1], filename: name, path: join(MIGRATIONS_DIR, name) });
  }
  return out;
}

// ── 3. Remote schema_migrations ────────────────────────────────────────────
function psqlBin() {
  // Prefer Homebrew libpq's psql (18.x); fall back to PATH.
  const homebrew = "/opt/homebrew/opt/libpq/bin/psql";
  if (existsSync(homebrew)) return homebrew;
  return "psql";
}

function runPsqlQuery(url, sql) {
  const res = spawnSync(
    psqlBin(),
    ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--command", sql, url],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    const stderr = res.stderr?.trim() ?? "";
    throw new Error(`psql query failed: ${stderr || "no stderr"}`);
  }
  return res.stdout.trim();
}

function fetchRemoteVersions(url) {
  // supabase_migrations.schema_migrations exists on any project created
  // via the Supabase Dashboard; the CLI also creates it on first push.
  try {
    const out = runPsqlQuery(
      url,
      "select version from supabase_migrations.schema_migrations order by version;",
    );
    if (!out) return new Set();
    return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch (e) {
    if (String(e.message).includes('relation "supabase_migrations.schema_migrations" does not exist')) {
      info("remote schema_migrations table not found — treating as fresh project");
      return new Set();
    }
    throw e;
  }
}

// ── 4. Apply a single migration atomically ────────────────────────────────
function applyOne(url, mig) {
  // Compose the migration SQL + the schema_migrations stamp into one script
  // so psql --single-transaction makes the whole thing atomic. A failure
  // either in the migration or in the stamp rolls back everything, which
  // means dry-run-like safety even when applying.
  const body = readFileSync(mig.path, "utf8");
  const stamp =
    `-- db-push stamp for ${mig.filename}\n` +
    `insert into supabase_migrations.schema_migrations (version) values ('${mig.version}')\n` +
    `  on conflict (version) do nothing;\n`;

  const tmp = join(tmpdir(), `db-push-${mig.version}-${Date.now()}.sql`);
  writeFileSync(tmp, body + "\n" + stamp);

  try {
    const res = spawnSync(
      psqlBin(),
      [
        "--no-psqlrc",
        "--quiet",
        "--set=ON_ERROR_STOP=1",
        "--single-transaction",
        "--file",
        tmp,
        url,
      ],
      { encoding: "utf8" },
    );
    if (res.status !== 0) {
      const stderr = (res.stderr ?? "").trim();
      const stdout = (res.stdout ?? "").trim();
      throw new Error(
        `psql exit ${res.status} applying ${mig.filename}\n` +
        (stderr ? `--- stderr ---\n${stderr}\n` : "") +
        (VERBOSE && stdout ? `--- stdout ---\n${stdout}\n` : ""),
      );
    }
    vinfo(`applied ${mig.filename}`);
  } finally {
    try { rmSync(tmp); } catch { /* ignore */ }
  }
}

// ── 5. Orchestrate ─────────────────────────────────────────────────────────
function main() {
  if (!existsSync(MIGRATIONS_DIR)) die(`migrations dir not found: ${MIGRATIONS_DIR}`);

  const local = readLocalMigrations();
  if (local.length === 0) die("no local migrations");

  const url = resolveConnUrl();

  let remote;
  try {
    remote = fetchRemoteVersions(url);
  } catch (e) {
    die(`cannot reach remote: ${e.message}`);
  }

  const pending = local.filter((m) => !remote.has(m.version));
  const extraRemote = [...remote].filter((v) => !local.some((m) => m.version === v));

  info(`local migrations: ${local.length}`);
  info(`already applied on remote: ${remote.size}`);
  info(`pending to apply: ${pending.length}`);
  if (extraRemote.length > 0) {
    info(`remote has ${extraRemote.length} version(s) not in repo: ${extraRemote.join(", ")}`);
  }

  if (pending.length === 0) {
    info("remote is up to date — nothing to do");
    return;
  }

  info(`pending versions: ${pending.map((m) => m.version).join(", ")}`);

  if (!APPLY) {
    info("dry-run (no writes). Re-run with --apply to push.");
    return;
  }

  info("applying in order (single-transaction per file, ON_ERROR_STOP=1)");
  let applied = 0;
  for (const mig of pending) {
    process.stdout.write(`  → ${mig.filename} ... `);
    try {
      applyOne(url, mig);
      applied += 1;
      process.stdout.write("ok\n");
    } catch (e) {
      process.stdout.write("FAILED\n");
      console.error(e.message);
      info(`applied ${applied} of ${pending.length} before failure`);
      process.exit(2);
    }
  }
  info(`applied ${applied} migration${applied === 1 ? "" : "s"} successfully`);
}

main();
