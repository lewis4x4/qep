-- ============================================================================
-- Migration 621: per-owner delegation toggles + delegated recommendation audit
-- Purpose: store owner delegation policies by decision class and provide a
--          guarded RPC that applies Brian's recommendation only when a policy
--          match is enabled, while capturing immutable audit evidence.
-- ============================================================================

BEGIN;

ALTER TABLE public.qep_decisions
  ADD COLUMN IF NOT EXISTS decision_class text;

COMMENT ON COLUMN public.qep_decisions.decision_class IS
  'Optional deterministic decision class (e.g. copy_ux, visual, compliance_tila, parts_pricing_mechanics) used for per-owner delegation policies.';

CREATE TABLE IF NOT EXISTS public.qep_decision_delegation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_role text NOT NULL,
  decision_class text NOT NULL,
  delegate_role text NOT NULL DEFAULT 'brian',
  delegate_actor text NOT NULL DEFAULT 'brian',
  enabled boolean NOT NULL DEFAULT false,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by text NOT NULL DEFAULT 'system',
  updated_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qep_decision_delegation_policies_owner_role_ck CHECK (length(trim(owner_role)) > 0),
  CONSTRAINT qep_decision_delegation_policies_decision_class_ck CHECK (length(trim(decision_class)) > 0),
  CONSTRAINT qep_decision_delegation_policies_delegate_role_ck CHECK (length(trim(delegate_role)) > 0),
  CONSTRAINT qep_decision_delegation_policies_delegate_actor_ck CHECK (length(trim(delegate_actor)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS qep_decision_delegation_policies_owner_class_delegate_uniq
  ON public.qep_decision_delegation_policies (owner_role, decision_class, delegate_actor);

CREATE INDEX IF NOT EXISTS qep_decision_delegation_policies_lookup_idx
  ON public.qep_decision_delegation_policies (owner_role, decision_class, delegate_actor, enabled);

CREATE OR REPLACE FUNCTION public.fn_qep_decision_delegation_policies_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qep_decision_delegation_policies_touch_updated_at ON public.qep_decision_delegation_policies;
CREATE TRIGGER qep_decision_delegation_policies_touch_updated_at
  BEFORE UPDATE ON public.qep_decision_delegation_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_decision_delegation_policies_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.qep_decision_delegation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.qep_decisions(id) ON DELETE CASCADE,
  decision_code text NOT NULL,
  owner_role text NOT NULL,
  decision_class text NOT NULL,
  delegate_role text NOT NULL,
  delegate_actor text NOT NULL,
  policy_id uuid REFERENCES public.qep_decision_delegation_policies(id) ON DELETE SET NULL,
  approved_option text NOT NULL,
  approved_rationale text,
  source_recommended_option text,
  source_recommended_rationale text,
  applied_by text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  rationale text,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qep_decision_delegation_audit_decision_idx
  ON public.qep_decision_delegation_audit (decision_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS qep_decision_delegation_audit_owner_idx
  ON public.qep_decision_delegation_audit (owner_role, decision_class, applied_at DESC);

CREATE OR REPLACE FUNCTION public.fn_qep_decision_classify(
  p_decision_class text,
  p_question_plain text,
  p_decision_code text,
  p_ai_prep_packet jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_explicit text;
  v_packet_class text;
  v_haystack text;
BEGIN
  v_explicit := NULLIF(lower(btrim(COALESCE(p_decision_class, ''))), '');
  IF v_explicit IS NOT NULL THEN
    RETURN v_explicit;
  END IF;

  v_packet_class := NULLIF(lower(btrim(COALESCE(p_ai_prep_packet->>'decision_class', ''))), '');
  IF v_packet_class IS NOT NULL THEN
    RETURN v_packet_class;
  END IF;

  v_haystack := lower(
    concat_ws(
      ' ',
      COALESCE(p_question_plain, ''),
      COALESCE(p_decision_code, ''),
      COALESCE(p_ai_prep_packet::text, '')
    )
  );

  IF v_haystack ~ '(tila|compliance)' THEN
    RETURN 'compliance_tila';
  ELSIF v_haystack ~ '(closed[ -]?period|close[ -]?period)' THEN
    RETURN 'closed_period_policy';
  ELSIF v_haystack ~ '(pricing[ -]?policy|price[ -]?policy)' THEN
    RETURN 'pricing_policy';
  ELSIF v_haystack ~ '(parts[ -]?pricing[ -]?mechanic|parts pricing mechanic|parts pricing mechanics)' THEN
    RETURN 'parts_pricing_mechanics';
  ELSIF v_haystack ~ '(accounting[ -]?mechanic|accounting mechanics)' THEN
    RETURN 'accounting_mechanics';
  ELSIF v_haystack ~ '(copy|wording|tone|messaging|ux)' THEN
    RETURN 'copy_ux';
  ELSIF v_haystack ~ '(visual|ui|design|layout|brand|branding)' THEN
    RETURN 'visual';
  ELSIF v_haystack ~ '(non[ -]?visual)' THEN
    RETURN 'non_visual';
  END IF;

  RETURN 'non_visual';
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_qep_delegated_recommendation(
  p_decision_code text,
  p_delegate_actor text DEFAULT 'brian',
  p_rationale text DEFAULT NULL,
  p_applied_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_actor text := lower(COALESCE(NULLIF(btrim(p_delegate_actor), ''), 'brian'));
  v_applied_by text := COALESCE(NULLIF(btrim(p_applied_by), ''), format('delegation-rpc:%s', v_actor));
  v_decision public.qep_decisions%ROWTYPE;
  v_class text;
  v_policy public.qep_decision_delegation_policies%ROWTYPE;
  v_audit public.qep_decision_delegation_audit%ROWTYPE;
  v_answered_rationale text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND public.get_my_role() NOT IN ('admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_decision_code IS NULL OR btrim(p_decision_code) = '' THEN
    RAISE EXCEPTION 'decision_code is required';
  END IF;

  SELECT *
  INTO v_decision
  FROM public.qep_decisions
  WHERE code = btrim(p_decision_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decision % not found', p_decision_code;
  END IF;

  IF v_decision.status::text NOT IN ('open', 'escalated', 'shadow_ship') THEN
    RAISE EXCEPTION 'decision % status % is not eligible for delegated apply', v_decision.code, v_decision.status;
  END IF;

  IF NULLIF(btrim(COALESCE(v_decision.recommended_option, '')), '') IS NULL THEN
    RAISE EXCEPTION 'decision % has no recommended_option', v_decision.code;
  END IF;

  v_class := public.fn_qep_decision_classify(
    v_decision.decision_class,
    v_decision.question_plain,
    v_decision.code,
    v_decision.ai_prep_packet
  );

  SELECT *
  INTO v_policy
  FROM public.qep_decision_delegation_policies p
  WHERE lower(p.owner_role) = lower(v_decision.owner_role)
    AND lower(p.delegate_actor) = v_actor
    AND p.enabled = true
    AND (lower(p.decision_class) = v_class OR p.decision_class = '*')
  ORDER BY CASE WHEN lower(p.decision_class) = v_class THEN 0 ELSE 1 END
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no enabled delegation policy for owner % class % delegate %', v_decision.owner_role, v_class, v_actor;
  END IF;

  v_answered_rationale := concat_ws(
    ' ',
    format(
      'Delegated recommendation applied by %s under policy %s. Brian is approver of record.',
      v_actor,
      v_policy.id
    ),
    NULLIF(btrim(COALESCE(v_decision.recommended_rationale, '')), ''),
    CASE
      WHEN NULLIF(btrim(COALESCE(p_rationale, '')), '') IS NULL THEN NULL
      ELSE format('Delegation note: %s', btrim(p_rationale))
    END
  );

  UPDATE public.qep_decisions
  SET status = 'answered'::public.qep_decision_status,
      answered_by = v_applied_by,
      answered_at = v_now,
      answered_option = v_decision.recommended_option,
      answered_rationale = v_answered_rationale,
      decision_class = v_class,
      ai_prep_packet = COALESCE(v_decision.ai_prep_packet, '{}'::jsonb) || jsonb_build_object(
        'brian_triage_approved_by', v_actor,
        'brian_triage_approved_at', v_now,
        'delegation_apply', jsonb_build_object(
          'policy_id', v_policy.id,
          'owner_role', v_decision.owner_role,
          'decision_class', v_class,
          'delegate_role', v_policy.delegate_role,
          'delegate_actor', v_policy.delegate_actor,
          'approved_option', v_decision.recommended_option,
          'applied_by', v_applied_by,
          'applied_at', v_now,
          'rationale', NULLIF(btrim(COALESCE(p_rationale, '')), '')
        )
      )
  WHERE id = v_decision.id;

  INSERT INTO public.qep_decision_delegation_audit (
    decision_id,
    decision_code,
    owner_role,
    decision_class,
    delegate_role,
    delegate_actor,
    policy_id,
    approved_option,
    approved_rationale,
    source_recommended_option,
    source_recommended_rationale,
    applied_by,
    applied_at,
    rationale,
    policy_snapshot
  )
  VALUES (
    v_decision.id,
    v_decision.code,
    v_decision.owner_role,
    v_class,
    v_policy.delegate_role,
    v_policy.delegate_actor,
    v_policy.id,
    v_decision.recommended_option,
    v_answered_rationale,
    v_decision.recommended_option,
    v_decision.recommended_rationale,
    v_applied_by,
    v_now,
    NULLIF(btrim(COALESCE(p_rationale, '')), ''),
    jsonb_build_object(
      'id', v_policy.id,
      'owner_role', v_policy.owner_role,
      'decision_class', v_policy.decision_class,
      'delegate_role', v_policy.delegate_role,
      'delegate_actor', v_policy.delegate_actor,
      'enabled', v_policy.enabled,
      'conditions', v_policy.conditions,
      'notes', v_policy.notes
    )
  )
  RETURNING * INTO v_audit;

  INSERT INTO public.qep_roadmap_sync_events
    (direction, task_id, action, changed_fields, actor)
  VALUES (
    'reconcile',
    NULL,
    'update',
    jsonb_build_object(
      'reason', 'delegated_recommendation_applied',
      'decision_code', v_decision.code,
      'owner_role', v_decision.owner_role,
      'decision_class', v_class,
      'delegate_actor', v_policy.delegate_actor,
      'policy_id', v_policy.id,
      'audit_id', v_audit.id,
      'approved_option', v_decision.recommended_option
    ),
    v_applied_by
  );

  RETURN jsonb_build_object(
    'decision_id', v_decision.id,
    'decision_code', v_decision.code,
    'owner_role', v_decision.owner_role,
    'decision_class', v_class,
    'policy_id', v_policy.id,
    'audit_id', v_audit.id,
    'status', 'answered',
    'approved_option', v_decision.recommended_option,
    'approved_by', v_actor,
    'applied_by', v_applied_by,
    'applied_at', v_now
  );
END;
$$;

INSERT INTO public.qep_decision_delegation_policies (
  owner_role,
  decision_class,
  delegate_role,
  delegate_actor,
  enabled,
  conditions,
  notes,
  created_by,
  updated_by
)
VALUES
  ('Rylee', 'copy_ux', 'brian', 'brian', true, '{}'::jsonb, 'Default from QEP V2 section 11: Brian may answer copy/UX decisions.', 'migration-621', 'migration-621'),
  ('Ryan', 'non_visual', 'brian', 'brian', true, '{}'::jsonb, 'Default from QEP V2 section 11: Brian may answer non-visual decisions.', 'migration-621', 'migration-621'),
  ('Ryan', 'visual', 'brian', 'brian', false, '{}'::jsonb, 'Default from QEP V2 section 11: visual decisions stay with Ryan.', 'migration-621', 'migration-621'),
  ('Angela', 'compliance_tila', 'brian', 'brian', false, '{}'::jsonb, 'Default from QEP V2 section 11: compliance/TILA never delegated.', 'migration-621', 'migration-621'),
  ('Norman', 'parts_pricing_mechanics', 'brian', 'brian', true, '{}'::jsonb, 'Default from QEP V2 section 11: mechanics delegated.', 'migration-621', 'migration-621'),
  ('Norman', 'pricing_policy', 'brian', 'brian', false, '{}'::jsonb, 'Default from QEP V2 section 11: pricing policy not delegated.', 'migration-621', 'migration-621'),
  ('Tina', 'accounting_mechanics', 'brian', 'brian', true, '{}'::jsonb, 'Default from QEP V2 section 11: accounting mechanics delegated.', 'migration-621', 'migration-621'),
  ('Tina', 'closed_period_policy', 'brian', 'brian', false, '{}'::jsonb, 'Default from QEP V2 section 11: closed-period policy not delegated.', 'migration-621', 'migration-621')
ON CONFLICT (owner_role, decision_class, delegate_actor)
DO UPDATE SET
  delegate_role = EXCLUDED.delegate_role,
  enabled = EXCLUDED.enabled,
  conditions = EXCLUDED.conditions,
  notes = EXCLUDED.notes,
  updated_by = EXCLUDED.updated_by,
  updated_at = now();

ALTER TABLE public.qep_decision_delegation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qep_decision_delegation_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qep_decision_delegation_policies_service_role_all ON public.qep_decision_delegation_policies;
CREATE POLICY qep_decision_delegation_policies_service_role_all
  ON public.qep_decision_delegation_policies
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS qep_decision_delegation_policies_authenticated_read ON public.qep_decision_delegation_policies;
CREATE POLICY qep_decision_delegation_policies_authenticated_read
  ON public.qep_decision_delegation_policies
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS qep_decision_delegation_policies_authenticated_write ON public.qep_decision_delegation_policies;
CREATE POLICY qep_decision_delegation_policies_authenticated_write
  ON public.qep_decision_delegation_policies
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager', 'owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'manager', 'owner'));

DROP POLICY IF EXISTS qep_decision_delegation_audit_service_role_all ON public.qep_decision_delegation_audit;
CREATE POLICY qep_decision_delegation_audit_service_role_all
  ON public.qep_decision_delegation_audit
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS qep_decision_delegation_audit_authenticated_read ON public.qep_decision_delegation_audit;
CREATE POLICY qep_decision_delegation_audit_authenticated_read
  ON public.qep_decision_delegation_audit
  FOR SELECT TO authenticated
  USING (true);

REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_delegation_policies_touch_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_delegation_policies_touch_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_delegation_policies_touch_updated_at() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_classify(text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_classify(text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_qep_decision_classify(text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_qep_decision_classify(text, text, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_qep_delegated_recommendation(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_qep_delegated_recommendation(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_qep_delegated_recommendation(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_qep_delegated_recommendation(text, text, text, text) TO service_role;

COMMENT ON TABLE public.qep_decision_delegation_policies IS
  'Per-owner, per-decision-class delegation toggles used by delegated recommendation application.';

COMMENT ON TABLE public.qep_decision_delegation_audit IS
  'Immutable audit evidence for delegated recommendation applications (owner, class, policy source, approved recommendation, timestamp, rationale).';

COMMENT ON FUNCTION public.apply_qep_delegated_recommendation(text, text, text, text) IS
  'QEP-161/F4.3: applies recommended_option as answered only when an enabled owner/class delegation policy exists for delegate actor, and writes delegation audit evidence.';

COMMIT;
