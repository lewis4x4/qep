-- ============================================================================
-- Migration 723: B4.1 morning AI brief closeout
--
-- DH-1 is satisfied by the existing canonical Sales Today path:
-- public.morning_briefings is the app read/write source for the morning AI
-- brief, legacy daily_briefings is retained only for deprecated compatibility,
-- and the morning-briefing cron is documented as a 6:00 AM America/New_York
-- schedule with an Edge Function hour gate.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%723_b41_morning_ai_brief_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md DH-1') ||
      ' | supabase/migrations/606_morning_briefing_cron_et_semantics.sql' ||
      ' | supabase/functions/_shared/briefing-time.ts' ||
      ' | supabase/functions/morning-briefing/index.ts' ||
      ' | apps/web/src/features/sales/lib/sales-api.ts' ||
      ' | apps/web/src/features/sales/lib/sales-api-normalizers.ts' ||
      ' | apps/web/src/features/sales/hooks/useTodayFeed.ts' ||
      ' | supabase/migrations/723_b41_morning_ai_brief_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B4.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B4.1 shipped: migration 606 documents public.morning_briefings as the canonical Sales Today briefing path and schedules morning-briefing-daily at 10:00/11:00 UTC with {"enforce_et_hour": 6} so the edge function accepts only the 6:00 AM America/New_York tick across DST. The morning-briefing function uses getDateInTimeZone for the sales day, reserves/upserts morning_briefings, writes sales_today into data, and gates service-role batches through shouldRunEtScheduledBatch. Sales Today fetches morning_briefings first, invokes morning-briefing once when missing, and treats normalizeDailyBriefing as deprecated compatibility only; active app code no longer reads daily_briefings directly.'
  END,
  updated_at = now()
WHERE task_id = 'B4.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B4.1',
  'update',
  jsonb_build_object(
    'reason', 'b41_morning_ai_brief_closeout',
    'migration', '723_b41_morning_ai_brief_closeout.sql',
    'mission_alignment', 'pass: the sales day now has one canonical AI morning brief path that grounds reps in pipeline, follow-up, approval, and voice-note context at the start of the New York workday',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/606_morning_briefing_cron_et_semantics.sql declares public.morning_briefings the canonical Sales Today briefing path',
      'supabase/migrations/606_morning_briefing_cron_et_semantics.sql schedules morning-briefing-daily at 0 10,11 * * * with body {"batch": true, "enforce_et_hour": 6}',
      'supabase/functions/_shared/briefing-time.ts computes America/New_York dates/hours and skips non-6 AM enforced ticks unless regenerate is true',
      'supabase/functions/morning-briefing/index.ts gates service-role batches through shouldRunEtScheduledBatch and writes today using getDateInTimeZone',
      'supabase/functions/morning-briefing/index.ts reserves/upserts public.morning_briefings with sales_today metadata for the Sales Today UI',
      'apps/web/src/features/sales/lib/sales-api.ts reads public.morning_briefings before invoking morning-briefing and re-reads if the function returns no briefing payload',
      'apps/web/src/features/sales/lib/sales-api-normalizers.ts marks normalizeDailyBriefing deprecated and normalizes Sales Today from morning_briefings data.sales_today',
      'apps/web/src/features/sales/hooks/useTodayFeed.ts consumes fetchTodayBriefing and keeps the AI briefing outside first-paint loading'
    ),
    'safety_bounds', jsonb_build_array(
      'existing daily_briefings table and generate-daily-briefing function remain for backward compatibility and blocked B4.2 dependency work',
      'active app code does not query daily_briefings directly',
      'cron migration skips safely when pg_cron or pg_net is unavailable',
      'this closeout does not alter provider credentials, cron secrets, OpenAI/Anthropic models, or briefing generation behavior'
    ),
    'manual_boundaries', jsonb_build_array(
      'cron/job execution was not verified against the live Supabase scheduler',
      'no live provider-generated briefing was requested for this closeout',
      'generate-daily-briefing remains legacy compatibility until OMI-dependent evening briefing work is unblocked',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
