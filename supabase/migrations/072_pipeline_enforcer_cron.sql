-- ============================================================================
-- Migration 072: Pipeline Enforcer & Follow-Up Engine Cron Schedules
-- ============================================================================

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping pipeline/follow-up cron jobs: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping pipeline/follow-up cron jobs: pg_net not available.';
    return;
  end if;

  _base_url := current_setting('app.settings.supabase_url', true);
  if _base_url is null or _base_url = '' then
    raise notice 'Skipping pipeline/follow-up cron jobs: app.settings.supabase_url not configured.';
    return;
  end if;

  _service_key := coalesce(current_setting('app.settings.service_role_key', true), '');
  if _service_key = '' then
    raise notice 'Skipping pipeline/follow-up cron jobs: service role key not configured.';
    return;
  end if;

  perform cron.unschedule('pipeline-enforcer-periodic')
    where exists (select 1 from cron.job where jobname = 'pipeline-enforcer-periodic');

  perform cron.schedule(
    'pipeline-enforcer-periodic',
    '*/5 * * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/pipeline-enforcer',
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

  perform cron.unschedule('follow-up-engine-hourly')
    where exists (select 1 from cron.job where jobname = 'follow-up-engine-hourly');

  perform cron.schedule(
    'follow-up-engine-hourly',
    '0 * * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/follow-up-engine',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron","batch_size":50}'::jsonb
      );$sql$,
      _base_url,
      _service_key
    )
  );
end;
$cron$;
