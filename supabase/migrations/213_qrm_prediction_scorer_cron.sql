-- ============================================================================
-- Migration 213: qrm-prediction-scorer Cron Schedule (Wave 5a)
--
-- The Phase 0 P0.3 nightly grader was deployed on Day 4 (commit 89a1c23) but
-- no migration ever scheduled it. Without a cron schedule, predictions never
-- get graded → qrm_predictions.outcome stays null forever → the eventual
-- Phase 4 grader has no data to learn from. Same class of bug the publishers
-- had before Wave 4 (migration 212).
--
-- This migration uses the modern pattern from migration 205 / 212:
-- hardcoded URL + x-internal-service-secret extracted from flow-runner.
--
-- Cadence: 0 2 * * * (daily at 02:00 UTC). Standard low-traffic batch window;
-- runs after follow-up-engine-hourly's 01:00 tick and well before
-- morning-briefing-daily's 11:00 tick. Owner-resolved during the Wave 5
-- planning round.
--
-- Prerequisite: Wave 5a redeploy of qrm-prediction-scorer (config.toml
-- verify_jwt = false from Wave 4c) MUST be live before this migration
-- applies. Verified pre-apply by manually firing the function with
-- x-internal-service-secret and confirming a 200 response.
--
-- ── Dollar-quoting note ─────────────────────────────────────────────────────
--
-- Postgres does not allow nested dollar-quotes with the same tag, so this
-- migration uses distinct tags: $do$ for the outer DO block, $tag1$/$tag2$
-- for the secret-extraction split_part literals, and $cmd$ for the
-- format() command template. Same tagging strategy as migrations 205 + 212.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
begin
  -- ── 1. Verify pg_cron and pg_net are present ────────────────────────────
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron is not installed; cannot schedule qrm-prediction-scorer';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net is not installed; cannot schedule qrm-prediction-scorer';
  end if;

  -- ── 2. Extract the shared internal-service-secret from flow-runner ──────
  -- flow-runner is the canonical source of truth for this project. Migrations
  -- 205 and 212 both use the same trick. Avoids hardcoding the secret in
  -- version control.
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

  raise notice 'Resolved internal-service-secret from flow-runner (% chars)', length(v_secret);

  -- ── 3. qrm-prediction-scorer-nightly: daily at 02:00 UTC ────────────────
  -- Closes out predictions in qrm_predictions against deal outcomes:
  --   - 'won' if the deal's stage is_closed_won
  --   - 'lost' if the deal's stage is_closed_lost
  --   - 'expired' if older than the 30-day expiry window and still open
  -- Persists outcomes to qrm_prediction_outcomes and updates the
  -- qrm_predictions.outcome canonical pointer. See Day 4 commit 89a1c23.
  if exists (select 1 from cron.job where jobname = 'qrm-prediction-scorer-nightly') then
    perform cron.unschedule('qrm-prediction-scorer-nightly');
    raise notice 'Unscheduled existing qrm-prediction-scorer-nightly';
  end if;

  perform cron.schedule(
    'qrm-prediction-scorer-nightly',
    '0 2 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/qrm-prediction-scorer',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      )$cmd$,
      v_url_base, v_secret
    )
  );
  raise notice 'Scheduled qrm-prediction-scorer-nightly at 0 2 * * * (daily 02:00 UTC)';

  raise notice 'Wave 5a complete: qrm-prediction-scorer cron restored.';
end;
$do$;
