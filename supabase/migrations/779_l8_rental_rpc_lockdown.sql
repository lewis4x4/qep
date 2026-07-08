-- ============================================================================
-- 779 — L8 hardening: rental RPC workspace lockdown + grant hygiene
--
-- The L8 cross-workspace leak audit found two classes of exposure:
--
--   1. SECURITY DEFINER RPCs that trust a client-supplied p_workspace_id
--      (utilization, availability, rates, yield, disposal) or a bare entity
--      id (rental_resolve_context) — any authenticated JWT could read another
--      workspace's fleet economics, and rental_yield_suggestions(p_write=>true)
--      was a cross-workspace WRITE vector for rate-rule drafts.
--   2. Default-privilege EXECUTE grants leaking PUBLIC/anon/authenticated
--      access to internal trigger/cron functions (scans, emitters, guards).
--
-- Fix shape:
--   * rental_assert_workspace(): raises 42501 unless the caller's JWT is
--     service_role / absent (direct DB connections: cron, migrations) or
--     p_workspace_id matches get_my_workspace().
--   * Each exposed RPC is renamed to *_impl (body untouched — no
--     transcription drift), stripped of caller grants, and fronted by a
--     SECURITY DEFINER wrapper with the original name/signature/defaults
--     that asserts before delegating. resolve_context asserts on the
--     contract's own workspace.
--   * Internal trigger/cron functions lose PUBLIC/anon/authenticated
--     EXECUTE (triggers fire regardless; pg_cron runs as owner).
--
-- NOTE for future migrations: this project's default privileges grant
-- EXECUTE to anon/authenticated on new functions — REVOKE explicitly on
-- every non-public-facing function you create.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Workspace assertion helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_assert_workspace(p_workspace_id text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role text := (select auth.role());
BEGIN
  -- No JWT role => direct DB connection (cron, migrations, SQL editor):
  -- trusted. PostgREST always stamps anon/authenticated/service_role.
  IF v_jwt_role IS NULL OR v_jwt_role = 'service_role' THEN
    RETURN;
  END IF;
  IF p_workspace_id IS DISTINCT FROM (select public.get_my_workspace()) THEN
    RAISE EXCEPTION 'workspace_denied' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_assert_workspace(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_assert_workspace(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Rename exposed RPCs to *_impl (idempotent), strip caller grants
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public.rental_compute_utilization_impl(text)') IS NULL THEN
    ALTER FUNCTION public.rental_compute_utilization(text) RENAME TO rental_compute_utilization_impl;
  END IF;
  IF to_regprocedure('public.rental_check_availability_impl(text, date, date, uuid, text)') IS NULL THEN
    ALTER FUNCTION public.rental_check_availability(text, date, date, uuid, text) RENAME TO rental_check_availability_impl;
  END IF;
  IF to_regprocedure('public.rental_availability_calendar_impl(text, date, date, uuid)') IS NULL THEN
    ALTER FUNCTION public.rental_availability_calendar(text, date, date, uuid) RENAME TO rental_availability_calendar_impl;
  END IF;
  IF to_regprocedure('public.rental_resolve_rates_impl(text, uuid, uuid, text, text, text, uuid, date)') IS NULL THEN
    ALTER FUNCTION public.rental_resolve_rates(text, uuid, uuid, text, text, text, uuid, date) RENAME TO rental_resolve_rates_impl;
  END IF;
  IF to_regprocedure('public.rental_yield_suggestions_impl(text, boolean)') IS NULL THEN
    ALTER FUNCTION public.rental_yield_suggestions(text, boolean) RENAME TO rental_yield_suggestions_impl;
  END IF;
  IF to_regprocedure('public.rental_disposal_signals_impl(text)') IS NULL THEN
    ALTER FUNCTION public.rental_disposal_signals(text) RENAME TO rental_disposal_signals_impl;
  END IF;
  IF to_regprocedure('public.rental_resolve_context_impl(uuid)') IS NULL THEN
    ALTER FUNCTION public.rental_resolve_context(uuid) RENAME TO rental_resolve_context_impl;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.rental_compute_utilization_impl(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rental_check_availability_impl(text, date, date, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rental_availability_calendar_impl(text, date, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rental_resolve_rates_impl(text, uuid, uuid, text, text, text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rental_yield_suggestions_impl(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rental_disposal_signals_impl(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rental_resolve_context_impl(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Guarded wrappers (original names/signatures/defaults/volatility)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_compute_utilization(p_workspace_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.rental_assert_workspace(p_workspace_id);
  RETURN public.rental_compute_utilization_impl(p_workspace_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_check_availability(
  p_workspace_id text, p_start date, p_end date,
  p_equipment_id uuid DEFAULT NULL, p_category text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.rental_assert_workspace(p_workspace_id);
  RETURN public.rental_check_availability_impl(p_workspace_id, p_start, p_end, p_equipment_id, p_category);
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_availability_calendar(
  p_workspace_id text, p_from date, p_to date, p_equipment_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.rental_assert_workspace(p_workspace_id);
  RETURN public.rental_availability_calendar_impl(p_workspace_id, p_from, p_to, p_equipment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_resolve_rates(
  p_workspace_id text, p_equipment_id uuid DEFAULT NULL, p_company_id uuid DEFAULT NULL,
  p_equipment_class text DEFAULT NULL, p_equipment_subclass text DEFAULT NULL,
  p_category text DEFAULT NULL, p_branch_id uuid DEFAULT NULL, p_on_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.rental_assert_workspace(p_workspace_id);
  RETURN public.rental_resolve_rates_impl(p_workspace_id, p_equipment_id, p_company_id,
    p_equipment_class, p_equipment_subclass, p_category, p_branch_id, p_on_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_yield_suggestions(
  p_workspace_id text, p_write boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.rental_assert_workspace(p_workspace_id);
  RETURN public.rental_yield_suggestions_impl(p_workspace_id, p_write);
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_disposal_signals(p_workspace_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.rental_assert_workspace(p_workspace_id);
  RETURN public.rental_disposal_signals_impl(p_workspace_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_resolve_context(p_contract_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_workspace text;
BEGIN
  SELECT c.workspace_id INTO v_workspace
  FROM public.rental_contracts c
  WHERE c.id = p_contract_id AND c.deleted_at IS NULL;
  IF v_workspace IS NULL THEN
    RETURN NULL; -- preserve impl behavior for missing contracts
  END IF;
  PERFORM public.rental_assert_workspace(v_workspace);
  RETURN public.rental_resolve_context_impl(p_contract_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_compute_utilization(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rental_check_availability(text, date, date, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rental_availability_calendar(text, date, date, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rental_resolve_rates(text, uuid, uuid, text, text, text, uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rental_yield_suggestions(text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rental_disposal_signals(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rental_resolve_context(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rental_compute_utilization(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rental_check_availability(text, date, date, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rental_availability_calendar(text, date, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rental_resolve_rates(text, uuid, uuid, text, text, text, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rental_yield_suggestions(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rental_disposal_signals(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rental_resolve_context(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Grant hygiene: internal trigger/cron/sequence functions are not caller API
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'rental_accrue_rpo_credit', 'rental_apply_line_rollup',
        'rental_assign_contract_number', 'rental_contract_close_billing_gate',
        'rental_contract_guard_close_check', 'rental_contract_guard_transition',
        'rental_contract_rollup_lifecycle', 'rental_contract_sync_status',
        'rental_emit_contract_events', 'rental_emit_invoice_events',
        'rental_emit_line_events', 'rental_emit_return_events',
        'rental_forecast_demand', 'rental_geofence_exit_guard',
        'rental_h10_down_for_service', 'rental_holds_fleet_state',
        'rental_intelligence_scan', 'rental_lifecycle_scan',
        'rental_maintain_reservation_holds', 'rental_recompute_equipment_fleet_state',
        'rental_snapshot_utilization', 'rental_sync_equipment_fleet_state',
        'rental_telematics_overage_check', 'next_rental_invoice_number'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  -- Pure math (SECURITY INVOKER, no table access): keep authenticated, drop anon/PUBLIC.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('rental_optimize_charge', 'rental_reconcile_final_invoice')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

COMMIT;
