-- ============================================================================
-- Migration 205: Morning Briefing Cron — Modern Pattern
--
-- Restores the daily morning-briefing job, which silently disappeared from
-- pg_cron because the original migration (059_cron_edge_function_scheduling)
-- depends on `current_setting('app.settings.service_role_key')` GUCs that no
-- longer exist in modern Supabase projects. As of this migration the
-- production cron.job table has 5 jobs and none of them is the briefing,
-- and morning_briefings has only 2 rows ever (latest 2026-04-02).
--
-- Modern pattern (matches the working flow-runner / analytics-snapshot-runner
-- jobs already in cron.job): hardcoded function URL + x-internal-service-secret
-- header. The shared INTERNAL_SERVICE_SECRET is read from the existing
-- flow-runner cron command so this migration doesn't need to embed any
-- secret material in version control.
--
-- Note on dollar-quoting: Postgres does not allow nested dollar-quotes with
-- the same tag, so this migration uses distinct tags ($do$, $tag1$, $tag2$,
-- $cmd$) for the outer DO block, the two split_part literals, and the
-- format() command template.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
  v_command text;
begin
  -- ── 1. Verify pg_cron and pg_net are present ──────────────────────────────
  -- Skip gracefully on shadow / local where these extensions aren't installed.
  -- Matches the pattern of migrations 011, 046, 059, 072, 088, etc. Prod has
  -- both extensions enabled, so the work always runs in the deployed env.
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping morning-briefing-daily: pg_cron not installed in this environment';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping morning-briefing-daily: pg_net not installed in this environment';
    return;
  end if;

  -- ── 2. Extract the shared internal secret from the existing flow-runner ─
  -- This avoids hardcoding the secret in a committed migration. The
  -- flow-runner cron is the canonical source of truth for the project's
  -- internal-service-secret value.
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
    raise exception 'Could not extract internal-service-secret from flow-runner cron command. Register flow-runner first or set the secret manually.';
  end if;

  raise notice 'Resolved internal-service-secret from flow-runner (% chars)', length(v_secret);

  -- ── 3. Build the cron command ─────────────────────────────────────────────
  -- timeout_milliseconds := 120000 because batch generation calls OpenAI once
  -- per active user. pg_net's default 5s timeout is far too short and causes
  -- the request to be marked timed_out even though the function completes
  -- serverside. 120s gives plenty of headroom for ~10 users.
  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/morning-briefing',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{"batch": true}'::jsonb,
      timeout_milliseconds := 120000
    )$cmd$,
    v_url_base, v_secret
  );

  -- ── 4. Idempotent reschedule ──────────────────────────────────────────────
  if exists (select 1 from cron.job where jobname = 'morning-briefing-daily') then
    perform cron.unschedule('morning-briefing-daily');
    raise notice 'Unscheduled existing morning-briefing-daily';
  end if;

  perform cron.schedule(
    'morning-briefing-daily',
    '0 11 * * *',  -- 11:00 UTC = 06:00 CT
    v_command
  );
  raise notice 'Scheduled morning-briefing-daily for 0 11 * * * (06:00 CT)';

  -- ── 5. Immediate one-shot so users see today's brief without waiting ─────
  -- pg_net.http_post is async — it queues the request and returns a
  -- request_id immediately. The actual HTTP call happens in the background
  -- and the edge function generates briefs for every active user. The
  -- function continues running serverside even if pg_net's local connection
  -- gets dropped on timeout, so the row writes are reliable.
  perform net.http_post(
    url := format('%s/functions/v1/morning-briefing', v_url_base),
    headers := jsonb_build_object(
      'x-internal-service-secret', v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{"batch": true, "regenerate": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  raise notice 'Queued one-shot morning-briefing batch (regenerate=true) so today briefs land immediately';
end;
$do$;
