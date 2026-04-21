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
`scripts/check-migration-order.mjs`. So we bypass `supabase db push`
entirely and call the **Supabase Management API**
(`POST /v1/projects/{ref}/database/query`) with the access token the
CLI already has cached — no Postgres password required.

## Usage

No Postgres password needed — the script uses the same access token
`supabase login` cached in your OS keychain.

```bash
# Dry-run (default):
bun run db:push

# Apply:
bun run db:push:apply
```

### CI / headless runners

Export the token explicitly (Supabase → Account → Access Tokens):

```bash
SUPABASE_ACCESS_TOKEN=sbp_... bun run db:push:apply
```

### Different project

Override the project ref (default is read from `supabase/config.toml`):

```bash
SUPABASE_PROJECT_REF=abcd1234 bun run db:push:apply
```

## Safety model

- **Every migration runs inside an explicit `begin; ...; commit;`.** A
  failure anywhere in the file — or in the `schema_migrations` stamp
  that's appended to the same request — rolls the whole thing back.
- The `schema_migrations` stamp (`insert ... on conflict do nothing`)
  is the same transaction as the migration body, so a successful
  migration is always stamped and a rolled-back migration is never
  stamped.
- The script bails at the **first failure** and reports which file
  broke. Already-applied migrations earlier in the run keep their
  stamp; the failing one leaves no ghost state.
- Dry-run is the default. `--apply` (or the `db:push:apply` script)
  is required to mutate.

## What counts as "applied"

The remote `supabase_migrations.schema_migrations` table is the source
of truth. `version` values match the 3-digit prefix of the filename
(`293`, `304`, `335`). The script only writes a row after its SQL
successfully runs.

### Recovering from out-of-band drift

If a migration was applied out-of-band without a stamp, `db:push:apply`
will try to re-apply it and typically fail on the first bare
`create table` / `create type` (most migrations in this repo use
`if not exists` guards, but some older ones don't).

The recovery drill:

1. **Diagnose** — probe the remote for each signature object to
   classify the pending list into "already there" vs "genuinely
   missing". Query `to_regclass`, `to_regprocedure`, `pg_indexes`,
   `pg_type`, `cron.job`, etc. per-migration.

2. **Stamp the already-applied ones** — record them as applied without
   running their SQL:

   ```bash
   bun run db:push -- --stamp=304,305,306,310,311,312,313
   ```

   The flag accepts a comma-separated list of 3-digit versions. The
   script validates every version matches an existing local migration,
   skips any already-stamped, and bails on typos.

3. **Apply the real pending list** — `bun run db:push:apply` will now
   see only the genuinely-missing migrations and run each inside a
   BEGIN/COMMIT as usual.

This is exactly the drill used to recover 2026-04-20 when
`supabase migration list` showed 32 pending but 17 of them were
already materialized on remote (result of earlier out-of-band applies
when `supabase db push` was blocked by the filename-pattern issue).

## Troubleshooting

- **"no access token"** — run `supabase login` once; the CLI stores the
  token in your OS keychain. Alternatively export
  `SUPABASE_ACCESS_TOKEN` in the shell.
- **macOS keychain returns `go-keyring-encrypted:...`** — the CLI
  encrypted the token with a local key we don't have access to.
  Re-run `supabase login` (newer CLI versions default to
  base64 storage), or export `SUPABASE_ACCESS_TOKEN` directly.
- **"HTTP 404" with project ref mismatch** — confirm
  `supabase/config.toml`'s `project_id` matches the dashboard project
  you want to push to.
- **Management API rate limits** — around 60 calls/minute. The script
  does at most one per pending migration plus one list query, so it
  fits comfortably under the limit.
- **Linux keychain support** — not yet. Either export
  `SUPABASE_ACCESS_TOKEN` or add a `secret-tool` branch to
  `resolveAccessToken()` (TODO).

## When to retire this wrapper

Once every migration has been renamed to `<timestamp>_name.sql` AND
`supabase_migrations.schema_migrations` has been backfilled with the
new version strings, `supabase db push` will work natively. Until then
(and given the cost of that migration), this wrapper is the path.
