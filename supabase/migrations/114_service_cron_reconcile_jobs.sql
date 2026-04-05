-- ============================================================================
-- Migration 114: Reconcile Service Engine pg_cron jobs
--
-- Run after pg_cron + pg_net are enabled and app.settings.supabase_url /
-- app.settings.service_role_key are set. Idempotent: same job names as 097, 105, 107.
-- Use when those migrations ran while pg_cron was unavailable (no-op) or to fix drift.
-- ============================================================================

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping migration 114 cron reconcile: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping migration 114 cron reconcile: pg_net not available.';
    return;
  end if;

  _base_url := current_setting('app.settings.supabase_url', true);
  if _base_url is null or _base_url = '' then
    raise notice 'Skipping migration 114 cron reconcile: app.settings.supabase_url not configured.';
    return;
  end if;

  _service_key := coalesce(current_setting('app.settings.service_role_key', true), '');
  if _service_key = '' then
    raise notice 'Skipping migration 114 cron reconcile: service role key not configured.';
    return;
  end if;

  -- From 097: TAT monitor + stage enforcer (every 5 minutes)
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

  -- From 105: vendor escalator (15m) + jobcode learner (daily 06:00 UTC)
  perform cron.unschedule('service-vendor-escalator-periodic')
    where exists (select 1 from cron.job where jobname = 'service-vendor-escalator-periodic');

  perform cron.schedule(
    'service-vendor-escalator-periodic',
    '*/15 * * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/service-vendor-escalator',
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

  perform cron.unschedule('service-jobcode-learner-nightly')
    where exists (select 1 from cron.job where jobname = 'service-jobcode-learner-nightly');

  perform cron.schedule(
    'service-jobcode-learner-nightly',
    '0 6 * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/service-jobcode-learner',
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

  -- From 107: customer notify dispatch (every 10 minutes)
  perform cron.unschedule('service-customer-notify-dispatch-periodic')
    where exists (select 1 from cron.job where jobname = 'service-customer-notify-dispatch-periodic');

  perform cron.schedule(
    'service-customer-notify-dispatch-periodic',
    '*/10 * * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/service-customer-notify-dispatch',
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
