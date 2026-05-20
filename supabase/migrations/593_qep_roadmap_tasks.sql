-- ============================================================================
-- Migration 593: qep_roadmap_tasks — unified roadmap source-of-truth table
-- Purpose: QEP equivalent of SCC's roadmap_tasks. System of record for every
--          work item in QEP_UNIFIED_ROADMAP_2026-05-19.md. Linear mirrors this.
-- Author: BlackRock AI
-- Date: 2026-05-19
--
-- Structure mirrors the unified roadmap:
--   Streams A–E (durable concerns)
--   Waves A1, A2, B1...           (next mergeable cuts inside a stream)
--   Items                          (individual work rows under a wave)
--
-- This migration ships both v1 (schema + trigger + pending view) and v2
-- (reverse-sync RPC + audit log + health view) in one shot because QEP starts
-- without the table.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Stream enum (A–E from the unified roadmap)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qep_roadmap_stream') THEN
    CREATE TYPE public.qep_roadmap_stream AS ENUM ('A', 'B', 'C', 'D', 'E');
  END IF;
END$$;

COMMENT ON TYPE public.qep_roadmap_stream IS
  'A=Iron Quote · B=Sales-Advisor Field Platform · C=IntelliDealer Cutover · D=Parity Validation+Decision Resolution · E=Platform Foundation';

-- ----------------------------------------------------------------------------
-- 2. Ship-state enum (7 values, tuned to QEP reality — most surfaces shipped)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qep_roadmap_ship_state') THEN
    CREATE TYPE public.qep_roadmap_ship_state AS ENUM (
      'not_started',
      'in_progress',
      'blocked',
      'pending_decision',
      'shipped',
      'deferred',
      'na'
    );
  END IF;
END$$;

COMMENT ON TYPE public.qep_roadmap_ship_state IS
  'not_started · in_progress · blocked (external blocker) · pending_decision (waiting on product/JAR) · shipped · deferred (re-open trigger documented) · na';

