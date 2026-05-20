-- ============================================================================
-- Migration 606: Morning Briefing Cron — 6 AM America/New_York Semantics
--
-- DH-1 makes public.morning_briefings the canonical Sales Today briefing path.
-- The daily generator must therefore run at the intended sales-day start:
-- 6:00 AM America/New_York.
--
-- pg_cron stores schedules in UTC and cannot express DST-aware local time by
-- itself. Schedule both possible UTC ticks (10:00 UTC during EDT and 11:00 UTC
-- during EST) and let the Edge Function enforce { "enforce_et_hour": 6 } using
-- America/New_York at runtime. Existing-row idempotency still prevents duplicate
-- persisted rows if both ticks are ever accepted unexpectedly.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_source_command text;
  v_has_existing_morning_job boolean := false;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
  v_command text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping morning-briefing-daily ET reschedule: pg_cron not installed in this environment';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping morning-briefing-daily ET reschedule: pg_net not installed in this environment';
    return;
  end if;

  select exists (
    select 1 from cron.job where jobname = 'morning-briefing-daily'
  ) into v_has_existing_morning_job;

  -- Prefer the canonical flow-runner job as the shared modern cron secret
  -- source, but preserve the existing morning-briefing-daily secret if
  -- flow-runner is not present in a given environment.
  select command into v_source_command
  from cron.job
  where jobname = 'flow-runner'
  limit 1;

  if v_source_command is null then
    select command into v_source_command
    from cron.job
    where jobname = 'morning-briefing-daily'
    limit 1;
  end if;

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
    if v_has_existing_morning_job then
      raise exception 'Cannot convert existing morning-briefing-daily to 6 AM America/New_York semantics: no x-internal-service-secret could be extracted from flow-runner or the existing morning job';
    end if;

    raise notice 'Skipping morning-briefing-daily ET schedule: no flow-runner or existing morning cron secret source is configured in this environment';
    return;
  end if;

  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/morning-briefing',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{"batch": true, "enforce_et_hour": 6}'::jsonb,
      timeout_milliseconds := 120000
    )$cmd$,
    v_url_base, v_secret
  );

  if exists (select 1 from cron.job where jobname = 'morning-briefing-daily') then
    perform cron.unschedule('morning-briefing-daily');
    raise notice 'Unscheduled existing morning-briefing-daily before ET-aware reschedule';
  end if;

  perform cron.schedule(
    'morning-briefing-daily',
    '0 10,11 * * *',
    v_command
  );
  raise notice 'Scheduled morning-briefing-daily for 0 10,11 * * * with Edge Function 6 AM America/New_York gate';
end;
$do$;
