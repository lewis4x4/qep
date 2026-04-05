-- ============================================================================
-- Migration 097: Service Engine Cron Jobs
--
-- Registers cron schedules for service-tat-monitor and service-stage-enforcer.
-- Follows the same pattern as 072_pipeline_enforcer_cron.sql.
-- ============================================================================

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping service cron jobs: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping service cron jobs: pg_net not available.';
    return;
  end if;

  _base_url := current_setting('app.settings.supabase_url', true);
  if _base_url is null or _base_url = '' then
    raise notice 'Skipping service cron jobs: app.settings.supabase_url not configured.';
    return;
  end if;

  _service_key := coalesce(current_setting('app.settings.service_role_key', true), '');
  if _service_key = '' then
    raise notice 'Skipping service cron jobs: service role key not configured.';
    return;
  end if;

  -- ── service-tat-monitor: every 5 minutes ─────────────────────────────────
  perform cron.unschedule('service-tat-monitor-periodic')
    where exists (select 1 from cron.job where jobname = 'service-tat-monitor-periodic');

  perform cron.schedule(
    'service-tat-monitor-periodic',
    '*/5 * * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/service-tat-monitor',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb
      );$sql$,
      _base_url,
      _service_key
    )
  );

  -- ── service-stage-enforcer: every 5 minutes ──────────────────────────────
  perform cron.unschedule('service-stage-enforcer-periodic')
    where exists (select 1 from cron.job where jobname = 'service-stage-enforcer-periodic');

  perform cron.schedule(
    'service-stage-enforcer-periodic',
    '*/5 * * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/service-stage-enforcer',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb
      );$sql$,
      _base_url,
      _service_key
    )
  );
end;
$cron$;
