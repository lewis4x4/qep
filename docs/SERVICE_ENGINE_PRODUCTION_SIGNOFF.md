# Service Engine — production sign-off

## Scheduling strategy (recorded decision)

| Path | Role |
|------|------|
| **Path B — GitHub Actions** | **Default** for this repo when `pg_cron` is not available on the Supabase project. Workflows: [`.github/workflows/service-cron.yml`](../.github/workflows/service-cron.yml) (every 5 min), [`.github/workflows/service-cron-nightly.yml`](../.github/workflows/service-cron-nightly.yml) (06:00 UTC). |
| **Path A — `pg_cron`** | Optional: enable `pg_cron` + `pg_net`, set DB settings, then apply migration **`114_service_cron_reconcile_jobs.sql`** (re-registers jobs 097/105/107 in one shot). |

**Do not** leave Path A and Path B both firing the same workers at full cadence without disabling one path — you will duplicate TAT/stage/vendor/customer-notify runs.

---

## Path B — GitHub Actions

1. **Repository → Settings → Secrets and variables → Actions → New repository secret**
2. Set:

| Secret | Value |
|--------|--------|
| `SUPABASE_URL` | `https://iciddijgonywtxoelous.supabase.co` (no trailing slash) |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Project Settings → API → `service_role` **secret** |

3. **Actions** tab → run **Service engine cron** and **Service engine nightly** via **Run workflow** (`workflow_dispatch`).
4. Confirm green checks. Workers invoked: `service-tat-monitor`, `service-stage-enforcer`, `service-vendor-escalator`, `service-customer-notify-dispatch` (cron workflow), `service-jobcode-learner` (nightly).

CLI (requires `gh auth login` and repo scope):

```bash
gh secret set SUPABASE_URL --body "https://iciddijgonywtxoelous.supabase.co"
gh secret set SUPABASE_SERVICE_ROLE_KEY --body "<paste_service_role_key>"
gh workflow run service-cron.yml
gh workflow run service-cron-nightly.yml
```

---

## Path A — `pg_cron` (optional)

1. Supabase **Database → Extensions**: enable **`pg_cron`**, **`pg_net`** (tier must allow them).
2. Set database settings (SQL or dashboard per Supabase docs for custom config):

   - `app.settings.supabase_url` = `https://iciddijgonywtxoelous.supabase.co`
   - `app.settings.service_role_key` = service role JWT (**rotate if exposed**)

3. Apply pending migrations including **`114_service_cron_reconcile_jobs.sql`**:

   ```bash
   supabase db push
   ```

4. Verify:

   ```sql
   select jobname, schedule from cron.job where jobname like 'service-%' order by jobname;
   ```

5. If Path A is live, **disable or pause** Path B schedules (or accept duplicate invocations only during cutover).

---

## Edge Functions — secrets (Supabase Dashboard)

**Project → Edge Functions → Manage secrets** (or project secrets, depending on UI).

**Baseline (most functions):**

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Feature-specific** (set if you use the feature):

| Variable | Used by |
|----------|---------|
| `OPENAI_API_KEY` | `service-intake`, others |
| `RESEND_API_KEY`, `RESEND_FROM` | `service-customer-notify-dispatch`, `service-vendor-escalator` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | `service-customer-notify-dispatch` |
| `VENDOR_INBOUND_WEBHOOK_SECRET` | `service-vendor-inbound` |
| `SERVICE_CRON_RUNS_DISABLED` | Set `true` to skip `service_cron_runs` inserts (optional) |

See also: [supabase/functions/secrets.example.env](../supabase/functions/secrets.example.env).

---

## Frontend hosting (Netlify / other)

1. **Site → Project configuration → Environment variables** (or Netlify UI equivalent).
2. Set:

   - `VITE_SUPABASE_URL` = `https://iciddijgonywtxoelous.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = project **anon** public key

3. **Supabase → Authentication → URL configuration**: add production site URL and redirect URLs (e.g. Netlify `https://*.netlify.app` or custom domain). Align with [../supabase/config.toml](../supabase/config.toml) patterns.

4. Redeploy the web app after changing env vars.

Reference template: [apps/web/.env.example](../apps/web/.env.example).

---

## Verification commands

```bash
cd /path/to/qep-knowledge-assistant
bun run migrations:check
supabase migration list
```

Workers (replace `SERVICE_ROLE_KEY`):

```bash
curl -sS -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  "https://iciddijgonywtxoelous.supabase.co/functions/v1/service-tat-monitor"
```

Portal API (expect 401 without `Authorization`):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://iciddijgonywtxoelous.supabase.co/functions/v1/portal-api/fleet"
```

---

## Sign-off checklist

- [ ] Path B: GitHub secrets set; workflows green; **or** Path A: extensions + settings + migration 114 applied; `cron.job` rows present.
- [ ] Not running Path A and Path B at full duplicate cadence without a documented cutover.
- [ ] Edge secrets set for workers you rely on; smoke curls return expected JSON.
- [ ] `VITE_*` set on host; auth redirects work for production URL; portal route loads.
- [ ] Optional: `service_cron_runs` rows appear after worker runs (unless `SERVICE_CRON_RUNS_DISABLED=true`).
