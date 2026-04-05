-- ============================================================================
-- Migration 107: Cron for service-customer-notify-dispatch (email/SMS queue)
-- Same prerequisites as 097 / 105 (pg_cron, pg_net, app.settings.*).
-- ============================================================================

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping migration 107 cron: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping migration 107 cron: pg_net not available.';
    return;
  end if;

  _base_url := current_setting('app.settings.supabase_url', true);
  if _base_url is null or _base_url = '' then
    raise notice 'Skipping migration 107 cron: app.settings.supabase_url not configured.';
    return;
  end if;

  _service_key := coalesce(current_setting('app.settings.service_role_key', true), '');
  if _service_key = '' then
    raise notice 'Skipping migration 107 cron: service role key not configured.';
    return;
  end if;

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
