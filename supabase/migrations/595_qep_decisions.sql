-- ============================================================================
-- Migration 595: qep_decisions — Decision Inbox foundation
-- Purpose: tracks owner decisions blocking qep_roadmap_tasks rows. When a
--          decision is answered, gated tasks auto-promote from pending_decision
--          back to not_started.
-- Author: BlackRock AI
-- Date: 2026-05-19
-- Companion: QEP_DECISION_INBOX_MOONSHOT_V2.md
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Decision lane enum
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qep_decision_lane') THEN
    CREATE TYPE public.qep_decision_lane AS ENUM ('auto', 'ratify', 'authorize');
  END IF;
END$$;

COMMENT ON TYPE public.qep_decision_lane IS
  'auto = ship behind flag, silence = ratification · ratify = recommend with citations, ship in shadow mode after 7d silence · authorize = owner must author, signed audit, never auto-ratify';

-- ----------------------------------------------------------------------------
-- 2. Decision status enum
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qep_decision_status') THEN
    CREATE TYPE public.qep_decision_status AS ENUM (
      'open',          -- awaiting owner action
      'answered',      -- owner gave a clear answer (or AUTO-lane silence)
      'shadow_ship',   -- shipped behind flag awaiting ratification (RATIFY silence)
      'escalated',     -- past silence threshold, awaiting Brian intervention
      'superseded'     -- scope changed, decision no longer needed
    );
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 3. qep_decisions — one row per blocking_decision code
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qep_decisions (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                          text NOT NULL UNIQUE,
  question_plain                text NOT NULL,
  lane                          public.qep_decision_lane NOT NULL,
  owner_role                    text NOT NULL,
  requires_two_sigs             text[],
  options                       jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_option            text,
  recommended_rationale         text,
  ai_prep_packet                jsonb,
  citations                     jsonb,
  reversal_cost                 text,
  silence_threshold_days        integer,
  unblocks_recompute_codes      text[],
  status                        public.qep_decision_status NOT NULL DEFAULT 'open',
  answered_by                   text,
  answered_at                   timestamptz,
  answered_option               text,
  answered_rationale            text,
  audit_url                     text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.qep_decisions IS
  'Decision Inbox V2 — one row per blocking_decision code (Q6, JAR-103, etc). When status flips to answered/shadow_ship/superseded, gated qep_roadmap_tasks auto-promote.';

COMMENT ON COLUMN public.qep_decisions.code IS
  'Human code matching qep_roadmap_tasks.blocking_decision (Q6, JAR-103, BLK-3, CYBER-INS).';
COMMENT ON COLUMN public.qep_decisions.question_plain IS
  'Owner-facing question in plain English — no jargon, no internal codes.';
COMMENT ON COLUMN public.qep_decisions.options IS
  'JSONB array: [{label, description, implication, is_recommended bool}]';
COMMENT ON COLUMN public.qep_decisions.ai_prep_packet IS
  'JSONB: {context, history, citations[], recommended_with_reasoning, reversal_cost}';
COMMENT ON COLUMN public.qep_decisions.citations IS
  'JSONB array of citations: [{source: "transcript|email|spec|codebase", ref: "...", excerpt: "..."}]';
COMMENT ON COLUMN public.qep_decisions.requires_two_sigs IS
  'For AUTHORIZE lane only — owner_roles that must both sign before answered fires (e.g. [tina, ryan] for JAR-103).';
COMMENT ON COLUMN public.qep_decisions.silence_threshold_days IS
  'Per-lane default if NULL. AUTO=1, RATIFY=7, AUTHORIZE=NULL (never silence-resolve).';

-- ----------------------------------------------------------------------------
-- 4. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS qep_decisions_owner_status_idx
  ON public.qep_decisions (owner_role, status, created_at DESC);

CREATE INDEX IF NOT EXISTS qep_decisions_lane_status_idx
  ON public.qep_decisions (lane, status);

CREATE INDEX IF NOT EXISTS qep_decisions_open_aging_idx
  ON public.qep_decisions (created_at)
  WHERE status = 'open';

-- ----------------------------------------------------------------------------
-- 5. updated_at trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_qep_decisions_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qep_decisions_touch_updated_at ON public.qep_decisions;
CREATE TRIGGER qep_decisions_touch_updated_at
  BEFORE UPDATE ON public.qep_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_decisions_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6. qep_decision_blocks — junction: which roadmap tasks each decision gates
--    (Built from qep_roadmap_tasks.blocking_decision but materialized for speed.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qep_decision_blocks (
  decision_id  uuid NOT NULL REFERENCES public.qep_decisions(id) ON DELETE CASCADE,
  task_id      text NOT NULL REFERENCES public.qep_roadmap_tasks(task_id) ON DELETE CASCADE,
  PRIMARY KEY (decision_id, task_id)
);

CREATE INDEX IF NOT EXISTS qep_decision_blocks_task_idx
  ON public.qep_decision_blocks (task_id);

COMMENT ON TABLE public.qep_decision_blocks IS
  'Junction wiring qep_decisions to qep_roadmap_tasks. Populated by trigger on qep_roadmap_tasks AND by direct INSERT in seed migrations.';

-- ----------------------------------------------------------------------------
-- 7. qep_decision_precedents — for similarity matching on future decisions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qep_decision_precedents (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_decision_id       uuid NOT NULL REFERENCES public.qep_decisions(id) ON DELETE CASCADE,
  pattern_summary          text NOT NULL,
  applied_answer           text NOT NULL,
  applied_rationale        text,
  owner_role               text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qep_decision_precedents_owner_idx
  ON public.qep_decision_precedents (owner_role);

COMMENT ON TABLE public.qep_decision_precedents IS
  'Answered decisions feed this table so the auto-triage pipeline can suggest precedent-based answers for future decisions.';

-- ----------------------------------------------------------------------------
-- 8. THE BIG TRIGGER — when a decision is answered/shadow_ship/superseded,
--    auto-promote gated qep_roadmap_tasks from pending_decision to not_started.
--    Also writes an audit row to qep_roadmap_sync_events.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_qep_decision_resolved_promote_tasks()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE
  v_task RECORD;
  v_promoted_count integer := 0;
BEGIN
  -- Only fire when transitioning INTO a resolved state (answered / shadow_ship / superseded)
  IF NOT (NEW.status::text IN ('answered','shadow_ship','superseded'))
     OR (OLD.status::text IN ('answered','shadow_ship','superseded')) THEN
    RETURN NEW;
  END IF;

  -- Promote every pending_decision task gated on this code
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

    -- Log audit row
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

  -- Bonus: write a precedent row for future similarity matching
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

DROP TRIGGER IF EXISTS qep_decisions_resolved_promote_tasks ON public.qep_decisions;
CREATE TRIGGER qep_decisions_resolved_promote_tasks
  AFTER UPDATE ON public.qep_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_decision_resolved_promote_tasks();

-- ----------------------------------------------------------------------------
-- 9. Helper view: open decisions per owner with task impact rollup
-- ----------------------------------------------------------------------------
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
     WHERE t.blocking_decision = d.code AND t.ship_state = 'pending_decision') AS gated_streams
FROM public.qep_decisions d
WHERE d.status IN ('open', 'escalated', 'shadow_ship')
ORDER BY d.lane DESC, d.created_at ASC;

COMMENT ON VIEW public.v_qep_decisions_owner_inbox IS
  'One row per open/escalated decision with impact rollup. Owners filter by owner_role; Brian sees all for the triage view.';

-- ----------------------------------------------------------------------------
-- 10. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.qep_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qep_decision_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qep_decision_precedents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qep_decisions_service_role_all ON public.qep_decisions;
CREATE POLICY qep_decisions_service_role_all ON public.qep_decisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS qep_decisions_authenticated_read ON public.qep_decisions;
CREATE POLICY qep_decisions_authenticated_read ON public.qep_decisions
  FOR SELECT TO authenticated USING (true);

-- Only elevated workspace roles can mutate decision records. App-layer owner
-- checks are not sufficient for RLS-protected operational control tables.
DROP POLICY IF EXISTS qep_decisions_authenticated_update ON public.qep_decisions;
CREATE POLICY qep_decisions_authenticated_update ON public.qep_decisions
  FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager', 'owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'manager', 'owner'));