-- ----------------------------------------------------------------------------
-- 3. Main table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qep_roadmap_tasks (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                     text NOT NULL UNIQUE,
  stream                      public.qep_roadmap_stream NOT NULL,
  wave                        text NOT NULL,        -- e.g. 'A1', 'A2', 'B3'
  title                       text NOT NULL,
  description                 text,
  ship_state                  public.qep_roadmap_ship_state NOT NULL DEFAULT 'not_started',
  owner                       text,                 -- e.g. 'Engineer', 'Brian', 'Rylee', 'Ryan', 'Architect'
  blocking_decision           text,                 -- e.g. 'Q6', 'JAR-103', 'BLK-3', or NULL
  depends_on                  text[] DEFAULT NULL,  -- array of task_ids this depends on
  evidence_link               text,                 -- commit hash, file path, ship report, etc.
  notes                       text,
  sort_order                  integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- Linear sync bookkeeping
  linear_issue_id             text,
  linear_issue_identifier     text,
  linear_url                  text,
  linear_synced_at            timestamptz,
  linear_sync_status          text NOT NULL DEFAULT 'pending'
    CHECK (linear_sync_status IN ('pending', 'synced', 'error', 'skipped')),
  linear_sync_error           text,
  linear_sync_attempt_count   integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.qep_roadmap_tasks IS
  'QEP unified roadmap — single source of truth. Streams A-E from QEP_UNIFIED_ROADMAP_2026-05-19.md. Linear is a mirror.';

COMMENT ON COLUMN public.qep_roadmap_tasks.task_id IS
  'Human-friendly ID like "A1.1", "B3.2", "EQ-1" (execution queue). Stable across the lifetime of the row. Used in PR templates: "Roadmap: A1.1".';
COMMENT ON COLUMN public.qep_roadmap_tasks.stream IS
  'Top-level stream A-E. Maps to a Linear Project.';
COMMENT ON COLUMN public.qep_roadmap_tasks.wave IS
  'Wave inside a stream, like "A1" or "B3". Maps to a Linear Milestone.';
COMMENT ON COLUMN public.qep_roadmap_tasks.blocking_decision IS
  'Code of the external decision/gate blocking this row, if any. Examples: Q6, JAR-103, BLK-3.';
COMMENT ON COLUMN public.qep_roadmap_tasks.evidence_link IS
  'Where to verify shipped state — commit hash, file path, ship report, audit row.';
COMMENT ON COLUMN public.qep_roadmap_tasks.linear_issue_id IS
  'Linear internal UUID of the mirrored issue. Set by linear-import-roadmap.mjs and never changes after.';
COMMENT ON COLUMN public.qep_roadmap_tasks.linear_sync_status IS
  'pending = needs push to Linear; synced = up to date; error = last attempt failed; skipped = sync disabled for this task.';

-- ----------------------------------------------------------------------------
-- 4. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS qep_roadmap_tasks_stream_wave_idx
  ON public.qep_roadmap_tasks (stream, wave, sort_order);

CREATE INDEX IF NOT EXISTS qep_roadmap_tasks_ship_state_idx
  ON public.qep_roadmap_tasks (ship_state);

CREATE INDEX IF NOT EXISTS qep_roadmap_tasks_owner_idx
  ON public.qep_roadmap_tasks (owner)
  WHERE owner IS NOT NULL;

CREATE INDEX IF NOT EXISTS qep_roadmap_tasks_blocking_decision_idx
  ON public.qep_roadmap_tasks (blocking_decision)
  WHERE blocking_decision IS NOT NULL;

CREATE INDEX IF NOT EXISTS qep_roadmap_tasks_linear_issue_id_idx
  ON public.qep_roadmap_tasks (linear_issue_id)
  WHERE linear_issue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS qep_roadmap_tasks_linear_sync_queue_idx
  ON public.qep_roadmap_tasks (updated_at)
  WHERE linear_sync_status IN ('pending', 'error');

-- ----------------------------------------------------------------------------
-- 5. updated_at trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_qep_roadmap_tasks_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qep_roadmap_tasks_touch_updated_at ON public.qep_roadmap_tasks;
CREATE TRIGGER qep_roadmap_tasks_touch_updated_at
  BEFORE UPDATE ON public.qep_roadmap_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_roadmap_tasks_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Trigger: flip linear_sync_status -> 'pending' on substantive change.
--    Anti-ping-pong: respects app.linear_webhook_writer session flag
--    set by sync_status_from_linear_qep RPC.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_qep_roadmap_tasks_mark_linear_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Reverse-sync writer set the flag for this transaction — don't bounce.
  IF current_setting('app.linear_webhook_writer', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Bookkeeping-only writes (Linear sync columns) must NOT flip pending.
  IF (NEW.title             IS DISTINCT FROM OLD.title)
     OR (NEW.description    IS DISTINCT FROM OLD.description)
     OR (NEW.ship_state     IS DISTINCT FROM OLD.ship_state)
     OR (NEW.stream         IS DISTINCT FROM OLD.stream)
     OR (NEW.wave           IS DISTINCT FROM OLD.wave)
     OR (NEW.owner          IS DISTINCT FROM OLD.owner)
     OR (NEW.blocking_decision IS DISTINCT FROM OLD.blocking_decision)
     OR (NEW.depends_on     IS DISTINCT FROM OLD.depends_on)
     OR (NEW.evidence_link  IS DISTINCT FROM OLD.evidence_link)
     OR (NEW.notes          IS DISTINCT FROM OLD.notes)
  THEN
    NEW.linear_sync_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qep_roadmap_tasks_mark_linear_pending ON public.qep_roadmap_tasks;
CREATE TRIGGER qep_roadmap_tasks_mark_linear_pending
  BEFORE UPDATE ON public.qep_roadmap_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_roadmap_tasks_mark_linear_pending();

-- ----------------------------------------------------------------------------
-- 7. Pending sync queue view (used by sync runner + Edge Function)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_qep_roadmap_tasks_pending_linear_sync AS
SELECT
  id,
  task_id,
  stream,
  wave,
  title,
  description,
  ship_state,
  owner,
  blocking_decision,
  depends_on,
  evidence_link,
  notes,
  linear_issue_id,
  linear_issue_identifier,
  linear_url,
  linear_sync_status,
  linear_sync_error,
  linear_sync_attempt_count,
  updated_at,
  linear_synced_at
FROM public.qep_roadmap_tasks
WHERE linear_sync_status IN ('pending', 'error')
  AND linear_sync_attempt_count < 5
ORDER BY linear_sync_attempt_count ASC, updated_at ASC;

COMMENT ON VIEW public.v_qep_roadmap_tasks_pending_linear_sync IS
  'Rows that need to be pushed to Linear. Used by the sync runner. Reset linear_sync_attempt_count to retry after 5 failures.';

-- ----------------------------------------------------------------------------
-- 8. Reverse-sync audit log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qep_roadmap_sync_events (
  id                bigint generated always as identity primary key,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  direction         text NOT NULL CHECK (direction IN ('supabase_to_linear', 'linear_to_supabase', 'reconcile', 'pr_merge_comment')),
  task_id           text,
  linear_issue_id   text,
  action            text NOT NULL CHECK (action IN ('create', 'update', 'comment', 'skip', 'error', 'adopt')),
  changed_fields    jsonb,
  error_message     text,
  webhook_id        text,
  actor             text
);

COMMENT ON TABLE public.qep_roadmap_sync_events IS
  'Append-only log of every sync action between qep_roadmap_tasks and Linear. Used for debugging, reconcile, metrics.';

CREATE INDEX IF NOT EXISTS qep_roadmap_sync_events_occurred_idx
  ON public.qep_roadmap_sync_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS qep_roadmap_sync_events_task_idx
  ON public.qep_roadmap_sync_events (task_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS qep_roadmap_sync_events_direction_action_idx
  ON public.qep_roadmap_sync_events (direction, action, occurred_at DESC);

ALTER TABLE public.qep_roadmap_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qep_roadmap_sync_events_service_role_all ON public.qep_roadmap_sync_events;
CREATE POLICY qep_roadmap_sync_events_service_role_all ON public.qep_roadmap_sync_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS qep_roadmap_sync_events_authenticated_read ON public.qep_roadmap_sync_events;
CREATE POLICY qep_roadmap_sync_events_authenticated_read ON public.qep_roadmap_sync_events
  FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- 9. RPC: sync_status_from_linear_qep
--    Called by Linear webhook receiver Edge Function. Sets the session flag
--    so the trigger doesn't re-mark pending. Writes audit event.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_status_from_linear_qep(
  p_task_id text,
  p_new_status text,
  p_actor text DEFAULT 'linear-webhook',
  p_webhook_id text DEFAULT NULL,
  p_linear_issue_id text DEFAULT NULL
)
RETURNS public.qep_roadmap_tasks
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.qep_roadmap_tasks;
  v_old_status public.qep_roadmap_ship_state;
  v_new_status public.qep_roadmap_ship_state;
BEGIN
  -- Suppress trigger's mark-pending behavior for this transaction.
  PERFORM set_config('app.linear_webhook_writer', 'true', true);

  -- Cast incoming text status to enum, will raise if unknown
  v_new_status := p_new_status::public.qep_roadmap_ship_state;

  SELECT ship_state INTO v_old_status FROM public.qep_roadmap_tasks WHERE task_id = p_task_id;
  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'No qep_roadmap_tasks row with task_id=%', p_task_id;
  END IF;

  -- Idempotency short-circuit: if Linear is telling us what's already true, no-op.
  IF v_old_status = v_new_status THEN
    SELECT * INTO v_row FROM public.qep_roadmap_tasks WHERE task_id = p_task_id;
    INSERT INTO public.qep_roadmap_sync_events(direction, task_id, linear_issue_id, action, changed_fields, webhook_id, actor)
    VALUES (
      'linear_to_supabase', p_task_id, p_linear_issue_id, 'skip',
      jsonb_build_object('reason', 'ship_state_unchanged', 'ship_state', p_new_status),
      p_webhook_id, p_actor
    );
    RETURN v_row;
  END IF;

  UPDATE public.qep_roadmap_tasks
  SET ship_state = v_new_status,
      linear_sync_status = 'synced',
      linear_synced_at = NOW(),
      linear_sync_error = NULL,
      linear_sync_attempt_count = 0,
      updated_at = NOW()
  WHERE task_id = p_task_id
  RETURNING * INTO v_row;

  INSERT INTO public.qep_roadmap_sync_events(direction, task_id, linear_issue_id, action, changed_fields, webhook_id, actor)
  VALUES (
    'linear_to_supabase', p_task_id, p_linear_issue_id, 'update',
    jsonb_build_object('ship_state', jsonb_build_object('from', v_old_status::text, 'to', v_new_status::text)),
    p_webhook_id, p_actor
  );

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_status_from_linear_qep(text, text, text, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 10. Helper: log forward-sync events from the forward Edge Function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_qep_roadmap_sync_event(
  p_direction text,
  p_task_id text,
  p_linear_issue_id text,
  p_action text,
  p_changed_fields jsonb DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_webhook_id text DEFAULT NULL,
  p_actor text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.qep_roadmap_sync_events
    (direction, task_id, linear_issue_id, action, changed_fields, error_message, webhook_id, actor)
  VALUES
    (p_direction, p_task_id, p_linear_issue_id, p_action, p_changed_fields, p_error_message, p_webhook_id, p_actor);
$$;

GRANT EXECUTE ON FUNCTION public.log_qep_roadmap_sync_event(text, text, text, text, jsonb, text, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 11. Health view
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_qep_roadmap_sync_health AS
SELECT
  (SELECT count(*) FROM public.qep_roadmap_tasks)                                                       AS total_tasks,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE linear_issue_id IS NOT NULL)                     AS mirrored_tasks,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE linear_sync_status = 'synced')                   AS synced_count,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE linear_sync_status = 'pending')                  AS pending_count,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE linear_sync_status = 'error')                    AS error_count,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE linear_sync_status = 'skipped')                  AS skipped_count,
  (SELECT max(linear_synced_at) FROM public.qep_roadmap_tasks)                                          AS last_synced_at,
  (SELECT count(*) FROM public.qep_roadmap_sync_events
     WHERE occurred_at > NOW() - INTERVAL '24 hours')                                                   AS events_last_24h,
  (SELECT count(*) FROM public.qep_roadmap_sync_events
     WHERE occurred_at > NOW() - INTERVAL '24 hours' AND action = 'error')                              AS errors_last_24h,
  (SELECT count(*) FROM public.qep_roadmap_sync_events
     WHERE occurred_at > NOW() - INTERVAL '24 hours' AND direction = 'linear_to_supabase')              AS reverse_syncs_24h,
  (SELECT count(*) FROM public.qep_roadmap_sync_events
     WHERE occurred_at > NOW() - INTERVAL '24 hours' AND direction = 'supabase_to_linear')              AS forward_syncs_24h,
  (SELECT count(*) FROM public.qep_roadmap_tasks
     WHERE linear_sync_status = 'pending'
       AND updated_at < NOW() - INTERVAL '1 hour')                                                      AS stale_pending_count,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE ship_state = 'blocked')                          AS blocked_task_count,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE ship_state = 'pending_decision')                 AS pending_decision_count,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE ship_state = 'in_progress')                      AS in_progress_count,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE ship_state = 'shipped')                          AS shipped_count,
  (SELECT count(*) FROM public.qep_roadmap_tasks WHERE ship_state = 'deferred')                         AS deferred_count;

