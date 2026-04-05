-- ============================================================================
-- Migration 105: Additional service engine cron schedules
--
-- Registers pg_cron jobs for service-vendor-escalator (15m) and
-- service-jobcode-learner (daily 06:00 UTC). Requires same prerequisites as 097.
-- ============================================================================

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping migration 105 cron: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping migration 105 cron: pg_net not available.';
    return;
  end if;

  _base_url := current_setting('app.settings.supabase_url', true);
  if _base_url is null or _base_url = '' then
    raise notice 'Skipping migration 105 cron: app.settings.supabase_url not configured.';
    return;
  end if;

  _service_key := coalesce(current_setting('app.settings.service_role_key', true), '');
  if _service_key = '' then
    raise notice 'Skipping migration 105 cron: service role key not configured.';
    return;
  end if;

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
end;
$cron$;
