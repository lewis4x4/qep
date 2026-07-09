# Service engine cron (TAT, stage enforcer, vendor escalation, jobcode learner, customer notify)

**GitHub Actions is the authoritative scheduler for the service workers.**
(Corrected in N5.1 — this doc previously described a pg_cron "Path A" as
primary, but those jobs were never registered in prod: migrations `097`,
`105`, and `107` gate on `app.settings.supabase_url` /
`app.settings.service_role_key` GUCs that never existed on the modern
Supabase project, so every registration silently no-opped. Migration `802`
defensively unschedules any `service-*-periodic` job in environments where
they might exist. Do not resurrect that path — new pg_cron jobs use the
vault-backed `x-internal-service-secret` pattern, see m788 §4.)

## Scheduler — GitHub Actions

- **Frequent:** `.github/workflows/service-cron.yml` (every 5 minutes) —
  POSTs `service-tat-monitor`, `service-stage-enforcer`,
  `service-vendor-escalator`, `service-customer-notify-dispatch`.
- **Nightly:** `.github/workflows/service-cron-nightly.yml` —
  `service-jobcode-learner` at 06:00 UTC.

**Repository secrets**

| Name | Value |
|------|--------|
| `SUPABASE_URL` | Project URL (`https://<ref>.supabase.co`, no trailing slash) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key from Supabase dashboard |

## Related pg_cron jobs (vault pattern, not GHA)

Registered by migration `802` on the database scheduler:

- `service-job-delay-scan` — hourly `scan_service_job_delays()`; emits
  `service.job.delayed` flow events (consumed by the
  `service-delay-strategic-account` workflow via `flow-runner`).

## Concurrency safety

`service-customer-notify-dispatch` claims rows atomically via
`claim_service_customer_notifications` (m802: `FOR UPDATE SKIP LOCKED` +
5-minute lease). Overlapping invocations — GHA tick + manual invoke, or a
provider call spilling past the 5-minute cadence — cannot double-send.
Failed sends stay retryable: the row's lease expires and it is re-claimed
on a later tick. Delivery is still marked in `metadata.delivered` only
after provider HTTP success.

## Health check

`GET` with `Authorization: Bearer <SERVICE_ROLE_KEY>`
(`service-customer-notify-dispatch` additionally accepts
`x-internal-service-secret: <INTERNAL_SERVICE_SECRET>` since N5.1):

- `GET /functions/v1/service-tat-monitor`
- `GET /functions/v1/service-stage-enforcer`
- `GET /functions/v1/service-vendor-escalator`
- `GET /functions/v1/service-jobcode-learner`
- `GET /functions/v1/service-customer-notify-dispatch`

Each returns `{ ok: true, function: "...", ts: "..." }`.

**Production sign-off (scheduling, GitHub secrets, Netlify, verification):** [SERVICE_ENGINE_PRODUCTION_SIGNOFF.md](./SERVICE_ENGINE_PRODUCTION_SIGNOFF.md).

## Execution log (`service_cron_runs`)

Migration **109** adds `service_cron_runs` (workspace, job name, timestamps, ok/error). These workers append a row on each **POST** (cron) invocation — success with summary `metadata`, or failure with `ok: false` and `error`:

`service-tat-monitor`, `service-stage-enforcer`, `service-vendor-escalator`, `service-jobcode-learner`, `service-customer-notify-dispatch` (via `_shared/service-cron-run.ts`).

Set **`SERVICE_CRON_RUNS_DISABLED=true`** in Edge Function env to skip writes globally. Admins and managers can `select` via RLS; inserts use `service_role`. **GET** health checks do not log.

Note: `service_cron_runs` only covers the workers listed above plus
`flow-runner` and the `analytics-*` jobs. Fleet-wide cron health is
observed in `cron.job_run_details` (pg_cron's own log), not here.
