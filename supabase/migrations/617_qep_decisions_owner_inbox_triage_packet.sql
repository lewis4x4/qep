-- ============================================================================
-- Migration 617: include ai_prep_packet in owner inbox triage view
-- Purpose: preserve Brian triage approval metadata when loading triage queue
-- Note: ai_prep_packet is appended at the end of the existing view column list.
-- PostgreSQL CREATE OR REPLACE VIEW permits appending columns but not inserting
-- them before existing columns such as age_days.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_qep_decisions_owner_inbox AS
SELECT
  d.id,
  d.code,
  d.question_plain,
  d.lane,
  d.owner_role,
  d.recommended_option,
  d.recommended_rationale,
  d.options,
  d.citations,
  d.reversal_cost,
  d.status,
  d.created_at,
  d.updated_at,
  EXTRACT(EPOCH FROM (now() - d.created_at)) / 86400 AS age_days,
  (SELECT COUNT(*) FROM public.qep_roadmap_tasks t
     WHERE t.blocking_decision = d.code AND t.ship_state = 'pending_decision') AS gated_task_count,
  (SELECT array_agg(DISTINCT t.stream::text ORDER BY t.stream::text) FROM public.qep_roadmap_tasks t
     WHERE t.blocking_decision = d.code AND t.ship_state = 'pending_decision') AS gated_streams,
  d.ai_prep_packet
FROM public.qep_decisions d
WHERE d.status IN ('open', 'escalated', 'shadow_ship')
ORDER BY d.lane DESC, d.created_at ASC;

COMMENT ON VIEW public.v_qep_decisions_owner_inbox IS
  'One row per open/escalated/shadow_ship decision with impact rollup + ai_prep_packet for triage approvals.';

COMMIT;
