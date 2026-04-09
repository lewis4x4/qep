-- ============================================================================
-- Migration 212: Publisher Crons — Modern Pattern (Wave 4b)
--
-- Migrations 059 / 072 / 088 / 093 / 211 schedule the 5 publishers via the
-- legacy `current_setting('app.settings.supabase_url')` GUC pattern. Modern
-- Supabase projects don't expose those GUCs, so all 5 schedules silently
-- fall through and never enter `cron.job`. Verified empirically against
-- iciddijgonywtxoelous: only 6 cron jobs exist, none of them publishers,
-- and every downstream table (flow_events, qrm_predictions, anomaly_alerts,
-- crm_in_app_notifications, follow_up_touchpoints) had 0 rows.
--
-- This migration restores 4 of the 5 schedules using the modern pattern from
-- migration 205 (morning-briefing): hardcoded URL + x-internal-service-secret
-- header extracted from the existing flow-runner cron command. The 5th
-- (embed-crm-refresh from migration 059) is intentionally OUT of scope —
-- embed-crm is owned by a separate workstream, not Phase 0.
--
-- Prerequisite: Wave 4a (commit d4643ae) MUST be deployed before this
-- migration applies. The 4 publishers were updated to accept
-- x-internal-service-secret in addition to the legacy
-- Authorization: Bearer service_role_key check, via the shared helper
-- supabase/functions/_shared/cron-auth.ts.
--
-- ── Dollar-quoting note ─────────────────────────────────────────────────────
--
-- Postgres does not allow nested dollar-quotes with the same tag, so this
-- migration uses distinct tags: $do$ for the outer DO block, $tag1$/$tag2$
-- for the secret-extraction split_part literals, and $cmd$ for the
-- format() command templates. Same tagging strategy as migration 205.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
begin
  -- ── 1. Verify pg_cron and pg_net are present ────────────────────────────
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron is not installed; cannot schedule publisher crons';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net is not installed; cannot schedule publisher crons';
  end if;

  -- ── 2. Extract the shared internal-service-secret from flow-runner ──────
  -- flow-runner is the canonical source of truth for this project. Migration
  -- 205 uses the same trick. Avoids hardcoding the secret in version control.
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

  -- ── 3. anomaly-scan: every 4 hours ──────────────────────────────────────
  -- Cadence preserved from migration 059. Detects stalling deals, overdue
  -- follow-ups, activity gaps, pipeline risk, pricing anomalies. Day 7
  -- dual-write publishes anomaly.detected events to flow_events.
  if exists (select 1 from cron.job where jobname = 'anomaly-scan-periodic') then
    perform cron.unschedule('anomaly-scan-periodic');
    raise notice 'Unscheduled existing anomaly-scan-periodic';
  end if;
  perform cron.schedule(
    'anomaly-scan-periodic',
    '0 */4 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/anomaly-scan',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )$cmd$,
      v_url_base, v_secret
    )
  );
  raise notice 'Scheduled anomaly-scan-periodic at 0 */4 * * *';

  -- ── 4. follow-up-engine: hourly ─────────────────────────────────────────
  -- Cadence preserved from migration 072. Processes due follow-up touchpoints,
  -- generates AI value-add content, creates notifications. Day 7 dual-write
  -- publishes follow_up.touchpoint_due events to flow_events.
  if exists (select 1 from cron.job where jobname = 'follow-up-engine-hourly') then
    perform cron.unschedule('follow-up-engine-hourly');
    raise notice 'Unscheduled existing follow-up-engine-hourly';
  end if;
  perform cron.schedule(
    'follow-up-engine-hourly',
    '0 * * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/follow-up-engine',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron","batch_size":50}'::jsonb,
        timeout_milliseconds := 120000
      )$cmd$,
      v_url_base, v_secret
    )
  );
  raise notice 'Scheduled follow-up-engine-hourly at 0 * * * *';

  -- ── 5. nudge-scheduler: weekdays at 14:00 CT (19:00 UTC) ────────────────
  -- Cadence preserved from migrations 088 / 093. Per the owner's Prospecting
  -- SOP: automated nudge if advisor is under 50% of daily target at 2pm.
  -- Day 7 dual-write publishes prospecting.nudge_dispatched events.
  if exists (select 1 from cron.job where jobname = 'prospecting-nudge-2pm') then
    perform cron.unschedule('prospecting-nudge-2pm');
    raise notice 'Unscheduled existing prospecting-nudge-2pm';
  end if;
  perform cron.schedule(
    'prospecting-nudge-2pm',
    '0 19 * * 1-5',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/nudge-scheduler',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 60000
      )$cmd$,
      v_url_base, v_secret
    )
  );
  raise notice 'Scheduled prospecting-nudge-2pm at 0 19 * * 1-5';

  -- ── 6. deal-timing-scan: every 6 hours ──────────────────────────────────
  -- Cadence resolved by owner during the P2 plan (migration 211 W3-3
  -- attempted to schedule this but fell through to the GUC-not-set path).
  -- Generates proactive timing alerts (budget cycles, fleet aging, etc.)
  -- and publishes deal_timing.alert_generated events to flow_events.
  if exists (select 1 from cron.job where jobname = 'deal-timing-scan-periodic') then
    perform cron.unschedule('deal-timing-scan-periodic');
    raise notice 'Unscheduled existing deal-timing-scan-periodic';
  end if;
  perform cron.schedule(
    'deal-timing-scan-periodic',
    '0 */6 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/deal-timing-scan',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )$cmd$,
      v_url_base, v_secret
    )
  );
  raise notice 'Scheduled deal-timing-scan-periodic at 0 */6 * * *';

  raise notice 'Wave 4b complete: 4 publisher crons restored using modern pattern.';
end;
$do$;
