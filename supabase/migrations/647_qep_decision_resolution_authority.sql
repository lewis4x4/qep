-- ============================================================================
-- Migration 647: QEP decision resolution authority gate
-- Purpose: force resolved qep_decisions states through lane-aware RPC paths so
--          owner/ratify/authorize semantics cannot be bypassed by direct row
--          updates from app code or service-role scripts.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qep_decision_resolution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.qep_decisions(id) ON DELETE CASCADE,
  decision_code text NOT NULL,
  lane public.qep_decision_lane NOT NULL,
  previous_status public.qep_decision_status NOT NULL,
  target_status public.qep_decision_status NOT NULL,
  actor text NOT NULL,
  answered_option text,
  answered_rationale text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qep_decision_resolution_audit_actor_ck CHECK (length(trim(actor)) > 0),
  CONSTRAINT qep_decision_resolution_audit_code_ck CHECK (length(trim(decision_code)) > 0)
);

CREATE INDEX IF NOT EXISTS qep_decision_resolution_audit_decision_idx
  ON public.qep_decision_resolution_audit (decision_id, created_at DESC);

CREATE INDEX IF NOT EXISTS qep_decision_resolution_audit_lane_idx
  ON public.qep_decision_resolution_audit (lane, target_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_qep_decision_resolution_authority_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_resolved_transition boolean;
  v_sensitive_answer_change boolean;
BEGIN
  v_resolved_transition :=
    NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status::text IN ('answered', 'shadow_ship', 'superseded');

  v_sensitive_answer_change :=
    NEW.answered_by IS DISTINCT FROM OLD.answered_by
    OR NEW.answered_at IS DISTINCT FROM OLD.answered_at
    OR NEW.answered_option IS DISTINCT FROM OLD.answered_option
    OR NEW.answered_rationale IS DISTINCT FROM OLD.answered_rationale
    OR NEW.audit_url IS DISTINCT FROM OLD.audit_url;

  IF NOT (v_resolved_transition OR v_sensitive_answer_change) THEN
    RETURN NEW;
  END IF;

  -- SECURITY DEFINER resolver/signature/delegation RPCs execute as their owner.
  -- Direct table writes from authenticated or service_role callers do not.
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.qep_decision_resolution_authority', true) IN (
    'resolve_qep_decision',
    'record_qep_authorize_signature',
    'apply_qep_delegated_recommendation'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'qep_decisions resolution must use lane-aware RPC'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS qep_decisions_resolution_authority_guard ON public.qep_decisions;
CREATE TRIGGER qep_decisions_resolution_authority_guard
  BEFORE UPDATE ON public.qep_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_decision_resolution_authority_guard();

CREATE OR REPLACE FUNCTION public.resolve_qep_decision(
  p_decision_code text,
  p_target_status public.qep_decision_status,
  p_answered_option text DEFAULT NULL,
  p_answered_rationale text DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_actor text := COALESCE(NULLIF(btrim(p_actor), ''), 'resolve-qep-decision-rpc');
  v_target_status public.qep_decision_status := p_target_status;
  v_decision public.qep_decisions%ROWTYPE;
  v_updated public.qep_decisions%ROWTYPE;
  v_answered_option text;
  v_answered_rationale text;
  v_context jsonb := COALESCE(p_context, '{}'::jsonb);
  v_audit public.qep_decision_resolution_audit%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND public.get_my_role() NOT IN ('admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_decision_code IS NULL OR btrim(p_decision_code) = '' THEN
    RAISE EXCEPTION 'decision_code is required';
  END IF;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'target_status is required';
  END IF;

  IF v_target_status::text NOT IN ('open', 'escalated', 'answered', 'shadow_ship', 'superseded') THEN
    RAISE EXCEPTION 'target_status % is not supported by resolve_qep_decision', v_target_status;
  END IF;

  SELECT *
  INTO v_decision
  FROM public.qep_decisions
  WHERE code = btrim(p_decision_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decision % not found', p_decision_code;
  END IF;

  IF v_decision.status::text IN ('answered', 'superseded') THEN
    RAISE EXCEPTION 'decision % status % is already terminal', v_decision.code, v_decision.status;
  END IF;

  IF v_target_status = 'answered'::public.qep_decision_status THEN
    IF v_decision.lane = 'authorize'::public.qep_decision_lane THEN
      RAISE EXCEPTION 'AUTHORISE lane decisions must resolve through record_qep_authorize_signature';
    END IF;

    v_answered_option := COALESCE(
      NULLIF(btrim(COALESCE(p_answered_option, '')), ''),
      NULLIF(btrim(COALESCE(v_decision.recommended_option, '')), '')
    );

    IF v_answered_option IS NULL THEN
      RAISE EXCEPTION 'decision % has no answered option or recommended_option', v_decision.code;
    END IF;
  ELSIF v_target_status = 'shadow_ship'::public.qep_decision_status THEN
    IF v_decision.lane <> 'ratify'::public.qep_decision_lane THEN
      RAISE EXCEPTION 'shadow_ship is only valid for RATIFY lane decisions';
    END IF;

    v_answered_option := COALESCE(
      NULLIF(btrim(COALESCE(p_answered_option, '')), ''),
      NULLIF(btrim(COALESCE(v_decision.recommended_option, '')), '')
    );

    IF v_answered_option IS NULL THEN
      RAISE EXCEPTION 'decision % has no answered option or recommended_option', v_decision.code;
    END IF;
  ELSIF v_target_status = 'superseded'::public.qep_decision_status THEN
    IF NULLIF(btrim(COALESCE(p_answered_rationale, '')), '') IS NULL THEN
      RAISE EXCEPTION 'superseded decisions require answered_rationale';
    END IF;
    v_answered_option := COALESCE(NULLIF(btrim(COALESCE(p_answered_option, '')), ''), 'superseded');
  ELSE
    v_answered_option := NULL;
  END IF;

  v_answered_rationale := COALESCE(
    NULLIF(btrim(COALESCE(p_answered_rationale, '')), ''),
    format('Resolved via lane-aware decision RPC by %s at %s.', v_actor, v_now)
  );

  UPDATE public.qep_decisions
  SET status = v_target_status,
      answered_by = CASE
        WHEN v_target_status::text IN ('answered', 'shadow_ship', 'superseded') THEN v_actor
        ELSE answered_by
      END,
      answered_at = CASE
        WHEN v_target_status::text IN ('answered', 'shadow_ship', 'superseded') THEN v_now
        ELSE answered_at
      END,
      answered_option = CASE
        WHEN v_target_status::text IN ('answered', 'shadow_ship', 'superseded') THEN v_answered_option
        ELSE answered_option
      END,
      answered_rationale = CASE
        WHEN v_target_status::text IN ('answered', 'shadow_ship', 'superseded') THEN v_answered_rationale
        ELSE answered_rationale
      END,
      ai_prep_packet = COALESCE(v_decision.ai_prep_packet, '{}'::jsonb)
        || v_context
        || jsonb_build_object(
          'decision_resolution', jsonb_build_object(
            'actor', v_actor,
            'target_status', v_target_status::text,
            'resolved_at', v_now,
            'via', 'resolve_qep_decision'
          )
        )
  WHERE id = v_decision.id
  RETURNING * INTO v_updated;

  INSERT INTO public.qep_decision_resolution_audit (
    decision_id,
    decision_code,
    lane,
    previous_status,
    target_status,
    actor,
    answered_option,
    answered_rationale,
    context
  )
  VALUES (
    v_decision.id,
    v_decision.code,
    v_decision.lane,
    v_decision.status,
    v_target_status,
    v_actor,
    v_answered_option,
    v_answered_rationale,
    v_context
  )
  RETURNING * INTO v_audit;

  INSERT INTO public.qep_roadmap_sync_events
    (direction, task_id, action, changed_fields, actor)
  VALUES (
    'reconcile',
    NULL,
    'update',
    jsonb_build_object(
      'reason', 'decision_resolved_via_lane_aware_rpc',
      'decision_code', v_decision.code,
      'lane', v_decision.lane::text,
      'from_status', v_decision.status::text,
      'to_status', v_target_status::text,
      'audit_id', v_audit.id
    ),
    v_actor
  );

  RETURN jsonb_build_object(
    'decision_id', v_updated.id,
    'decision_code', v_updated.code,
    'lane', v_updated.lane::text,
    'previous_status', v_decision.status::text,
    'status', v_updated.status::text,
    'audit_id', v_audit.id,
    'answered_by', v_updated.answered_by,
    'answered_at', v_updated.answered_at,
    'answered_option', v_updated.answered_option
  );
END;
$$;

ALTER TABLE public.qep_decision_resolution_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qep_decision_resolution_audit_service_role_all ON public.qep_decision_resolution_audit;
CREATE POLICY qep_decision_resolution_audit_service_role_all
  ON public.qep_decision_resolution_audit
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS qep_decision_resolution_audit_authenticated_read ON public.qep_decision_resolution_audit;
CREATE POLICY qep_decision_resolution_audit_authenticated_read
  ON public.qep_decision_resolution_audit
  FOR SELECT TO authenticated
  USING (true);

REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_resolution_authority_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_resolution_authority_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_resolution_authority_guard() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_qep_decision(text, public.qep_decision_status, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_qep_decision(text, public.qep_decision_status, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_qep_decision(text, public.qep_decision_status, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_qep_decision(text, public.qep_decision_status, text, text, text, jsonb) TO service_role;

COMMENT ON TABLE public.qep_decision_resolution_audit IS
  'Immutable audit ledger for qep_decisions status resolutions made through lane-aware resolver RPCs.';

COMMENT ON FUNCTION public.resolve_qep_decision(text, public.qep_decision_status, text, text, text, jsonb) IS
  'Lane-aware qep_decisions resolver. AUTO/RATIFY may answer through this path; RATIFY may shadow_ship; AUTHORIZE answers must flow through record_qep_authorize_signature.';

COMMENT ON FUNCTION public.fn_qep_decision_resolution_authority_guard() IS
  'Blocks direct qep_decisions resolved-state updates by app/service-role clients; resolved decisions must use lane-aware RPCs.';

COMMIT;
