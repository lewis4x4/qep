-- Schedule recurring edge-function invocations via pg_cron + pg_net.
-- Each job calls the Supabase Edge Function endpoint using the service role key.
-- Pattern: HTTP POST via net.http_post (Supabase pg_net extension).

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping edge-function cron jobs: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping edge-function cron jobs: pg_net not available.';
    return;
  end if;

  -- Retrieve project config from vault or env.  Supabase exposes these via
  -- current_setting when the pg_net + vault integration is active.
  _base_url := current_setting('app.settings.supabase_url', true);
  if _base_url is null or _base_url = '' then
    raise notice 'app.settings.supabase_url is not configured — cron HTTP jobs will not be scheduled.';
    return;
  end if;
  _service_key := coalesce(
    current_setting('app.settings.service_role_key', true),
    ''
  );

  if _service_key = '' then
    raise notice 'service_role_key not available in app.settings — cron HTTP calls will require manual config.';
  end if;

  -- 1. embed-crm: every 15 minutes
  perform cron.unschedule('embed-crm-refresh')
    where exists (select 1 from cron.job where jobname = 'embed-crm-refresh');

  perform cron.schedule(
    'embed-crm-refresh',
    '*/15 * * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/embed-crm',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$sql$,
      _base_url, _service_key
    )
  );

  -- 2. morning-briefing: daily at 6:00 AM CT (11:00 UTC)
  perform cron.unschedule('morning-briefing-daily')
    where exists (select 1 from cron.job where jobname = 'morning-briefing-daily');

  perform cron.schedule(
    'morning-briefing-daily',
    '0 11 * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/morning-briefing',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{"batch": true}'::jsonb
      );$sql$,
      _base_url, _service_key
    )
  );

  -- 3. anomaly-scan: every 4 hours
  perform cron.unschedule('anomaly-scan-periodic')
    where exists (select 1 from cron.job where jobname = 'anomaly-scan-periodic');

  perform cron.schedule(
    'anomaly-scan-periodic',
    '0 */4 * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/anomaly-scan',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$sql$,
      _base_url, _service_key
    )
  );

  raise notice 'Scheduled 3 edge-function cron jobs: embed-crm-refresh (*/15), morning-briefing-daily (11:00 UTC), anomaly-scan-periodic (*/4h).';

exception
  when undefined_object then
    raise notice 'Skipping edge-function cron jobs: required extension not available (%)', sqlerrm;
  when others then
    raise notice 'Skipping edge-function cron jobs: %', sqlerrm;
end;
$cron$;
