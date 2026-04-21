-- ============================================================================
-- Migration 322: Hub — hub-feedback-notify cron (every minute)
--
-- Drains hub_feedback_events rows with notified_submitter_at IS NULL and
-- fires the Resend email for shipped / wont_fix / pr_opened events. Every
-- other event_type is stamped as drained without emailing (in-app bell +
-- timeline carries those).
--
-- Scheduled every minute so the loop-back feels tight — a status transition
-- at T lands in the stakeholder's inbox by T + ~60 s on the happy path.
-- 50-events-per-run cap in the edge fn (MAX_EVENTS_PER_RUN) protects Resend
-- from bulk-replay floods.
--
-- Follows the 317 pattern: extracts internal-service-secret from the
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
    raise notice 'Skipping hub-feedback-notify-every-min: pg_cron not installed in this environment';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping hub-feedback-notify-every-min: pg_net not installed in this environment';
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
      url := '%s/functions/v1/hub-feedback-notify',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )$cmd$,
    v_url_base, v_secret
  );

  if exists (select 1 from cron.job where jobname = 'hub-feedback-notify-every-min') then
    perform cron.unschedule('hub-feedback-notify-every-min');
    raise notice 'Unscheduled existing hub-feedback-notify-every-min';
  end if;

  perform cron.schedule(
    'hub-feedback-notify-every-min',
    '* * * * *',  -- every minute
    v_command
  );
  raise notice 'Scheduled hub-feedback-notify-every-min (every minute)';

end;
$do$;
