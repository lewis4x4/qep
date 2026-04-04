-- ============================================================================
-- Migration 088: Post-Sale Automation Wiring
-- ============================================================================

alter table public.escalation_tickets
  add column if not exists email_draft_subject text;

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping prospecting nudge cron: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping prospecting nudge cron: pg_net not available.';
    return;
  end if;

  _base_url := current_setting('app.settings.supabase_url', true);
  _service_key := coalesce(current_setting('app.settings.service_role_key', true), '');

  if _base_url is null or _base_url = '' or _service_key = '' then
    raise notice 'Skipping prospecting nudge cron: app settings not configured.';
    return;
  end if;

  perform cron.unschedule('prospecting-nudge-2pm')
    where exists (select 1 from cron.job where jobname = 'prospecting-nudge-2pm');

  perform cron.schedule(
    'prospecting-nudge-2pm',
    '0 19 * * 1-5',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/nudge-scheduler',
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
