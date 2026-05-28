-- ============================================================================
-- Migration 624: cc_export_snapshot() — the Command Center read contract
-- Target: QEP Supabase project (iciddijgonywtxoelous)
--
-- Renumbered from 602/608 -> 624: the repo already carries
-- 602_v_margin_exceptions.sql and 608_qep_decision_supersession_watcher.sql.
--
-- The BlackRock AI Command Center is federated: a control plane aggregates
-- progress by POLLING each client app, never by cross-database joins. Every
-- client app exposes one standard function — cc_export_snapshot() — that
-- returns its roadmap / decision / sync state as a single JSON blob.
--
-- The control plane's Aggregator calls this via PostgREST RPC using a scoped
-- key. SECURITY INVOKER + service_role-only EXECUTE keeps it off the
-- anon/authenticated attack surface.
--
-- contract_version is 1. If this shape ever changes, bump it and the control
-- plane's registry_app_supabase.snapshot_contract_version in lockstep.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cc_export_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'contract_version', 1,
    'captured_at',      now(),
    'roadmap_total',    (SELECT count(*) FROM public.qep_roadmap_tasks),
    'roadmap_counts',   COALESCE(
      (SELECT jsonb_object_agg(ship_state, n)
       FROM (SELECT ship_state::text AS ship_state, count(*) AS n
             FROM public.qep_roadmap_tasks GROUP BY ship_state) r),
      '{}'::jsonb),
    'decision_total',   (SELECT count(*) FROM public.qep_decisions),
    'decision_counts',  COALESCE(
      (SELECT jsonb_object_agg(status, n)
       FROM (SELECT status::text AS status, count(*) AS n
             FROM public.qep_decisions GROUP BY status) d),
      '{}'::jsonb),
    'sync_health',      (SELECT to_jsonb(h) FROM public.v_qep_roadmap_sync_health h),
    'build_status',     CASE
      WHEN (SELECT error_count        FROM public.v_qep_roadmap_sync_health) > 0 THEN 'red'
      WHEN (SELECT stale_pending_count FROM public.v_qep_roadmap_sync_health) > 0 THEN 'yellow'
      ELSE 'green'
    END
  );
$fn$;

COMMENT ON FUNCTION public.cc_export_snapshot() IS
  'Command Center read contract v1. Returns this app roadmap/decision/sync state as JSON. Called by the control-plane Aggregator. service_role EXECUTE only.';

REVOKE EXECUTE ON FUNCTION public.cc_export_snapshot() FROM public;
GRANT  EXECUTE ON FUNCTION public.cc_export_snapshot() TO service_role;

COMMIT;

-- ============================================================================
-- Down migration (commented)
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.cc_export_snapshot();
