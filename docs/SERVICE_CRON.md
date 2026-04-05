# Service engine cron (TAT, stage enforcer, vendor escalation, jobcode learner, customer notify)

Two ways to run the workers on schedule:

## Path A — `pg_cron` (primary)

1. Ensure extensions `pg_cron` and (if used) `pg_net` are available on the Supabase project.
2. Set database settings so scheduled jobs can call Edge Functions:
   - `app.settings.supabase_url` — project URL (`https://<ref>.supabase.co`)
   - `app.settings.service_role_key` — **service role** key (rotate if exposed)
3. Apply migrations **`097`** (base workers), **`105`** (vendor-escalator + jobcode-learner), and **`107`** (customer notify dispatch) after settings exist so cron jobs are registered.

Health check (requires `Authorization: Bearer <SERVICE_ROLE_KEY>`):

- `GET /functions/v1/service-tat-monitor`
- `GET /functions/v1/service-stage-enforcer`
- `GET /functions/v1/service-vendor-escalator`
- `GET /functions/v1/service-jobcode-learner`
- `GET /functions/v1/service-customer-notify-dispatch`

Each returns `{ ok: true, function: "...", ts: "..." }`.

## Path B — GitHub Actions (fallback)

- **Frequent:** `.github/workflows/service-cron.yml` (every 5 minutes) — POSTs `service-tat-monitor`, `service-stage-enforcer`, `service-vendor-escalator`.
- **Nightly:** `.github/workflows/service-cron-nightly.yml` — `service-jobcode-learner` at 06:00 UTC.

Add a workflow step for `service-customer-notify-dispatch` if `pg_cron` is unavailable (same secrets as other workers).

**Repository secrets**

| Name | Value |
|------|--------|
| `SUPABASE_URL` | Same as `SUPABASE_URL` (e.g. `https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key from Supabase dashboard |

No trailing slash on `SUPABASE_URL`.

**Production sign-off (scheduling, GitHub secrets, Netlify, verification):** [SERVICE_ENGINE_PRODUCTION_SIGNOFF.md](./SERVICE_ENGINE_PRODUCTION_SIGNOFF.md).

## Optional execution log (`service_cron_runs`)

Migration **109** adds `service_cron_runs` (workspace, job name, timestamps, ok/error). Workers record rows by default. Set **`SERVICE_CRON_RUNS_DISABLED=true`** in the Edge Function environment to skip writes (see `_shared/service-cron-run.ts`). Admins and managers can `select` via RLS; inserts use `service_role`.
