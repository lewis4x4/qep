# Epic #43 — IntelliDealer snapshot staging + M365 cron observability

**GitHub:** [lewis4x4/qep#43](https://github.com/lewis4x4/qep/issues/43)

## M365 token refresh (cron + telemetry)

| Artifact | Location |
|----------|----------|
| DB telemetry columns | `supabase/migrations/567_m365_token_refresh_cron.sql` → `onedrive_sync_state.token_last_refreshed_at`, `token_refresh_error`, `token_refresh_fail_count` |
| Cron job name | `m365-token-refresh-every-10m` (`*/10 * * * *`) → `POST …/functions/v1/m365-token-refresh` via `pg_net` |
| Edge function | `supabase/functions/m365-token-refresh/index.ts` |
| Related sync | `supabase/functions/m365-mailbox-sync/index.ts` |

**Supabase Dashboard (runtime):** **Edge Functions →** `m365-token-refresh` / `m365-mailbox-sync` **→ Logs**; **Reports →** API or Database logs if configured.

**Edge secrets (set in Dashboard, never in git):**

- `MSGRAPH_CLIENT_ID`
- `MSGRAPH_CLIENT_SECRET`
- `MSGRAPH_REDIRECT_URI`

If any of these are missing, refresh throws **`Missing MSGRAPH_CLIENT_ID, MSGRAPH_CLIENT_SECRET, or MSGRAPH_REDIRECT_URI`** and refresh fails closed for that token row.

**SQL — token health snapshot**

```sql
select
  id,
  user_id,
  token_expires_at,
  token_last_refreshed_at,
  token_refresh_fail_count,
  left(token_refresh_error, 200) as token_refresh_error_preview
from public.onedrive_sync_state
where refresh_token is not null
order by token_expires_at asc nulls first
limit 50;
```

**SQL — cron job registered**

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'm365-token-refresh-every-10m';
```

## IntelliDealer snapshot staging (migration 568)

| Staging table | Purpose |
|---------------|---------|
| `qrm_intellidealer_equipment_master_stage` | Raw equipment master rows |
| `qrm_intellidealer_quotes_history_stage` | Raw quotes history rows |
| `qrm_intellidealer_parts_master_stage` | Raw parts master rows |

**SQL — lane row counts (per workspace default)**

```sql
select 'equipment_master' as lane, count(*) from public.qrm_intellidealer_equipment_master_stage
union all
select 'quotes_history', count(*) from public.qrm_intellidealer_quotes_history_stage
union all
select 'parts_master', count(*) from public.qrm_intellidealer_parts_master_stage;
```

## Verification (repo)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run migrations:check
deno check supabase/functions/m365-token-refresh/index.ts supabase/functions/m365-mailbox-sync/index.ts
```

Or: `bun run verify:track-a-epics` (includes `deno check` for these two plus Track B + quote/floor tests + `audit:secrets`).

## See also

- [Epic #42 — Post-approval routing](./epic-42-post-approval-routing.md)
- [Epic #44 — Trade valuation audit](./epic-44-trade-valuation-audit.md) (comp-range UI vs customer PDF boundary).
- [Epic #46 — Merge ordering + staging verification](./epic-46-intellidealer-merge-staging-verification.md) (commit scripts, import dashboard, acceptance scripts).
