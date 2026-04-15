-- ============================================================================
-- Migration 255: Prospecting Nudge cron (QRM Track 2 Slice 2.5)
--
-- Schedules the `prospecting-nudge` edge function to fire once per day at
-- ~2 PM local (19:00 UTC ≈ 2 PM CT in standard time; drifts ~1 hour during
-- DST transitions — matches the convention used by migrations 205, 220, 221).
--
-- The nudge scans today's `prospecting_kpis` for every workspace and creates
-- a `crm_in_app_notifications` row for each manager who has at least one
-- under-target rep. Idempotent on second fire: dedup key is
-- (workspace_id, user_id, rep_id, kpi_date).
--
-- Pattern copied from migration 205_morning_briefing_cron_modern.sql — reads
-- the INTERNAL_SERVICE_SECRET out of the existing flow-runner cron command
-- rather than hardcoding a secret into version control.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
  v_command text;
begin
  -- ── 1. Verify pg_cron and pg_net are present ──────────────────────────────
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping prospecting-nudge cron: pg_cron not available.';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping prospecting-nudge cron: pg_net not available.';
    return;
  end if;

  -- ── 2. Extract the shared internal secret from the flow-runner cron ──────
  v_secret := split_part(
    split_part(
      (select command from cron.job where jobname = 'flow-runner' limit 1),
      $tag1$x-internal-service-secret', '$tag1$,
      2
    ),
    $tag2$'$tag2$,
    1
  );

  if v_secret is null or v_secret = '' then
    raise notice 'Skipping prospecting-nudge cron: could not extract internal-service-secret from flow-runner. Register flow-runner first.';
    return;
  end if;

  raise notice 'Resolved internal-service-secret from flow-runner (% chars)', length(v_secret);

  -- ── 3. Build the cron command ────────────────────────────────────────────
  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/prospecting-nudge',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )$cmd$,
    v_url_base, v_secret
  );

  -- ── 4. Idempotent reschedule ─────────────────────────────────────────────
  if exists (select 1 from cron.job where jobname = 'prospecting-nudge-daily') then
    perform cron.unschedule('prospecting-nudge-daily');
    raise notice 'Unscheduled existing prospecting-nudge-daily';
  end if;

  perform cron.schedule(
    'prospecting-nudge-daily',
    '0 19 * * *',  -- 19:00 UTC ≈ 14:00 CT (drifts to 15:00 during CDT)
    v_command
  );
  raise notice 'Scheduled prospecting-nudge-daily for 0 19 * * * (~2 PM CT)';
end;
$do$;

-- Rollback (manual):
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'prospecting-nudge-daily') then
--       perform cron.unschedule('prospecting-nudge-daily');
--     end if;
--   end $$;
