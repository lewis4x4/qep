-- ============================================================================
-- Migration 545: Generate Daily Briefing Cron — Modern Pattern (Idempotent)
--
-- Schedules generate-daily-briefing for advisor banner data (daily_briefings).
-- This migration only creates the cron job when absent.
--
-- Environment safety:
-- - Derives URL + x-internal-service-secret from existing cron commands.
-- - If either value cannot be resolved, skips with a notice (no hard-fail).
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base text;
  v_source_command text;
  v_command text;
begin
  -- Skip gracefully in environments without cron/http extensions.
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping generate-daily-briefing-daily: pg_cron not installed in this environment';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping generate-daily-briefing-daily: pg_net not installed in this environment';
    return;
  end if;

  -- If already present, do nothing (idempotent / non-destructive).
  if exists (select 1 from cron.job where jobname = 'generate-daily-briefing-daily') then
    raise notice 'generate-daily-briefing-daily already exists; skipping';
    return;
  end if;

  -- Resolve a trusted source command. Prefer flow-runner; otherwise use any
  -- existing cron command that includes x-internal-service-secret + functions/v1 URL.
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
    raise notice 'Skipping generate-daily-briefing-daily: no existing cron command found with x-internal-service-secret and /functions/v1/ URL';
    return;
  end if;

  -- Extract base URL from existing command.
  select substring(v_source_command from '(https://[^''[:space:]]+)/functions/v1/') into v_url_base;

  if v_url_base is null or v_url_base = '' then
    raise notice 'Skipping generate-daily-briefing-daily: could not resolve Supabase URL from existing cron command';
    return;
  end if;

  -- Extract shared internal secret from existing command.
  v_secret := split_part(
    split_part(
      v_source_command,
      $tag1$x-internal-service-secret', '$tag1$,
      2
    ),
    $tag2$'$tag2$,
    1
  );

  if v_secret is null or v_secret = '' then
    raise notice 'Skipping generate-daily-briefing-daily: could not resolve internal-service-secret from existing cron command';
    return;
  end if;

  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/generate-daily-briefing',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )$cmd$,
    v_url_base, v_secret
  );

  perform cron.schedule(
    'generate-daily-briefing-daily',
    '0 10 * * *', -- UTC schedule (10:00 UTC; 05:00 CT in daylight time, 04:00 CT in standard time)
    v_command
  );

  raise notice 'Scheduled generate-daily-briefing-daily for 0 10 * * * (UTC)';
end;
$do$;
