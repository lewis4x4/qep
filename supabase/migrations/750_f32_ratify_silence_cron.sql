-- ============================================================================
-- Migration 750: F3.2 RATIFY-lane silence cron + roadmap closeout
--
-- The ratify-silence-runner edge function already owns eligibility, owner
-- notification attempts, and lane-aware shadow_ship promotion. This migration
-- adds the missing source-controlled schedule and records the roadmap row as
-- shipped without asserting production cron execution.
-- ============================================================================

DO $cron$
DECLARE
  v_source_command text;
  v_url_base text;
  v_secret text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'Skipping qep-ratify-silence-runner-hourly: pg_cron not installed.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    RAISE NOTICE 'Skipping qep-ratify-silence-runner-hourly: pg_net not installed.';
    RETURN;
  END IF;

  SELECT command
    INTO v_source_command
    FROM cron.job
    WHERE jobname = 'flow-runner'
    LIMIT 1;

  IF v_source_command IS NULL THEN
    SELECT command
      INTO v_source_command
      FROM cron.job
      WHERE command LIKE '%x-internal-service-secret%'
        AND command LIKE '%/functions/v1/%'
      ORDER BY jobid ASC
      LIMIT 1;
  END IF;

  IF v_source_command IS NULL THEN
    RAISE NOTICE 'Skipping qep-ratify-silence-runner-hourly: no existing cron command found to harvest URL + secret from.';
    RETURN;
  END IF;

  SELECT substring(v_source_command FROM '(https://[^''[:space:]]+)/functions/v1/')
    INTO v_url_base;

  IF v_url_base IS NULL OR v_url_base = '' THEN
    RAISE NOTICE 'Skipping qep-ratify-silence-runner-hourly: could not resolve URL base from existing cron command.';
    RETURN;
  END IF;

  v_secret := split_part(
    split_part(v_source_command, $tag1$x-internal-service-secret', '$tag1$, 2),
    $tag2$'$tag2$,
    1
  );

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE NOTICE 'Skipping qep-ratify-silence-runner-hourly: could not resolve internal-service-secret from existing cron command.';
    RETURN;
  END IF;

  v_command := format(
    $cmd$SELECT net.http_post(
      url := '%s/functions/v1/ratify-silence-runner',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{"dry_run": false, "limit": 100, "actor": "ratify-silence-cron"}'::jsonb,
      timeout_milliseconds := 120000
    )$cmd$,
    v_url_base,
    v_secret
  );

  PERFORM cron.unschedule('qep-ratify-silence-runner-hourly')
    WHERE EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'qep-ratify-silence-runner-hourly'
    );

  PERFORM cron.schedule(
    'qep-ratify-silence-runner-hourly',
    '17 * * * *',
    v_command
  );

  RAISE NOTICE 'Scheduled qep-ratify-silence-runner-hourly at minute 17 hourly.';
END;
$cron$;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%750_f32_ratify_silence_cron.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F3.2') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F3.2' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F3.2 RATIFY silence requirement' ||
      ' | QEP (1)/QEP_DECISION_INBOX_GO_LIVE.md F3.1/F3.2 cron handoff' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-151 Done' ||
      ' | supabase/functions/ratify-silence-runner/index.ts' ||
      ' | supabase/functions/ratify-silence-runner/logic.ts' ||
      ' | supabase/functions/ratify-silence-runner/logic.test.ts' ||
      ' | supabase/config.toml functions.ratify-silence-runner' ||
      ' | supabase/migrations/651_qep_decision_resolution_authority.sql resolver guard' ||
      ' | supabase/migrations/750_f32_ratify_silence_cron.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F3.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F3.2 shipped: ratify-silence-runner is registered as a source-controlled hourly cron at minute 17 when pg_cron, pg_net, and an existing x-internal-service-secret cron command are available. The edge function is service-role gated, loads open/escalated RATIFY decisions, applies each decision silence_threshold_days or the 7-day default, requires a recommended_option, attempts Linear and email owner notifications, stamps ai_prep_packet.ratify_silence_last_run, and promotes eligible decisions to shadow_ship through resolve_qep_decision with actor ratify-silence-cron. The function supports dry_run for safe operator rehearsal and returns scanned/eligible/promoted counts.'
  END,
  updated_at = now()
WHERE task_id = 'F3.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F3.2',
  'update',
  jsonb_build_object(
    'reason', 'f32_ratify_silence_cron',
    'migration', '750_f32_ratify_silence_cron.sql',
    'mission_alignment', 'pass: RATIFY silence promotion lets reversible QEP equipment, parts, rental, sales, service, and management decisions keep moving after the owner review window while preserving owner notification attempts, shadow_ship audit context, and lane-aware rollback visibility',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F3.2 as RATIFY-lane silence-based shipping with dependency F3.1',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md defines the 7-day RATIFY silence threshold and shadow_ship outcome',
      'QEP (1)/QEP_DECISION_INBOX_GO_LIVE.md states F3.1 + F3.2 make silence-based promotion run automatically on a cron',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-151 / F3.2 RATIFY-lane silence-based shipping as Done on 2026-05-21',
      'supabase/config.toml registers ratify-silence-runner with verify_jwt=false so in-function cron-auth can gate calls',
      'supabase/functions/ratify-silence-runner/index.ts requires POST and isServiceRoleCaller before scanning decisions',
      'supabase/functions/ratify-silence-runner/index.ts loads open/escalated RATIFY decisions, filters eligibility through isRatifySilenceEligible, and honors dry_run',
      'supabase/functions/ratify-silence-runner/index.ts attempts decision-linear-comment and decision-email-card notifications before promotion',
      'supabase/functions/ratify-silence-runner/index.ts stamps ratify_silence_last_run context and promotes through resolve_qep_decision to shadow_ship',
      'supabase/functions/ratify-silence-runner/logic.ts defaults silence_threshold_days to 7, clamps custom thresholds to at least one day, requires recommended_option, and rejects invalid dates/statuses/lanes',
      'supabase/functions/ratify-silence-runner/logic.test.ts covers eligibility, lane/status/recommendation guards, threshold defaulting/clamping, packet stamping, and rationale text',
      'supabase/migrations/651_qep_decision_resolution_authority.sql restricts shadow_ship resolution to RATIFY lane through resolve_qep_decision',
      'supabase/migrations/750_f32_ratify_silence_cron.sql schedules qep-ratify-silence-runner-hourly at 17 * * * * using the modern x-internal-service-secret cron pattern'
    ),
    'safety_bounds', jsonb_build_array(
      'this slice only adds cron registration and roadmap reconciliation; no provider credentials or new dependencies are added',
      'the cron registration skips safely when pg_cron, pg_net, URL base, or x-internal-service-secret source is unavailable',
      'the runner is service-role-only and rejects non-POST calls',
      'dry_run remains available for operator rehearsal and returns would_promote rows without resolving decisions',
      'promotion uses resolve_qep_decision instead of direct qep_decisions updates',
      'this closeout marks only F3.2 shipped and does not mark F3.3, F4.1, F4.2, F4.3, F4.4, F5.1, or F5.2'
    ),
    'manual_boundaries', jsonb_build_array(
      'no production cron tick or live owner silence window was observed in this source-controlled closeout',
      'live Linear comments still require LINEAR_API_KEY and issue mapping configured in the deployed environment',
      'live email notification still requires owner email mapping, DECISION_MAGIC_LINK_BASE_URL, and usable M365 token state in the deployed environment',
      'production deployment and supabase db push/local apply were not run because the pre-existing migration 212 pg_cron requirement remains blocked outside this slice'
    )
  ),
  'codex'
);
