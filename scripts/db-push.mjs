#!/usr/bin/env bun
// ============================================================================
// scripts/db-push.mjs
//
// Applies pending migrations to the remote Supabase Postgres via the
// Supabase Management API (POST /v1/projects/{ref}/database/query), so the
// repo's `NNN_snake_case.sql` convention keeps working without renaming
// every file to `<timestamp>_name.sql` (which recent `supabase db push`
// versions require) AND without needing the raw Postgres password.
//
// Why this exists:
//   * The repo has used 3-digit sequential migration numbers since day one
//     (336 files and counting), guarded by scripts/check-migration-order.mjs.
//   * Supabase CLI 2.84+ rejects non-timestamp filenames at `db push`.
//     Renaming the whole history would churn every open PR and break the
//     ticket references to "migration 293" etc.
//   * Prior to this script, committers have worked around the CLI by
//     applying SQL out-of-band, leaving the remote's schema_migrations
//     table chronically out of sync with the repo.
//
// What this does:
//   1. Resolves an access token (env SUPABASE_ACCESS_TOKEN, or the
//      macOS keychain entry the `supabase` CLI stores after `supabase login`).
//   2. Reads every NNN_name.sql in supabase/migrations/.
//   3. Queries supabase_migrations.schema_migrations on the remote to see
//      which NNN versions are already applied.
//   4. For each pending migration, in ascending order, POSTs one request:
//        begin;
//        <file contents>;
//        insert into supabase_migrations.schema_migrations (version)
//          values ('NNN') on conflict do nothing;
//        commit;
//      Any failure inside rolls everything back — the stamp and the
//      migration land together or not at all.
//   5. Stops at the first failure, reports which file broke, and exits 2.
//
// Usage:
//   # Dry-run (no writes). Uses the same access token Supabase CLI uses:
//   bun run db:push
//
//   # Apply:
//   bun run db:push:apply
//
//   # Or pass the token explicitly (e.g. CI):
//   SUPABASE_ACCESS_TOKEN='sbp_...' bun run db:push:apply
//
// Why Management API instead of psql:
//   * No Postgres password needed. The token is already cached by the
//     Supabase CLI after `supabase login`, so anyone who can run
//     `supabase projects list` can push migrations.
//   * HTTP is easier to wrap around than forking psql + handling
//     stderr parsing + encoding the password into a URL.
//   * Transaction semantics are identical — the endpoint forwards
//     multi-statement SQL to Postgres as-is.
//
// Safety:
//   * Dry-run is the default. --apply is required to mutate.
//   * Every migration runs inside an explicit BEGIN/COMMIT.
//   * Bail at first failure. Already-applied migrations earlier in the
//     run stay applied (their stamp is durable); the failing one is
//     rolled back cleanly.
// ============================================================================

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const CONFIG_TOML = join(REPO_ROOT, "supabase", "config.toml");
const FILENAME_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;
const API_ROOT = "https://api.supabase.com";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const APPLY = args.has("--apply");
const VERBOSE = args.has("--verbose") || args.has("-v");

// --stamp=304,305,316 or --stamp 304,305 → record those versions as applied
// without running their SQL. Escape hatch for "objects already exist because
// someone applied out-of-band and forgot to stamp schema_migrations".
// Use only after confirming every signature object is present on remote.
function parseStampList() {
  const flagIdx = rawArgs.findIndex((a) => a === "--stamp" || a.startsWith("--stamp="));
  if (flagIdx < 0) return null;
  const arg = rawArgs[flagIdx];
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : rawArgs[flagIdx + 1];
  if (!value) die("--stamp requires a comma-separated version list, e.g. --stamp=304,305,316");
  const versions = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const v of versions) {
    if (!/^\d{3}$/.test(v)) die(`invalid stamp version "${v}" — must be 3 digits`);
  }
  return versions;
}
const STAMP_ONLY = parseStampList();

function die(msg, code = 1) {
  console.error(`db-push: ${msg}`);
  process.exit(code);
}
function info(msg) { console.log(`db-push: ${msg}`); }
function vinfo(msg) { if (VERBOSE) console.log(`db-push: ${msg}`); }

// ── 1. Resolve project ref + access token ─────────────────────────────────
function resolveProjectRef() {
  const envRef = process.env.SUPABASE_PROJECT_REF;
  if (envRef) return envRef;
  try {
    const toml = readFileSync(CONFIG_TOML, "utf8");
    const m = toml.match(/^project_id\s*=\s*"([a-z0-9]+)"/m);
    if (m) return m[1];
  } catch { /* fall through */ }
  die("no project ref — set SUPABASE_PROJECT_REF or put project_id in supabase/config.toml");
}

