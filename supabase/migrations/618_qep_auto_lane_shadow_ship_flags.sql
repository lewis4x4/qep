-- ============================================================================
-- Migration 618: AUTO-lane shadow-ship infrastructure (QEP-147 / F3.1)
-- Purpose: flag-scoped shadow shipping for one rep, plus callable silence
--          ratification for AUTO-lane decisions.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'qep_shadow_ship_status'
  ) THEN
    CREATE TYPE public.qep_shadow_ship_status AS ENUM (
      'shadow_ship',
      'ratified',
      'reverted'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.qep_shadow_ship_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.qep_decisions(id) ON DELETE CASCADE,
  decision_code text NOT NULL,
  task_id text REFERENCES public.qep_roadmap_tasks(task_id) ON DELETE SET NULL,
  feature_flag text NOT NULL,
  rep_scope text NOT NULL,
  recommendation text NOT NULL,
  status public.qep_shadow_ship_status NOT NULL DEFAULT 'shadow_ship',
  silence_threshold_days integer NOT NULL,
  silence_deadline_at timestamptz NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  activated_by text NOT NULL,
  ratified_at timestamptz,
  ratified_by text,
  reverted_at timestamptz,
  reverted_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qep_shadow_ship_flags_scope_not_blank
    CHECK (length(trim(feature_flag)) > 0 AND length(trim(rep_scope)) > 0),
  CONSTRAINT qep_shadow_ship_flags_status_timestamps_ck
    CHECK (
      (status = 'shadow_ship' AND ratified_at IS NULL AND reverted_at IS NULL)
      OR (status = 'ratified' AND ratified_at IS NOT NULL AND reverted_at IS NULL)
      OR (status = 'reverted' AND reverted_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS qep_shadow_ship_flags_decision_idx
  ON public.qep_shadow_ship_flags (decision_id, status, silence_deadline_at);

CREATE INDEX IF NOT EXISTS qep_shadow_ship_flags_scope_idx
  ON public.qep_shadow_ship_flags (feature_flag, rep_scope, status);

CREATE UNIQUE INDEX IF NOT EXISTS qep_shadow_ship_flags_active_scope_uniq
  ON public.qep_shadow_ship_flags (
    decision_id,
    feature_flag,
    rep_scope,
    COALESCE(task_id, '')
  )
  WHERE status = 'shadow_ship';

CREATE OR REPLACE FUNCTION public.fn_qep_shadow_ship_flags_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qep_shadow_ship_flags_touch_updated_at ON public.qep_shadow_ship_flags;
CREATE TRIGGER qep_shadow_ship_flags_touch_updated_at
  BEFORE UPDATE ON public.qep_shadow_ship_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_shadow_ship_flags_touch_updated_at();

CREATE OR REPLACE FUNCTION public.activate_qep_auto_shadow_ship(
  p_decision_code text,
  p_feature_flag text,
  p_rep_scope text,
  p_recommendation text,
  p_task_id text DEFAULT NULL,
  p_actor text DEFAULT 'auto-shadow-ship',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.qep_shadow_ship_flags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision public.qep_decisions%ROWTYPE;
  v_silence_days integer;
  v_now timestamptz := now();
  v_row public.qep_shadow_ship_flags%ROWTYPE;
  v_role text;
BEGIN
  v_role := auth.role();
  IF v_role IS DISTINCT FROM 'service_role'
     AND public.get_my_role() NOT IN ('admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_decision_code IS NULL OR btrim(p_decision_code) = '' THEN
    RAISE EXCEPTION 'decision_code is required';
  END IF;

  IF p_feature_flag IS NULL OR btrim(p_feature_flag) = '' THEN
    RAISE EXCEPTION 'feature_flag is required';
  END IF;

  IF p_rep_scope IS NULL OR btrim(p_rep_scope) = '' THEN
    RAISE EXCEPTION 'rep_scope is required';
  END IF;

  IF p_recommendation IS NULL OR btrim(p_recommendation) = '' THEN
    RAISE EXCEPTION 'recommendation is required';
  END IF;

  SELECT *
  INTO v_decision
  FROM public.qep_decisions
  WHERE code = p_decision_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decision % not found', p_decision_code;
  END IF;

  IF v_decision.lane::text <> 'auto' THEN
    RAISE EXCEPTION 'decision % is not AUTO lane', p_decision_code;
  END IF;

  IF v_decision.status::text NOT IN ('open', 'escalated') THEN
    RAISE EXCEPTION 'decision % status % is not open/escalated', p_decision_code, v_decision.status;
  END IF;

  IF COALESCE(v_decision.recommended_option, '') = '' THEN
    RAISE EXCEPTION 'decision % has no recommended_option', p_decision_code;
  END IF;

  IF btrim(p_recommendation) <> btrim(v_decision.recommended_option) THEN
    RAISE EXCEPTION 'recommendation must match decision recommended_option';
  END IF;

  IF p_task_id IS NOT NULL THEN
    PERFORM 1
    FROM public.qep_roadmap_tasks
    WHERE task_id = p_task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'task_id % not found', p_task_id;
    END IF;
  END IF;

  v_silence_days := COALESCE(v_decision.silence_threshold_days, 1);
  IF v_silence_days < 1 THEN
    v_silence_days := 1;
  END IF;

  INSERT INTO public.qep_shadow_ship_flags (
    decision_id,
    decision_code,
    task_id,
    feature_flag,
    rep_scope,
    recommendation,
    status,
    silence_threshold_days,
    silence_deadline_at,
    activated_at,
    activated_by,
    metadata
  )
  VALUES (
    v_decision.id,
    v_decision.code,
    p_task_id,
    btrim(p_feature_flag),
    btrim(p_rep_scope),
    btrim(p_recommendation),
    'shadow_ship'::public.qep_shadow_ship_status,
    v_silence_days,
    v_now + make_interval(days => v_silence_days),
    v_now,
    COALESCE(NULLIF(btrim(p_actor), ''), 'auto-shadow-ship'),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_row;

  UPDATE public.qep_decisions
  SET status = 'shadow_ship'::public.qep_decision_status,
      answered_by = COALESCE(NULLIF(btrim(p_actor), ''), 'auto-shadow-ship'),
      answered_at = v_now,
      answered_option = v_decision.recommended_option,
      answered_rationale = format(
        'AUTO shadow-ship activated for feature flag %s and rep scope %s. Silence deadline %s UTC. Recommendation live for one rep.',
        btrim(p_feature_flag),
        btrim(p_rep_scope),
        to_char(v_row.silence_deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ),
      ai_prep_packet = COALESCE(v_decision.ai_prep_packet, '{}'::jsonb) || jsonb_build_object(
        'auto_shadow_ship',
        jsonb_build_object(
          'ledger_id', v_row.id,
          'feature_flag', v_row.feature_flag,
          'rep_scope', v_row.rep_scope,
          'activated_at', v_row.activated_at,
          'silence_deadline_at', v_row.silence_deadline_at,
          'recommendation', v_row.recommendation
        )
      )
  WHERE id = v_decision.id;

  INSERT INTO public.qep_roadmap_sync_events
    (direction, task_id, action, changed_fields, actor)
  VALUES (
    'reconcile',
    p_task_id,
    'update',
    jsonb_build_object(
      'reason', 'auto_shadow_ship_activated',
      'decision_code', v_decision.code,
      'decision_status', 'shadow_ship',
      'feature_flag', v_row.feature_flag,
      'rep_scope', v_row.rep_scope,
      'recommendation', v_row.recommendation,
      'silence_deadline_at', v_row.silence_deadline_at,
      'ledger_id', v_row.id
    ),
    COALESCE(NULLIF(btrim(p_actor), ''), 'auto-shadow-ship')
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.ratify_expired_qep_auto_shadow_ship(
  p_now timestamptz DEFAULT now(),
  p_actor text DEFAULT 'auto-shadow-ship-ratifier'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_ratified integer := 0;
  v_ledger_ids uuid[] := ARRAY[]::uuid[];
  v_decision_codes text[] := ARRAY[]::text[];
  v_task_ids text[] := ARRAY[]::text[];
  v_actor text := COALESCE(NULLIF(btrim(p_actor), ''), 'auto-shadow-ship-ratifier');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR v_row IN
    SELECT f.id, f.decision_id, f.decision_code, f.task_id, f.feature_flag, f.rep_scope
    FROM public.qep_shadow_ship_flags f
    JOIN public.qep_decisions d
      ON d.id = f.decision_id
    WHERE f.status = 'shadow_ship'::public.qep_shadow_ship_status
      AND f.silence_deadline_at <= p_now
      AND d.lane = 'auto'::public.qep_decision_lane
    FOR UPDATE OF f
  LOOP
    UPDATE public.qep_shadow_ship_flags
    SET status = 'ratified'::public.qep_shadow_ship_status,
        ratified_at = p_now,
        ratified_by = v_actor
    WHERE id = v_row.id;

    UPDATE public.qep_decisions
    SET status = 'answered'::public.qep_decision_status,
        answered_by = v_actor,
        answered_at = p_now,
        answered_option = COALESCE(answered_option, recommended_option),
        answered_rationale = format(
          'AUTO shadow-ship ratified after silence threshold for feature flag %s and rep scope %s (ledger %s).',
          v_row.feature_flag,
          v_row.rep_scope,
          v_row.id
        )
    WHERE id = v_row.decision_id
      AND status = 'shadow_ship'::public.qep_decision_status;

    INSERT INTO public.qep_roadmap_sync_events
      (direction, task_id, action, changed_fields, actor)
    VALUES (
      'reconcile',
      v_row.task_id,
      'update',
      jsonb_build_object(
        'reason', 'auto_shadow_ship_ratified',
        'decision_code', v_row.decision_code,
        'feature_flag', v_row.feature_flag,
        'rep_scope', v_row.rep_scope,
        'ledger_id', v_row.id,
        'ratified_at', p_now
      ),
      v_actor
    );

    v_ratified := v_ratified + 1;
    v_ledger_ids := array_append(v_ledger_ids, v_row.id);
    v_decision_codes := array_append(v_decision_codes, v_row.decision_code);
    v_task_ids := array_append(v_task_ids, v_row.task_id);
  END LOOP;

  RETURN jsonb_build_object(
    'ratified_count', v_ratified,
    'ledger_ids', to_jsonb(v_ledger_ids),
    'decision_codes', to_jsonb(v_decision_codes),
    'task_ids', to_jsonb(v_task_ids),
    'ratified_at', p_now,
    'actor', v_actor
  );
END;
$$;

ALTER TABLE public.qep_shadow_ship_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qep_shadow_ship_flags_service_role_all ON public.qep_shadow_ship_flags;
CREATE POLICY qep_shadow_ship_flags_service_role_all
  ON public.qep_shadow_ship_flags
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS qep_shadow_ship_flags_authenticated_read ON public.qep_shadow_ship_flags;
CREATE POLICY qep_shadow_ship_flags_authenticated_read
  ON public.qep_shadow_ship_flags
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS qep_shadow_ship_flags_authenticated_write ON public.qep_shadow_ship_flags;
CREATE POLICY qep_shadow_ship_flags_authenticated_write
  ON public.qep_shadow_ship_flags
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('admin', 'manager', 'owner'));

REVOKE EXECUTE ON FUNCTION public.fn_qep_shadow_ship_flags_touch_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_qep_shadow_ship_flags_touch_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_qep_shadow_ship_flags_touch_updated_at() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.activate_qep_auto_shadow_ship(text, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_qep_auto_shadow_ship(text, text, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_qep_auto_shadow_ship(text, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_qep_auto_shadow_ship(text, text, text, text, text, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ratify_expired_qep_auto_shadow_ship(timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ratify_expired_qep_auto_shadow_ship(timestamptz, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ratify_expired_qep_auto_shadow_ship(timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ratify_expired_qep_auto_shadow_ship(timestamptz, text) TO service_role;

COMMENT ON TABLE public.qep_shadow_ship_flags IS
  'Ledger of AUTO-lane shadow-ship activations, scoped by feature_flag + rep_scope with silence-ratification lifecycle.';

COMMENT ON FUNCTION public.activate_qep_auto_shadow_ship(text, text, text, text, text, text, jsonb) IS
  'QEP-147/F3.1: activate AUTO-lane shadow-ship for one feature flag and one rep scope; writes ledger + flips decision to shadow_ship so existing promotion trigger unblocks gated tasks.';

COMMENT ON FUNCTION public.ratify_expired_qep_auto_shadow_ship(timestamptz, text) IS
  'QEP-147/F3.1 service-role ratifier: marks expired AUTO shadow-ship ledger rows as ratified and stamps decision answered metadata.';

COMMIT;
