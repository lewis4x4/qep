-- ============================================================================
-- Migration 619: AUTHORIZE-lane two-party signature flow (QEP-145 / F3.3)
-- Purpose: add AUTHORIZE decision signature ledger + signing RPC that only
--          resolves decisions after all required signer roles have signed.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qep_decision_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.qep_decisions(id) ON DELETE CASCADE,
  signer_role text NOT NULL,
  signer_name text NOT NULL,
  signer_email text,
  signature_data_url text NOT NULL,
  signature_hash text NOT NULL,
  terms_accepted boolean NOT NULL DEFAULT true,
  terms_version text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qep_decision_authorizations_signer_role_ck CHECK (length(trim(signer_role)) > 0),
  CONSTRAINT qep_decision_authorizations_signer_name_ck CHECK (length(trim(signer_name)) > 0),
  CONSTRAINT qep_decision_authorizations_terms_ck CHECK (terms_accepted = true),
  CONSTRAINT qep_decision_authorizations_signature_data_url_ck CHECK (position('data:image/' in lower(signature_data_url)) = 1)
);

CREATE INDEX IF NOT EXISTS qep_decision_authorizations_decision_idx
  ON public.qep_decision_authorizations (decision_id, signed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS qep_decision_authorizations_active_role_uniq
  ON public.qep_decision_authorizations (decision_id, signer_role)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_qep_decision_authorizations_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qep_decision_authorizations_touch_updated_at ON public.qep_decision_authorizations;
CREATE TRIGGER qep_decision_authorizations_touch_updated_at
  BEFORE UPDATE ON public.qep_decision_authorizations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_decision_authorizations_touch_updated_at();

CREATE OR REPLACE FUNCTION public.record_qep_authorize_signature(
  p_decision_code text,
  p_signer_role text,
  p_signer_name text,
  p_signer_email text,
  p_signature_data_url text,
  p_terms_accepted boolean,
  p_terms_version text,
  p_actor text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision public.qep_decisions%ROWTYPE;
  v_now timestamptz := now();
  v_signer_role text;
  v_required_signers text[];
  v_signed_roles text[];
  v_missing_roles text[];
  v_signature public.qep_decision_authorizations%ROWTYPE;
  v_actor text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND public.get_my_role() NOT IN ('admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_decision_code IS NULL OR btrim(p_decision_code) = '' THEN
    RAISE EXCEPTION 'decision_code is required';
  END IF;

  IF p_signer_role IS NULL OR btrim(p_signer_role) = '' THEN
    RAISE EXCEPTION 'signer_role is required';
  END IF;

  IF p_signer_name IS NULL OR btrim(p_signer_name) = '' THEN
    RAISE EXCEPTION 'signer_name is required';
  END IF;

  IF p_signature_data_url IS NULL OR btrim(p_signature_data_url) = '' THEN
    RAISE EXCEPTION 'signature_data_url is required';
  END IF;

  IF p_terms_accepted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'terms_accepted must be true';
  END IF;

  IF p_terms_version IS NULL OR btrim(p_terms_version) = '' THEN
    RAISE EXCEPTION 'terms_version is required';
  END IF;

  SELECT *
  INTO v_decision
  FROM public.qep_decisions
  WHERE code = p_decision_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decision % not found', p_decision_code;
  END IF;

  IF v_decision.lane <> 'authorize'::public.qep_decision_lane THEN
    RAISE EXCEPTION 'decision % is not AUTHORIZE lane', p_decision_code;
  END IF;

  IF v_decision.status::text NOT IN ('open', 'escalated', 'shadow_ship') THEN
    RAISE EXCEPTION 'decision % status % does not accept signatures', p_decision_code, v_decision.status;
  END IF;

  v_required_signers := COALESCE(
    (
      SELECT array_agg(DISTINCT role_value ORDER BY role_value)
      FROM (
        SELECT NULLIF(btrim(role_entry), '') AS role_value
        FROM unnest(COALESCE(v_decision.requires_two_sigs, ARRAY[]::text[])) AS role_entry
      ) roles
      WHERE role_value IS NOT NULL
    ),
    ARRAY[]::text[]
  );

  IF COALESCE(array_length(v_required_signers, 1), 0) = 0 THEN
    v_required_signers := ARRAY[NULLIF(btrim(v_decision.owner_role), '')];
  END IF;

  v_required_signers := ARRAY(
    SELECT DISTINCT role_value
    FROM unnest(v_required_signers) AS role_value
    WHERE role_value IS NOT NULL
    ORDER BY role_value
  );

  IF COALESCE(array_length(v_required_signers, 1), 0) = 0 THEN
    RAISE EXCEPTION 'decision % has no required signer roles configured', p_decision_code;
  END IF;

  v_signer_role := btrim(p_signer_role);

  IF NOT (v_signer_role = ANY(v_required_signers)) THEN
    RAISE EXCEPTION 'signer_role % is not required for decision %', v_signer_role, p_decision_code;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.qep_decision_authorizations a
    WHERE a.decision_id = v_decision.id
      AND a.signer_role = v_signer_role
      AND a.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'signer_role % already signed decision %', v_signer_role, p_decision_code;
  END IF;

  INSERT INTO public.qep_decision_authorizations (
    decision_id,
    signer_role,
    signer_name,
    signer_email,
    signature_data_url,
    signature_hash,
    terms_accepted,
    terms_version,
    signed_at,
    metadata
  )
  VALUES (
    v_decision.id,
    v_signer_role,
    btrim(p_signer_name),
    NULLIF(btrim(COALESCE(p_signer_email, '')), ''),
    btrim(p_signature_data_url),
    encode(extensions.digest(convert_to(btrim(p_signature_data_url), 'UTF8'), 'sha256'), 'hex'),
    true,
    btrim(p_terms_version),
    v_now,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_signature;

  SELECT COALESCE(array_agg(DISTINCT a.signer_role ORDER BY a.signer_role), ARRAY[]::text[])
  INTO v_signed_roles
  FROM public.qep_decision_authorizations a
  WHERE a.decision_id = v_decision.id
    AND a.revoked_at IS NULL;

  SELECT COALESCE(array_agg(req.role ORDER BY req.role), ARRAY[]::text[])
  INTO v_missing_roles
  FROM unnest(v_required_signers) AS req(role)
  WHERE NOT (req.role = ANY(v_signed_roles));

  IF COALESCE(array_length(v_missing_roles, 1), 0) = 0 THEN
    v_actor := COALESCE(NULLIF(btrim(p_actor), ''), 'authorize-signature-flow');

    UPDATE public.qep_decisions
    SET status = 'answered'::public.qep_decision_status,
        answered_by = v_actor,
        answered_at = v_now,
        answered_option = COALESCE(answered_option, recommended_option, 'authorize_signed'),
        answered_rationale = format(
          'AUTHORIZE signatures complete. Required signer roles: %s. Signed roles: %s.',
          array_to_string(v_required_signers, ', '),
          array_to_string(v_signed_roles, ', ')
        ),
        ai_prep_packet = COALESCE(ai_prep_packet, '{}'::jsonb) || jsonb_build_object(
          'authorize_signature_status',
          jsonb_build_object(
            'required_signers', to_jsonb(v_required_signers),
            'signed_roles', to_jsonb(v_signed_roles),
            'completed_at', v_now
          )
        )
    WHERE id = v_decision.id;
  END IF;

  RETURN jsonb_build_object(
    'authorization_id', v_signature.id,
    'decision_id', v_decision.id,
    'decision_code', v_decision.code,
    'required_signers', to_jsonb(v_required_signers),
    'signed_roles', to_jsonb(v_signed_roles),
    'missing_roles', to_jsonb(v_missing_roles),
    'complete', COALESCE(array_length(v_missing_roles, 1), 0) = 0,
    'decision_status', CASE
      WHEN COALESCE(array_length(v_missing_roles, 1), 0) = 0 THEN 'answered'
      ELSE v_decision.status::text
    END,
    'signed_at', v_signature.signed_at
  );
END;
$$;

CREATE OR REPLACE VIEW public.v_qep_decision_authorize_signature_status AS
SELECT
  d.id AS decision_id,
  d.code AS decision_code,
  d.status,
  COALESCE(required.required_signers, ARRAY[]::text[]) AS required_signers,
  COALESCE(signed.signed_roles, ARRAY[]::text[]) AS signed_roles,
  COALESCE(
    (
      SELECT array_agg(req.role ORDER BY req.role)
      FROM unnest(COALESCE(required.required_signers, ARRAY[]::text[])) AS req(role)
      WHERE NOT (req.role = ANY(COALESCE(signed.signed_roles, ARRAY[]::text[])))
    ),
    ARRAY[]::text[]
  ) AS missing_roles,
  COALESCE(array_length(COALESCE(required.required_signers, ARRAY[]::text[]), 1), 0) > 0
    AND COALESCE(
      (
        SELECT count(*)
        FROM unnest(COALESCE(required.required_signers, ARRAY[]::text[])) AS req(role)
        WHERE req.role = ANY(COALESCE(signed.signed_roles, ARRAY[]::text[]))
      ),
      0
    ) = COALESCE(array_length(COALESCE(required.required_signers, ARRAY[]::text[]), 1), 0) AS complete,
  d.answered_by,
  d.answered_at,
  d.updated_at
FROM public.qep_decisions d
LEFT JOIN LATERAL (
  SELECT
    COALESCE(
      (
        SELECT array_agg(DISTINCT role_value ORDER BY role_value)
        FROM (
          SELECT NULLIF(btrim(role_entry), '') AS role_value
          FROM unnest(COALESCE(d.requires_two_sigs, ARRAY[]::text[])) AS role_entry
        ) roles
        WHERE role_value IS NOT NULL
      ),
      CASE WHEN NULLIF(btrim(d.owner_role), '') IS NULL THEN ARRAY[]::text[] ELSE ARRAY[NULLIF(btrim(d.owner_role), '')] END
    ) AS required_signers
) required ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(array_agg(DISTINCT a.signer_role ORDER BY a.signer_role), ARRAY[]::text[]) AS signed_roles
  FROM public.qep_decision_authorizations a
  WHERE a.decision_id = d.id
    AND a.revoked_at IS NULL
) signed ON true
WHERE d.lane = 'authorize'::public.qep_decision_lane;

ALTER TABLE public.qep_decision_authorizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qep_decision_authorizations_service_role_all ON public.qep_decision_authorizations;
CREATE POLICY qep_decision_authorizations_service_role_all
  ON public.qep_decision_authorizations
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS qep_decision_authorizations_authenticated_read ON public.qep_decision_authorizations;
CREATE POLICY qep_decision_authorizations_authenticated_read
  ON public.qep_decision_authorizations
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS qep_decision_authorizations_authenticated_insert ON public.qep_decision_authorizations;
-- Inserts intentionally flow through record_qep_authorize_signature so lane,
-- signer-role, duplicate-signature, and completion guards cannot be bypassed.

REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_authorizations_touch_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_authorizations_touch_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_qep_decision_authorizations_touch_updated_at() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.record_qep_authorize_signature(text, text, text, text, text, boolean, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_qep_authorize_signature(text, text, text, text, text, boolean, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_qep_authorize_signature(text, text, text, text, text, boolean, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_qep_authorize_signature(text, text, text, text, text, boolean, text, text, jsonb) TO service_role;

COMMENT ON TABLE public.qep_decision_authorizations IS
  'Ledger of AUTHORIZE-lane e-signatures. One active signature per signer_role per decision until revoked.';

COMMENT ON FUNCTION public.record_qep_authorize_signature(text, text, text, text, text, boolean, text, text, jsonb) IS
  'QEP-145/F3.3: records one AUTHORIZE signature using A3.5 data-url conventions and resolves the decision only after all required signer roles have signed.';

COMMENT ON VIEW public.v_qep_decision_authorize_signature_status IS
  'AUTHORIZE decision signing status: required_signers, signed_roles, missing_roles, and completion state.';

COMMIT;