function resolveAccessToken() {
  const envToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (envToken) {
    vinfo("using SUPABASE_ACCESS_TOKEN from environment");
    return envToken;
  }

  // The Supabase CLI stores its token in the OS keyring under
  // service="Supabase CLI", account="supabase". On macOS we can read
  // it via `security find-generic-password`. Linux is a TODO (libsecret
  // via `secret-tool` works similarly).
  if (process.platform === "darwin") {
    try {
      const raw = execSync(
        "security find-generic-password -s 'Supabase CLI' -a 'supabase' -w",
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      // go-keyring wraps values as `go-keyring-base64:<base64>` or
      // `go-keyring-encrypted:<aes>`. We only decode the base64 form here;
      // the encrypted form requires the CLI's keyring key (not exposed).
      if (raw.startsWith("go-keyring-base64:")) {
        const decoded = Buffer.from(raw.slice("go-keyring-base64:".length), "base64").toString("utf8");
        vinfo("loaded access token from macOS keychain (Supabase CLI)");
        return decoded;
      }
      // Legacy plain-string storage.
      if (raw.length > 20 && !raw.startsWith("go-keyring-")) {
        vinfo("loaded access token from macOS keychain (plain)");
        return raw;
      }
    } catch {
      /* keychain miss is fine — fall through to the helpful error */
    }
  }

  die(
    "no access token. Either run `supabase login` first (we'll read the " +
    "CLI's keychain entry automatically) or export SUPABASE_ACCESS_TOKEN.",
  );
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

// ── 3. Management API client ──────────────────────────────────────────────
async function runSql(token, projectRef, query) {
  const url = `${API_ROOT}/v1/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === "object" && body?.message ? body.message : text;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  // The API returns 2xx + a `{ message }` body on some SQL errors too
  // (e.g. "Failed to run sql query: ERROR: …"). Surface those as failures.
  if (body && typeof body === "object" && !Array.isArray(body) && body.message) {
    throw new Error(body.message);
  }
  return body;
}

async function fetchRemoteVersions(token, projectRef) {
  try {
    const rows = await runSql(
      token,
      projectRef,
      "select version from supabase_migrations.schema_migrations order by version;",
    );
    if (!Array.isArray(rows)) return new Set();
    return new Set(rows.map((r) => String(r.version)));
  } catch (e) {
    if (String(e.message).includes("does not exist")) {
      info("remote supabase_migrations table not found — treating as fresh project");
      return new Set();
    }
    throw e;
  }
}

// ── 4. Apply one migration atomically ─────────────────────────────────────
async function applyOne(token, projectRef, mig) {
  const body = readFileSync(mig.path, "utf8");
  // Wrap the file + the stamp in a single BEGIN/COMMIT. The Management
  // API forwards multi-statement SQL to Postgres as-is; a failure in
  // either part rolls back the other. `on conflict do nothing` guards
  // against a pre-existing stamp (manual out-of-band apply).
  const sql =
    "begin;\n" +
    body.trimEnd() + "\n;\n" +
    `insert into supabase_migrations.schema_migrations (version) values ('${mig.version}') on conflict do nothing;\n` +
    "commit;\n";
  await runSql(token, projectRef, sql);
}

// Stamp-only mode: record versions as applied without running their SQL.
// Use when the signature objects are known to already exist (e.g. because
// someone ran the SQL out-of-band) and you just need schema_migrations to
// reflect reality so future pushes don't re-apply them.
async function stampOnly(token, projectRef, versions) {
  const values = versions.map((v) => `('${v}')`).join(", ");
  const sql =
    `insert into supabase_migrations.schema_migrations (version) values ${values}\n` +
    `  on conflict (version) do nothing returning version;`;
  const rows = await runSql(token, projectRef, sql);
  const stamped = Array.isArray(rows) ? rows.map((r) => String(r.version)) : [];
  const skipped = versions.filter((v) => !stamped.includes(v));
  return { stamped, skipped };
}

// ── 5. Orchestrate ─────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(MIGRATIONS_DIR)) die(`migrations dir not found: ${MIGRATIONS_DIR}`);

  const local = readLocalMigrations();
  if (local.length === 0) die("no local migrations");

  const projectRef = resolveProjectRef();
  const token = resolveAccessToken();

  vinfo(`project ref: ${projectRef}`);

  let remote;
  try {
    remote = await fetchRemoteVersions(token, projectRef);
  } catch (e) {
    die(`cannot reach remote: ${e.message}`);
  }

  const pending = local.filter((m) => !remote.has(m.version));
  const extraRemote = [...remote].filter((v) => !local.some((m) => m.version === v));

  info(`local migrations:       ${local.length}`);
  info(`already applied remote: ${remote.size}`);
  info(`pending to apply:       ${pending.length}`);
  if (extraRemote.length > 0) {
    info(`remote has ${extraRemote.length} version(s) not in repo: ${extraRemote.join(", ")}`);
  }

  // Stamp-only short-circuit: record the requested versions as applied and
  // exit. Runs regardless of --apply (the operation is itself the mutation
  // the caller asked for).
  if (STAMP_ONLY) {
    // Only stamp versions that are actually local migrations (guard against
    // typos). Silently skip versions already on remote.
    const localSet = new Set(local.map((m) => m.version));
    const unknown = STAMP_ONLY.filter((v) => !localSet.has(v));
    if (unknown.length > 0) {
      die(`unknown version(s) for stamp (no matching local migration): ${unknown.join(", ")}`);
    }
    const toStamp = STAMP_ONLY.filter((v) => !remote.has(v));
    const alreadyStamped = STAMP_ONLY.filter((v) => remote.has(v));
    if (alreadyStamped.length > 0) {
      info(`already stamped: ${alreadyStamped.join(", ")}`);
    }
    if (toStamp.length === 0) {
      info("nothing to stamp — all requested versions already recorded");
      return;
    }
    info(`stamping (no SQL run): ${toStamp.join(", ")}`);
    const { stamped, skipped } = await stampOnly(token, projectRef, toStamp);
    info(`stamped ${stamped.length} version(s)${skipped.length ? ` (race: ${skipped.join(", ")} pre-existed)` : ""}`);
    return;
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

  info("applying in order (single BEGIN/COMMIT per file via Management API)");
  let applied = 0;
  for (const mig of pending) {
    process.stdout.write(`  → ${mig.filename} ... `);
    try {
      await applyOne(token, projectRef, mig);
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

main().catch((e) => die(e.message, 1));
