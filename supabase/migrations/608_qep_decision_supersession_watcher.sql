-- ============================================================================
-- Migration 608: qep_decision_supersession_watcher
-- Purpose: maintain historical decision/task scope and deterministically mark
--          decisions superseded when every historically gated task is descoped,
--          completed, or rescoped away from the decision.
-- Author: BlackRock AI
-- Date: 2026-05-20
-- ============================================================================

BEGIN;

-- Fast path for current blocker + state lookups during scope-change checks.
CREATE INDEX IF NOT EXISTS qep_roadmap_tasks_blocking_decision_state_idx
  ON public.qep_roadmap_tasks (blocking_decision, ship_state)
  WHERE blocking_decision IS NOT NULL;

-- Preserve every currently declared blocker as historical decision scope.
INSERT INTO public.qep_decision_blocks (decision_id, task_id)
SELECT d.id, t.task_id
FROM public.qep_roadmap_tasks t
JOIN public.qep_decisions d
  ON d.code = t.blocking_decision
WHERE t.blocking_decision IS NOT NULL
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Helper: maybe supersede one decision after a task scope/state change.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_qep_maybe_supersede_decision(
  p_decision_code text,
  p_trigger_task_id text DEFAULT NULL,
  p_actor text DEFAULT 'scope-change-watcher'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision public.qep_decisions%ROWTYPE;
  v_previous_status text;
  v_scoped_task_count integer := 0;
  v_active_task_count integer := 0;
  v_descoped_task_ids text[] := ARRAY[]::text[];
  v_completed_task_ids text[] := ARRAY[]::text[];
  v_rescoped_task_ids text[] := ARRAY[]::text[];
  v_unclassified_task_ids text[] := ARRAY[]::text[];
  v_stale_blockers_cleared text[] := ARRAY[]::text[];
  v_prior_supersession_guard text;
BEGIN
  IF p_decision_code IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_decision
  FROM public.qep_decisions
  WHERE code = p_decision_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_previous_status := v_decision.status::text;

  IF v_previous_status NOT IN ('open', 'escalated', 'shadow_ship') THEN
    RETURN false;
  END IF;

  -- Maintain qep_decision_blocks as historical scope. Never delete old links.
  INSERT INTO public.qep_decision_blocks (decision_id, task_id)
  SELECT v_decision.id, t.task_id
  FROM public.qep_roadmap_tasks t
  WHERE t.blocking_decision = p_decision_code
  ON CONFLICT DO NOTHING;

  WITH scoped AS (
    SELECT
      t.task_id,
      t.ship_state::text AS ship_state,
      t.blocking_decision,
      (
        t.blocking_decision = p_decision_code
        AND t.ship_state::text IN ('pending_decision', 'blocked', 'not_started', 'in_progress')
      ) AS is_active,
      (t.ship_state::text IN ('deferred', 'na')) AS is_descoped,
      (t.ship_state::text = 'shipped') AS is_completed,
      (t.blocking_decision IS DISTINCT FROM p_decision_code) AS is_rescoped,
      NOT (
        (
          t.blocking_decision = p_decision_code
          AND t.ship_state::text IN ('pending_decision', 'blocked', 'not_started', 'in_progress')
        )
        OR t.ship_state::text IN ('deferred', 'na')
        OR t.ship_state::text = 'shipped'
        OR t.blocking_decision IS DISTINCT FROM p_decision_code
      ) AS is_unclassified
    FROM public.qep_decision_blocks b
    JOIN public.qep_roadmap_tasks t
      ON t.task_id = b.task_id
    WHERE b.decision_id = v_decision.id
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE is_active)::integer,
    COALESCE(array_agg(task_id ORDER BY task_id) FILTER (WHERE is_descoped), ARRAY[]::text[]),
    COALESCE(array_agg(task_id ORDER BY task_id) FILTER (WHERE is_completed), ARRAY[]::text[]),
    COALESCE(array_agg(task_id ORDER BY task_id) FILTER (WHERE is_rescoped), ARRAY[]::text[]),
    COALESCE(array_agg(task_id ORDER BY task_id) FILTER (WHERE is_unclassified), ARRAY[]::text[])
  INTO
    v_scoped_task_count,
    v_active_task_count,
    v_descoped_task_ids,
    v_completed_task_ids,
    v_rescoped_task_ids,
    v_unclassified_task_ids
  FROM scoped;

  IF v_scoped_task_count = 0 THEN
    RETURN false;
  END IF;

  IF v_active_task_count > 0 THEN
    RETURN false;
  END IF;

  IF COALESCE(array_length(v_unclassified_task_ids, 1), 0) > 0 THEN
    RETURN false;
  END IF;

  -- Suppress recursive supersession checks caused by stale-blocker cleanup.
  v_prior_supersession_guard := current_setting('app.qep_supersession_writer', true);
  PERFORM set_config('app.qep_supersession_writer', 'true', true);

  BEGIN
  WITH stale AS (
    UPDATE public.qep_roadmap_tasks
    SET blocking_decision = NULL,
        notes = CASE
          WHEN notes IS NULL THEN
            format('[%s] Cleared stale decision blocker %s after supersession.',
                   to_char(now(), 'YYYY-MM-DD'), p_decision_code)
          ELSE
            notes || E'\n' ||
            format('[%s] Cleared stale decision blocker %s after supersession.',
                   to_char(now(), 'YYYY-MM-DD'), p_decision_code)
        END,
        updated_at = now()
    WHERE blocking_decision = p_decision_code
      AND ship_state::text IN ('deferred', 'na', 'shipped')
    RETURNING task_id, ship_state::text AS ship_state
  ), stale_audit AS (
    INSERT INTO public.qep_roadmap_sync_events
      (direction, task_id, action, changed_fields, actor)
    SELECT
      'reconcile',
      task_id,
      'update',
      jsonb_build_object(
        'reason', 'stale_terminal_blocker_cleared',
        'decision_code', p_decision_code,
        'trigger_task_id', p_trigger_task_id,
        'ship_state', ship_state,
        'blocking_decision', jsonb_build_object('from', p_decision_code, 'to', null)
      ),
      p_actor
    FROM stale
    RETURNING task_id
  )
  SELECT COALESCE(array_agg(task_id ORDER BY task_id), ARRAY[]::text[])
  INTO v_stale_blockers_cleared
  FROM stale_audit;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'app.qep_supersession_writer',
      COALESCE(NULLIF(v_prior_supersession_guard, ''), 'false'),
      true
    );
    RAISE;
  END;

  PERFORM set_config(
    'app.qep_supersession_writer',
    COALESCE(NULLIF(v_prior_supersession_guard, ''), 'false'),
    true
  );

  UPDATE public.qep_decisions
  SET status = 'superseded'::public.qep_decision_status,
      answered_by = p_actor,
      answered_at = now(),
      answered_option = 'superseded',
      answered_rationale = format(
        'Superseded automatically: %s historically gated task(s), 0 active blockers; descoped=%s, completed=%s, rescoped=%s.',
        v_scoped_task_count,
        COALESCE(array_length(v_descoped_task_ids, 1), 0),
        COALESCE(array_length(v_completed_task_ids, 1), 0),
        COALESCE(array_length(v_rescoped_task_ids, 1), 0)
      )
  WHERE id = v_decision.id;

  INSERT INTO public.qep_roadmap_sync_events
    (direction, task_id, action, changed_fields, actor)
  VALUES (
    'reconcile',
    p_trigger_task_id,
    'update',
    jsonb_build_object(
      'reason', 'decision_superseded',
      'decision_code', p_decision_code,
      'previous_status', v_previous_status,
      'new_status', 'superseded',
      'trigger_task_id', p_trigger_task_id,
      'scoped_task_count', v_scoped_task_count,
      'active_task_count', v_active_task_count,
      'descoped_task_ids', to_jsonb(v_descoped_task_ids),
      'completed_task_ids', to_jsonb(v_completed_task_ids),
      'rescoped_task_ids', to_jsonb(v_rescoped_task_ids),
      'unclassified_task_ids', to_jsonb(v_unclassified_task_ids),
      'stale_blockers_cleared', to_jsonb(v_stale_blockers_cleared)
    ),
    p_actor
  );

  RETURN true;