COMMENT ON VIEW public.v_qep_roadmap_sync_health IS
  'Single-row roadmap + sync health stats. Used by health checks, alerts, in-app status.';

-- ----------------------------------------------------------------------------
-- 12. RLS on the main table
-- ----------------------------------------------------------------------------
ALTER TABLE public.qep_roadmap_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qep_roadmap_tasks_service_role_all ON public.qep_roadmap_tasks;
CREATE POLICY qep_roadmap_tasks_service_role_all ON public.qep_roadmap_tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS qep_roadmap_tasks_authenticated_read ON public.qep_roadmap_tasks;
CREATE POLICY qep_roadmap_tasks_authenticated_read ON public.qep_roadmap_tasks
  FOR SELECT TO authenticated USING (true);

-- Only elevated workspace roles can mutate operational roadmap state.
-- Broad authenticated writes would let any signed-in user unblock/promote tasks.
DROP POLICY IF EXISTS qep_roadmap_tasks_authenticated_update ON public.qep_roadmap_tasks;
CREATE POLICY qep_roadmap_tasks_authenticated_update ON public.qep_roadmap_tasks
  FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager', 'owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'manager', 'owner'));

COMMIT;

-- ============================================================================
-- Down migration (commented; copy/paste to revert)
-- ============================================================================
-- BEGIN;
--   DROP VIEW  IF EXISTS public.v_qep_roadmap_sync_health;
--   DROP FUNCTION IF EXISTS public.log_qep_roadmap_sync_event;
--   DROP FUNCTION IF EXISTS public.sync_status_from_linear_qep;
--   DROP TABLE IF EXISTS public.qep_roadmap_sync_events;
--   DROP VIEW  IF EXISTS public.v_qep_roadmap_tasks_pending_linear_sync;
--   DROP TRIGGER IF EXISTS qep_roadmap_tasks_mark_linear_pending ON public.qep_roadmap_tasks;
--   DROP TRIGGER IF EXISTS qep_roadmap_tasks_touch_updated_at  ON public.qep_roadmap_tasks;
--   DROP FUNCTION IF EXISTS public.fn_qep_roadmap_tasks_mark_linear_pending;
--   DROP FUNCTION IF EXISTS public.fn_qep_roadmap_tasks_touch_updated_at;
--   DROP TABLE IF EXISTS public.qep_roadmap_tasks;
--   DROP TYPE  IF EXISTS public.qep_roadmap_ship_state;
--   DROP TYPE  IF EXISTS public.qep_roadmap_stream;
-- COMMIT;