DROP POLICY IF EXISTS qep_decision_blocks_service_role_all ON public.qep_decision_blocks;
CREATE POLICY qep_decision_blocks_service_role_all ON public.qep_decision_blocks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS qep_decision_blocks_authenticated_read ON public.qep_decision_blocks;
CREATE POLICY qep_decision_blocks_authenticated_read ON public.qep_decision_blocks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS qep_decision_precedents_service_role_all ON public.qep_decision_precedents;
CREATE POLICY qep_decision_precedents_service_role_all ON public.qep_decision_precedents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS qep_decision_precedents_authenticated_read ON public.qep_decision_precedents;
CREATE POLICY qep_decision_precedents_authenticated_read ON public.qep_decision_precedents
  FOR SELECT TO authenticated USING (true);

COMMIT;

-- ============================================================================
-- Down migration (commented; copy/paste to revert)
-- ============================================================================
-- BEGIN;
--   DROP VIEW IF EXISTS public.v_qep_decisions_owner_inbox;
--   DROP TRIGGER IF EXISTS qep_decisions_resolved_promote_tasks ON public.qep_decisions;
--   DROP FUNCTION IF EXISTS public.fn_qep_decision_resolved_promote_tasks;
--   DROP TRIGGER IF EXISTS qep_decisions_touch_updated_at ON public.qep_decisions;
--   DROP FUNCTION IF EXISTS public.fn_qep_decisions_touch_updated_at;
--   DROP TABLE IF EXISTS public.qep_decision_precedents;
--   DROP TABLE IF EXISTS public.qep_decision_blocks;
--   DROP TABLE IF EXISTS public.qep_decisions;
--   DROP TYPE  IF EXISTS public.qep_decision_status;
--   DROP TYPE  IF EXISTS public.qep_decision_lane;
-- COMMIT;
