-- ============================================================================
-- Migration 327: Hub — hub-feedback-preview-poll cron (every 2 minutes)
--
-- Scans hub_feedback rows with an open draft PR but no preview URL yet,
-- hits GitHub combined-status for a netlify/* success context, and stamps
-- claude_preview_url + emits a preview_ready event so hub-feedback-notify
-- emails the submitter "your fix is live at <url>."
--
-- 2-minute cadence balances Netlify cold-start latency (~45-90 s per
-- build) against GitHub API budget: at 30 rows/tick × 2 GH calls per
-- row × 30 ticks/hour = 1800 calls/hr, well under the 5000/hr token
-- budget. The partial index from migration 326 keeps the candidate scan
-- cheap regardless of total feedback row count.
--
-- Follows the 322 pattern: extracts internal-service-secret from the
-- flow-runner cron command; skips gracefully when pg_cron / pg_net aren't
-- installed (shadow / local environments).
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
  v_command text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping hub-feedback-preview-poll-every-2min: pg_cron not installed in this environment';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping hub-feedback-preview-poll-every-2min: pg_net not installed in this environment';
    return;
  end if;

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

  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/hub-feedback-preview-poll',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )$cmd$,
    v_url_base, v_secret
  );

  if exists (select 1 from cron.job where jobname = 'hub-feedback-preview-poll-every-2min') then
    perform cron.unschedule('hub-feedback-preview-poll-every-2min');
    raise notice 'Unscheduled existing hub-feedback-preview-poll-every-2min';
  end if;

  perform cron.schedule(
    'hub-feedback-preview-poll-every-2min',
    '*/2 * * * *',  -- every 2 minutes
    v_command
  );
  raise notice 'Scheduled hub-feedback-preview-poll-every-2min (every 2 minutes)';

end;
$do$;
