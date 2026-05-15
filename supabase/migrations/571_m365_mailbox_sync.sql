-- M365 mailbox sync telemetry and cron.

alter table public.onedrive_sync_state
  add column if not exists m365_mail_last_synced_at timestamptz,
  add column if not exists m365_mail_sync_error text,
  add column if not exists m365_mail_sync_fail_count integer not null default 0;

comment on column public.onedrive_sync_state.m365_mail_last_synced_at is
  'Last successful Microsoft Graph mailbox-to-signal sync timestamp.';
comment on column public.onedrive_sync_state.m365_mail_sync_error is
  'Most recent Microsoft Graph mailbox sync error message, if any.';
comment on column public.onedrive_sync_state.m365_mail_sync_fail_count is
  'Consecutive mailbox sync failures since the last successful mailbox sync.';

do $do$
declare
  v_secret text;
  v_url_base text;
  v_source_command text;
  v_command text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping m365-mailbox-sync-every-10m: pg_cron not installed';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping m365-mailbox-sync-every-10m: pg_net not installed';
    return;
  end if;

  select command
  into v_source_command
  from cron.job
  where jobname = 'm365-token-refresh-every-10m'
  limit 1;

  if v_source_command is null then
    select command
    into v_source_command
    from cron.job
    where command like '%x-internal-service-secret%'
      and command like '%/functions/v1/%'
    order by jobid asc
    limit 1;
  end if;

  if v_source_command is null then
    raise notice 'Skipping m365-mailbox-sync-every-10m: no existing cron command found with x-internal-service-secret + /functions/v1/';
    return;
  end if;

  select substring(v_source_command from '(https://[^''[:space:]]+)/functions/v1/') into v_url_base;
  if v_url_base is null or v_url_base = '' then
    raise notice 'Skipping m365-mailbox-sync-every-10m: could not resolve URL base from existing cron command';
    return;
  end if;

  v_secret := split_part(
    split_part(v_source_command, $tag1$x-internal-service-secret', '$tag1$, 2),
    $tag2$'$tag2$,
    1
  );
  if v_secret is null or v_secret = '' then
    raise notice 'Skipping m365-mailbox-sync-every-10m: could not resolve internal-service-secret from existing cron command';
    return;
  end if;

  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/m365-mailbox-sync',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )$cmd$,
    v_url_base, v_secret
  );

  perform cron.unschedule('m365-mailbox-sync-every-10m')
    where exists (select 1 from cron.job where jobname = 'm365-mailbox-sync-every-10m');

  perform cron.schedule(
    'm365-mailbox-sync-every-10m',
    '*/10 * * * *',
    v_command
  );

  raise notice 'Scheduled m365-mailbox-sync-every-10m';
end;
$do$;
