# Oracle Review

## Blocking Findings

### P1 — Cron migration can schedule an invalid doubled function URL

**File:** `supabase/migrations/545_generate_daily_briefing_cron_modern.sql`

**Issue:** The hard-coded URL is removed, but the replacement extraction likely captures the full existing function endpoint, not just the project origin:

```sql
select substring(v_source_command from '(https://[^''\s]+)') into v_url_base;
```

If the source cron contains:

```txt
https://project.supabase.co/functions/v1/flow-runner
```

then the generated job becomes:

```txt
https://project.supabase.co/functions/v1/flow-runner/functions/v1/generate-daily-briefing
```

That would schedule successfully but call the wrong endpoint, so `daily_briefings` may still never populate.

**Suggestion:** Extract only the origin before `/functions/v1/`, e.g.:

```sql
select substring(v_source_command from '(https://[^''[:space:]]+)/functions/v1/')
into v_url_base;
```

Then keep appending:

```sql
%s/functions/v1/generate-daily-briefing
```