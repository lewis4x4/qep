-- ============================================================================
-- Migration 620: decision dependency graph auto-recompute (QEP-160 / F4.2)
-- Purpose: when a parent decision resolves, refresh ai_prep_packet dependency
--          context for dependent active decisions listed in
--          qep_decisions.unblocks_recompute_codes.
-- ============================================================================

BEGIN;

ALTER TABLE public.qep_decisions
  ADD COLUMN IF NOT EXISTS unblocks_recompute_codes text[];

COMMENT ON COLUMN public.qep_decisions.unblocks_recompute_codes IS
  'Decision codes that should have ai_prep_packet dependency context recomputed when this parent decision resolves.';

CREATE INDEX IF NOT EXISTS qep_decisions_unblocks_recompute_codes_gin_idx
  ON public.qep_decisions
  USING gin (unblocks_recompute_codes)
  WHERE unblocks_recompute_codes IS NOT NULL
    AND cardinality(unblocks_recompute_codes) > 0;

CREATE OR REPLACE FUNCTION public.fn_qep_decision_resolved_promote_tasks()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  v_task RECORD;
  v_promoted_count integer := 0;
  v_dependency_payload jsonb;
BEGIN
  -- Only fire when transitioning INTO a resolved state (answered / shadow_ship / superseded)
  IF NOT (NEW.status::text IN ('answered','shadow_ship','superseded'))
     OR (OLD.status::text IN ('answered','shadow_ship','superseded')) THEN
    RETURN NEW;
  END IF;

  -- Promote every pending_decision task gated on this code.
  FOR v_task IN
    SELECT id, task_id, ship_state, blocking_decision
    FROM public.qep_roadmap_tasks
    WHERE blocking_decision = NEW.code
      AND ship_state = 'pending_decision'
  LOOP
    UPDATE public.qep_roadmap_tasks
    SET ship_state         = 'not_started'::public.qep_roadmap_ship_state,
        blocking_decision  = NULL,
        notes = CASE
          WHEN notes IS NULL THEN
            format('[%s] Auto-promoted via decision %s (%s)',
                   to_char(now(), 'YYYY-MM-DD'), NEW.code, NEW.status)
          ELSE
            notes || E'\n' ||
            format('[%s] Auto-promoted via decision %s (%s)',
                   to_char(now(), 'YYYY-MM-DD'), NEW.code, NEW.status)
        END,
        updated_at = NOW()
    WHERE id = v_task.id;

    v_promoted_count := v_promoted_count + 1;

    -- Log audit row.
    INSERT INTO public.qep_roadmap_sync_events
      (direction, task_id, action, changed_fields, actor)
    VALUES (
      'reconcile', v_task.task_id, 'update',
      jsonb_build_object(
        'reason', 'decision_resolved',
        'decision_code', NEW.code,
        'decision_status', NEW.status::text,
        'ship_state', jsonb_build_object('from', 'pending_decision', 'to', 'not_started'),
        'blocking_decision', jsonb_build_object('from', NEW.code, 'to', null)
      ),
      COALESCE(NEW.answered_by, 'decision-resolver')
    );
  END LOOP;

  -- Refresh dependency context on downstream active decisions this parent unblocks.
  IF COALESCE(array_length(NEW.unblocks_recompute_codes, 1), 0) > 0 THEN
    v_dependency_payload := jsonb_build_object(
      'parent_code', NEW.code,
      'parent_status', NEW.status::text,
      'answered_option', NEW.answered_option,
      'answered_rationale', NEW.answered_rationale,
      'answered_at', NEW.answered_at,
      'recomputed_at', now()
    );

    UPDATE public.qep_decisions child
    SET ai_prep_packet = COALESCE(child.ai_prep_packet, '{}'::jsonb) || jsonb_build_object(
      'dependency_context',
      COALESCE(child.ai_prep_packet->'dependency_context', '{}'::jsonb) || jsonb_build_object(
        'parents',
        COALESCE(child.ai_prep_packet #> '{dependency_context,parents}', '{}'::jsonb) || jsonb_build_object(NEW.code, v_dependency_payload),
        'last_parent_resolution',
        v_dependency_payload
      ),
      'dependency_recompute',
      COALESCE(child.ai_prep_packet->'dependency_recompute', '[]'::jsonb) || jsonb_build_array(v_dependency_payload)
    )
    WHERE child.code = ANY(NEW.unblocks_recompute_codes)
      AND child.code <> NEW.code
      AND child.status::text IN ('open', 'escalated', 'shadow_ship');
  END IF;

  -- Bonus: write a precedent row for future similarity matching.
  IF NEW.status = 'answered' AND NEW.answered_option IS NOT NULL THEN
    INSERT INTO public.qep_decision_precedents
      (source_decision_id, pattern_summary, applied_answer, applied_rationale, owner_role)
    VALUES
      (NEW.id, NEW.question_plain, NEW.answered_option, NEW.answered_rationale, NEW.owner_role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION public.fn_qep_decision_resolved_promote_tasks() IS
  'Resolves decision task blockers and refreshes ai_prep_packet dependency context for active dependent decisions in unblocks_recompute_codes.';

COMMIT;
