-- ============================================================================
-- Migration 676: H1.1 service rate and margin engine closeout
--
-- H1.1 is implemented by migration 632 plus the service quote engine margin
-- guardrail. This migration records roadmap status and evidence only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/683_h11_service_rate_margin_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H1') ||
      ' | supabase/migrations/632_service_rate_margin_engine.sql' ||
      ' | supabase/functions/service-quote-engine/index.ts' ||
      ' | supabase/migrations/683_h11_service_rate_margin_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H1.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H1.1 shipped: migration 632 adds equipment-class door-rate cards for large construction, forestry, grapple, compact construction, field service, lube, and specialty labor; persists service quote margin guardrail outputs; and the service quote engine rejects labor below the 35% hard floor while reporting the 55% target/floor status.'
  END,
  updated_at = now()
WHERE task_id = 'H1.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H1.1',
  'update',
  jsonb_build_object(
    'reason', 'h11_service_rate_margin_closeout',
    'migration', '683_h11_service_rate_margin_closeout.sql',
    'mission_alignment', 'pass: service advisors get owner-binding equipment-class labor rates and margin floor enforcement for equipment repair quotes, protecting service gross margin before work is authorized',
    'implementation_evidence', jsonb_build_array(
      '632_service_rate_margin_engine.sql',
      'supabase/functions/service-quote-engine/index.ts',
      'supabase/functions/_shared/service-labor-pricing.ts'
    )
  ),
  'codex'
);

COMMIT;
