-- ============================================================================
-- Migration 567: M365 token refresh cron + token health telemetry
--
-- Adds observability fields to onedrive_sync_state and schedules a recurring
-- edge-function refresh pass so OAuth tokens rotate before expiry.
-- ============================================================================

alter table public.onedrive_sync_state
  add column if not exists token_last_refreshed_at timestamptz,
  add column if not exists token_refresh_error text,
  add column if not exists token_refresh_fail_count integer not null default 0;

create index if not exists idx_onedrive_sync_state_expires_at
  on public.onedrive_sync_state (token_expires_at)
  where refresh_token is not null;

comment on column public.onedrive_sync_state.token_last_refreshed_at is
  'Last successful access-token refresh timestamp.';

comment on column public.onedrive_sync_state.token_refresh_error is
  'Most recent token refresh error message (if any).';

comment on column public.onedrive_sync_state.token_refresh_fail_count is
  'Consecutive refresh failures since last successful refresh.';

do $do$
declare
  v_secret text;
  v_url_base text;
  v_source_command text;
  v_command text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping m365-token-refresh-every-10m: pg_cron not installed';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping m365-token-refresh-every-10m: pg_net not installed';
    return;
  end if;

  -- Resolve URL + internal secret from an existing known-good cron command.
  select command
  into v_source_command
  from cron.job
  where jobname = 'flow-runner'
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
    raise notice 'Skipping m365-token-refresh-every-10m: no existing cron command found with x-internal-service-secret + /functions/v1/';
    return;
  end if;

  select substring(v_source_command from '(https://[^''[:space:]]+)/functions/v1/') into v_url_base;
  if v_url_base is null or v_url_base = '' then
    raise notice 'Skipping m365-token-refresh-every-10m: could not resolve URL base from existing cron command';
    return;
  end if;

  v_secret := split_part(
    split_part(v_source_command, $tag1$x-internal-service-secret', '$tag1$, 2),
    $tag2$'$tag2$,
    1
  );
  if v_secret is null or v_secret = '' then
    raise notice 'Skipping m365-token-refresh-every-10m: could not resolve internal-service-secret from existing cron command';
    return;
  end if;

  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/m365-token-refresh',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )$cmd$,
    v_url_base, v_secret
  );

  perform cron.unschedule('m365-token-refresh-every-10m')
    where exists (select 1 from cron.job where jobname = 'm365-token-refresh-every-10m');

  perform cron.schedule(
    'm365-token-refresh-every-10m',
    '*/10 * * * *',
    v_command
  );

  raise notice 'Scheduled m365-token-refresh-every-10m';
end;
$do$;
