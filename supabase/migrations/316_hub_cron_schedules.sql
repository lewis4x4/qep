-- ============================================================================
-- Migration 316: Hub — cron schedules for changelog + stakeholder morning brief
--
-- Two jobs, both follow the migration 205 pattern (hardcoded function URL +
-- x-internal-service-secret header extracted from the existing flow-runner
-- cron command so this migration never embeds secret material).
--
--   1. hub-changelog-every-15min
--        Scans main for [QEP-*] commits every 15 min, synthesizes plain-voice
--        changelog rows via Claude, closes hub_feedback loop when a commit
--        links back via the hub-feedback-id PR marker.
--
--   2. stakeholder-morning-brief-daily
--        Runs at 11:00 UTC (≈ 06:00 America/New_York during EDT). Generates
--        a subrole-specific morning brief for every profile with
--        audience='stakeholder' and writes to morning_briefings (audience='stakeholder').
--
-- Both functions are deployed with verify_jwt=false (see supabase/config.toml)
-- and gate inside the function via isServiceRoleCaller(). If flow-runner
-- hasn't been registered yet (fresh local env without crons) this migration
-- raises a clear error instead of silently failing.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
  v_cmd_changelog text;
  v_cmd_brief text;
begin
  -- Skip gracefully on shadow / local where these extensions aren't installed.
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping hub cron jobs: pg_cron not installed in this environment';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping hub cron jobs: pg_net not installed in this environment';
    return;
  end if;

  -- Pull the internal secret out of the existing flow-runner cron command.
  v_secret := split_part(
    split_part(
      (select command from cron.job where jobname = 'flow-runner' limit 1),
      $tag1$x-internal-service-secret', '$tag1$,
      2
    ),
    $tag2$'$tag2$,
    1
  );

  if v_secret is null or v_secret = '' then
    raise exception 'Could not extract internal-service-secret from flow-runner cron command. Register flow-runner first.';
  end if;

  raise notice 'Resolved internal-service-secret (% chars) for hub cron jobs', length(v_secret);

  -- ── 1. hub-changelog-every-15min ─────────────────────────────────────────
  v_cmd_changelog := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/hub-changelog-from-commit',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 90000
    )$cmd$,
    v_url_base, v_secret
  );

  if exists (select 1 from cron.job where jobname = 'hub-changelog-every-15min') then
    perform cron.unschedule('hub-changelog-every-15min');
    raise notice 'Unscheduled existing hub-changelog-every-15min';
  end if;

  perform cron.schedule(
    'hub-changelog-every-15min',
    '*/15 * * * *',
    v_cmd_changelog
  );
  raise notice 'Scheduled hub-changelog-every-15min (every 15 min)';

  -- ── 2. stakeholder-morning-brief-daily ──────────────────────────────────
  v_cmd_brief := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/stakeholder-morning-brief',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 180000
    )$cmd$,
    v_url_base, v_secret
  );

  if exists (select 1 from cron.job where jobname = 'stakeholder-morning-brief-daily') then
    perform cron.unschedule('stakeholder-morning-brief-daily');
    raise notice 'Unscheduled existing stakeholder-morning-brief-daily';
  end if;

  perform cron.schedule(
    'stakeholder-morning-brief-daily',
    '0 11 * * *',  -- 11:00 UTC = 06:00 America/New_York (EDT)
    v_cmd_brief
  );
  raise notice 'Scheduled stakeholder-morning-brief-daily (11:00 UTC)';

end;
$do$;
