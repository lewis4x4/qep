# Pushing migrations to the remote Supabase project

## Why there's a wrapper instead of `supabase db push`

The repo has used `NNN_snake_case.sql` (3-digit sequence) for migration
filenames since day one. Supabase CLI **2.84+** rejects that format at
`supabase db push` time with:

```
file name must match pattern "<timestamp>_name.sql"
```

Renaming 336 migrations to `YYYYMMDDHHMMSS_*` would churn every open PR,
break ticket references ("see migration 293"), and invalidate
`scripts/check-migration-order.mjs`. So we bypass `supabase db push` and
apply via direct `psql` — the same mechanism committers were already
using out-of-band — but wrapped in a script so it's repeatable, atomic,
and keeps `supabase_migrations.schema_migrations` in sync.

## Usage

**Dry-run (default):**

```bash
SUPABASE_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
  bun run db:push
```

Prints the list of pending migrations and exits without writing anything.

**Apply:**

```bash
SUPABASE_DB_URL='postgresql://...' bun run db:push:apply
```

Or use the split form (password + project ref; script builds the URL):

```bash
SUPABASE_PROJECT_REF=iciddijgonywtxoelous \
SUPABASE_DB_PASSWORD='<postgres-password>' \
  bun run db:push:apply
```

## Safety model

- **Every migration runs in a single `psql --single-transaction`.** If
  any statement fails, the entire migration rolls back — no half-applied
  files.
- The `schema_migrations` stamp is appended **inside the same
  transaction**, so a failing migration leaves no ghost row behind.
- The script stops at the **first failure** and reports which migration
  broke so you can inspect and retry without reapplying earlier files.
- Already-applied migrations (already in `schema_migrations`) are
  skipped.

## What counts as "applied"

The remote `supabase_migrations.schema_migrations` table is the source
of truth. `version` values match the 3-digit prefix of the filename
(`293`, `304`, `335`). The script only writes a row after its SQL
successfully runs.

If a migration was applied out-of-band without a stamp, the script will
try to re-apply it — most migrations in this repo are idempotent
(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS`, `CREATE POLICY IF NOT EXISTS`), so the re-run is a no-op that
ends by writing the stamp. For migrations that would conflict on
re-apply (e.g. `CREATE TABLE foo`), either hand-stamp it first:

```sql
insert into supabase_migrations.schema_migrations (version)
values ('NNN') on conflict do nothing;
```

...or edit the migration to add `IF NOT EXISTS` guards and push normally.

## Troubleshooting

- **"missing connection"** — set `SUPABASE_DB_URL` (preferred) or both
  `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD`.
- **"psql query failed: ... does not exist"** — `supabase_migrations`
  schema hasn't been initialized on the target. The script creates a
  fresh project handling: it treats that as "no versions applied yet"
  and applies everything.
- **Password has special chars (`@`, `:`, `/`, `?`)** — use the split
  form (`SUPABASE_DB_PASSWORD`); the script URL-encodes it. If you pass
  `SUPABASE_DB_URL` directly, encode the password yourself.
- **Script uses `/opt/homebrew/opt/libpq/bin/psql` if present** (Mac
  Homebrew default); otherwise falls back to `psql` on `PATH`. Linux
  runners should just have `postgresql-client` installed.

## When to retire this wrapper

Once every migration has been renamed to `<timestamp>_name.sql` AND
`supabase_migrations.schema_migrations` has been backfilled with the
new version strings, `supabase db push` will work natively. Until then
(and given the cost of that migration), this wrapper is the path.
