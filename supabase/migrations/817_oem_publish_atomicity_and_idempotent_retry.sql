-- Migration 817: make OEM catalog publication/event persistence one transaction
-- and let successful apply/reversal retries resolve from immutable audit evidence.

begin;

CREATE OR REPLACE FUNCTION public.publish_and_persist_qb_oem_price_change_event(
  p_workspace_id text,
  p_brand_id uuid,
  p_price_sheet_id uuid,
  p_publish_group_id uuid,
  p_created_by uuid,
  p_source_metadata jsonb,
  p_effective_date date,
  p_quote_pricing_epoch bigint,
  p_materiality_rule jsonb,
  p_approval_policy jsonb,
  p_streams jsonb,
  p_auto_approve boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sheet public.qb_price_sheets%ROWTYPE;
  v_publish jsonb;
  v_event jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'publish_and_persist_qb_oem_price_change_event requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_workspace_id), '') IS NULL OR p_brand_id IS NULL
     OR p_price_sheet_id IS NULL OR p_publish_group_id IS NULL
     OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'workspace, brand, price sheet, publish group, and actor are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sheet
  FROM public.qb_price_sheets sheet
  WHERE sheet.id = p_price_sheet_id;
  IF NOT FOUND
     OR v_sheet.workspace_id IS DISTINCT FROM p_workspace_id
     OR v_sheet.brand_id IS DISTINCT FROM p_brand_id THEN
    RAISE EXCEPTION 'price sheet is outside the requested workspace/OEM scope'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize before the first catalog mutation. The persistence function takes
  -- the same transaction-scoped lock reentrantly and then validates that every
  -- pinned predecessor is still the active stream predecessor. Any conflict or
  -- persistence error therefore rolls the catalog publication back as well.
  PERFORM pg_advisory_xact_lock(
    hashtext('qb_oem_event:' || p_workspace_id),
    hashtext(p_brand_id::text)
  );

  v_publish := public.publish_qb_price_sheet_atomic(
    p_workspace_id,
    p_price_sheet_id,
    p_created_by,
    p_auto_approve
  );

  v_event := public.persist_qb_oem_price_change_event(
    p_workspace_id,
    p_brand_id,
    p_price_sheet_id,
    p_publish_group_id,
    p_created_by,
    p_source_metadata,
    p_effective_date,
    p_quote_pricing_epoch,
    p_materiality_rule,
    p_approval_policy,
    p_streams
  );

  RETURN v_event || jsonb_build_object('publish', v_publish);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_and_persist_qb_oem_price_change_event(
  text, uuid, uuid, uuid, uuid, jsonb, date, bigint, jsonb, jsonb, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_and_persist_qb_oem_price_change_event(
  text, uuid, uuid, uuid, uuid, jsonb, date, bigint, jsonb, jsonb, jsonb, boolean
) TO service_role;

-- Preserve the fully validated mutation implementations from migration 813,
-- but put a durable-audit retry check in front of mutable draft/event/assignment
-- validation. The legacy implementations are private implementation details.
ALTER FUNCTION public.apply_qb_oem_reprice_draft(text, uuid, uuid, text)
  RENAME TO apply_qb_oem_reprice_draft_v813;
REVOKE EXECUTE ON FUNCTION public.apply_qb_oem_reprice_draft_v813(
  text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_qb_oem_reprice_draft(
  p_workspace_id text,
  p_draft_id uuid,
  p_actor_id uuid,
  p_actor_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_workspace text;
  v_actor_db_role text;
  v_existing_audit public.qb_quote_reprice_audits%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'apply_qb_oem_reprice_draft requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_workspace_id), '') IS NULL
     OR p_draft_id IS NULL OR p_actor_id IS NULL
     OR p_actor_role NOT IN ('rep', 'admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'workspace, draft, actor, and supported role are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.active_workspace_id, profile.role::text
    INTO v_actor_workspace, v_actor_db_role
  FROM public.profiles profile
  WHERE profile.id = p_actor_id;
  IF NOT FOUND
     OR v_actor_workspace IS DISTINCT FROM p_workspace_id
     OR v_actor_db_role IS DISTINCT FROM p_actor_role THEN
    RAISE EXCEPTION 'actor identity, role, or workspace is not current'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing_audit
  FROM public.qb_quote_reprice_audits audit
  WHERE audit.workspace_id = p_workspace_id
    AND audit.draft_id = p_draft_id
    AND audit.action = 'apply';
  IF FOUND THEN
    IF p_actor_role = 'rep'
       AND v_existing_audit.actor_id IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'OEM reprice draft belongs to another rep'
        USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'action', 'apply',
      'audit_id', v_existing_audit.id,
      'quote_package_id', v_existing_audit.quote_package_id,
      'after_quote_version_id', v_existing_audit.after_quote_version_id,
      'after_version_number', v_existing_audit.after_version_number,
      'totals', v_existing_audit.after_totals,
      'commission_projection', v_existing_audit.commission_projection,
      'customer_communication', 'none'
    );
  END IF;

  RETURN public.apply_qb_oem_reprice_draft_v813(
    p_workspace_id, p_draft_id, p_actor_id, p_actor_role
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_qb_oem_reprice_draft(
  text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_qb_oem_reprice_draft(
  text, uuid, uuid, text
) TO service_role;

ALTER FUNCTION public.reverse_qb_oem_reprice_apply(text, uuid, uuid, text)
  RENAME TO reverse_qb_oem_reprice_apply_v813;
REVOKE EXECUTE ON FUNCTION public.reverse_qb_oem_reprice_apply_v813(
  text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_qb_oem_reprice_apply(
  p_workspace_id text,
  p_apply_audit_id uuid,
  p_actor_id uuid,
  p_actor_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_workspace text;
  v_actor_db_role text;
  v_existing_audit public.qb_quote_reprice_audits%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'reverse_qb_oem_reprice_apply requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_workspace_id), '') IS NULL
     OR p_apply_audit_id IS NULL OR p_actor_id IS NULL
     OR p_actor_role NOT IN ('rep', 'admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'workspace, apply audit, actor, and supported role are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.active_workspace_id, profile.role::text
    INTO v_actor_workspace, v_actor_db_role
  FROM public.profiles profile
  WHERE profile.id = p_actor_id;
  IF NOT FOUND
     OR v_actor_workspace IS DISTINCT FROM p_workspace_id
     OR v_actor_db_role IS DISTINCT FROM p_actor_role THEN
    RAISE EXCEPTION 'actor identity, role, or workspace is not current'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing_audit
  FROM public.qb_quote_reprice_audits audit
  WHERE audit.workspace_id = p_workspace_id
    AND audit.apply_audit_id = p_apply_audit_id
    AND audit.action = 'reverse';
  IF FOUND THEN
    IF p_actor_role = 'rep'
       AND v_existing_audit.actor_id IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'OEM reprice reversal belongs to another rep'
        USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'action', 'reverse',
      'audit_id', v_existing_audit.id,
      'apply_audit_id', p_apply_audit_id,
      'quote_package_id', v_existing_audit.quote_package_id,
      'after_quote_version_id', v_existing_audit.after_quote_version_id,
      'after_version_number', v_existing_audit.after_version_number,
      'totals', v_existing_audit.after_totals,
      'commission_projection', v_existing_audit.commission_projection,
      'customer_communication', 'none'
    );
  END IF;

  RETURN public.reverse_qb_oem_reprice_apply_v813(
    p_workspace_id, p_apply_audit_id, p_actor_id, p_actor_role
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_qb_oem_reprice_apply(
  text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_qb_oem_reprice_apply(
  text, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.publish_and_persist_qb_oem_price_change_event(
  text, uuid, uuid, uuid, uuid, jsonb, date, bigint, jsonb, jsonb, jsonb, boolean
) IS 'Publishes an OEM sheet and persists its quote-impact event in one brand-serialized transaction.';
COMMENT ON FUNCTION public.apply_qb_oem_reprice_draft(text, uuid, uuid, text)
  IS 'Idempotent public entrypoint; returns durable apply audit evidence before mutable-state validation.';
COMMENT ON FUNCTION public.reverse_qb_oem_reprice_apply(text, uuid, uuid, text)
  IS 'Idempotent public entrypoint; returns durable reversal audit evidence before mutable-state validation.';

commit;