END;
$$;

-- ----------------------------------------------------------------------------
-- Trigger: maintain historical scope and check old/new decision codes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_qep_roadmap_tasks_track_decision_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision_id uuid;
BEGIN
  IF current_setting('app.qep_supersession_writer', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.blocking_decision IS NOT NULL THEN
    SELECT id
    INTO v_decision_id
    FROM public.qep_decisions
    WHERE code = NEW.blocking_decision;

    IF v_decision_id IS NOT NULL THEN
      INSERT INTO public.qep_decision_blocks (decision_id, task_id)
      VALUES (v_decision_id, NEW.task_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.blocking_decision IS NOT NULL
     AND OLD.blocking_decision IS DISTINCT FROM NEW.blocking_decision THEN
    PERFORM public.fn_qep_maybe_supersede_decision(
      OLD.blocking_decision,
      NEW.task_id,
      'scope-change-watcher'
    );
  END IF;

  IF NEW.blocking_decision IS NOT NULL THEN
    PERFORM public.fn_qep_maybe_supersede_decision(
      NEW.blocking_decision,
      NEW.task_id,
      'scope-change-watcher'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qep_roadmap_tasks_track_decision_scope ON public.qep_roadmap_tasks;
CREATE TRIGGER qep_roadmap_tasks_track_decision_scope
  AFTER INSERT OR UPDATE OF ship_state, blocking_decision
  ON public.qep_roadmap_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_roadmap_tasks_track_decision_scope();

-- ----------------------------------------------------------------------------
-- Service-role sweep RPC for operator/CI backstops. Do not grant to users.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_qep_decision_supersessions(
  p_actor text DEFAULT 'supersession-sweep'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision record;
  v_checked integer := 0;
  v_superseded integer := 0;
  v_superseded_codes text[] := ARRAY[]::text[];
BEGIN
  FOR v_decision IN
    SELECT code
    FROM public.qep_decisions
    WHERE status::text IN ('open', 'escalated', 'shadow_ship')
    ORDER BY code
  LOOP
    v_checked := v_checked + 1;

    IF public.fn_qep_maybe_supersede_decision(v_decision.code, NULL, p_actor) THEN
      v_superseded := v_superseded + 1;
      v_superseded_codes := array_append(v_superseded_codes, v_decision.code);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'checked', v_checked,
    'superseded', v_superseded,
    'superseded_codes', to_jsonb(v_superseded_codes),
    'actor', p_actor
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_qep_maybe_supersede_decision(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_qep_maybe_supersede_decision(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_qep_maybe_supersede_decision(text, text, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_qep_roadmap_tasks_track_decision_scope() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_qep_roadmap_tasks_track_decision_scope() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_qep_roadmap_tasks_track_decision_scope() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.recompute_qep_decision_supersessions(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_qep_decision_supersessions(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_qep_decision_supersessions(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_qep_decision_supersessions(text) TO service_role;

COMMENT ON FUNCTION public.fn_qep_maybe_supersede_decision(text, text, text) IS
  'F4.4: mark an eligible decision superseded once all historically scoped tasks are descoped, completed, or rescoped away; inserts reconcile audit events.';
COMMENT ON FUNCTION public.fn_qep_roadmap_tasks_track_decision_scope() IS
  'F4.4: maintains historical qep_decision_blocks links and invokes the supersession watcher for old/new blockers.';
COMMENT ON FUNCTION public.recompute_qep_decision_supersessions(text) IS
  'F4.4 service-role-only sweep RPC that recomputes supersession eligibility for open/escalated/shadow_ship decisions.';

COMMIT;

-- ============================================================================
-- Down migration (commented; copy/paste to revert)
-- ============================================================================
-- BEGIN;
--   DROP TRIGGER IF EXISTS qep_roadmap_tasks_track_decision_scope ON public.qep_roadmap_tasks;
--   DROP FUNCTION IF EXISTS public.fn_qep_roadmap_tasks_track_decision_scope;
--   DROP FUNCTION IF EXISTS public.recompute_qep_decision_supersessions(text);
--   DROP FUNCTION IF EXISTS public.fn_qep_maybe_supersede_decision(text, text, text);
--   DROP INDEX IF EXISTS public.qep_roadmap_tasks_blocking_decision_state_idx;
--   -- Historical qep_decision_blocks rows are intentionally retained.
-- COMMIT;
