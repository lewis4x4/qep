-- ============================================================================
-- Migration 625: QEP Tier 1.5 Command Center snapshot SECURITY DEFINER
--
-- Converts cc_export_snapshot() to run under the narrow cc_contract_owner role
-- created by Tier 1. Keeps command_center on EXECUTE-only federation access.
--
-- Note: v_qep_roadmap_sync_health reads qep_roadmap_sync_events underneath,
-- and all three source tables are RLS-enabled. The NOLOGIN definer role needs
-- SELECT grants plus SELECT RLS policies so the SECURITY DEFINER snapshot sees
-- real data rather than RLS-filtered zero counts.
-- ============================================================================

BEGIN;

-- The QEP remote migration path runs as postgres. Regranting is idempotent and
-- satisfies ALTER FUNCTION ... OWNER TO cc_contract_owner.
GRANT cc_contract_owner TO postgres;

GRANT SELECT ON public.qep_roadmap_tasks         TO cc_contract_owner;
GRANT SELECT ON public.qep_decisions             TO cc_contract_owner;
GRANT SELECT ON public.qep_roadmap_sync_events   TO cc_contract_owner;
GRANT SELECT ON public.v_qep_roadmap_sync_health TO cc_contract_owner;

DROP POLICY IF EXISTS qep_roadmap_tasks_cc_contract_owner_read ON public.qep_roadmap_tasks;
CREATE POLICY qep_roadmap_tasks_cc_contract_owner_read
  ON public.qep_roadmap_tasks
  FOR SELECT
  TO cc_contract_owner
  USING (true);

DROP POLICY IF EXISTS qep_decisions_cc_contract_owner_read ON public.qep_decisions;
CREATE POLICY qep_decisions_cc_contract_owner_read
  ON public.qep_decisions
  FOR SELECT
  TO cc_contract_owner
  USING (true);

DROP POLICY IF EXISTS qep_roadmap_sync_events_cc_contract_owner_read ON public.qep_roadmap_sync_events;
CREATE POLICY qep_roadmap_sync_events_cc_contract_owner_read
  ON public.qep_roadmap_sync_events
  FOR SELECT
  TO cc_contract_owner
  USING (true);

-- PostgreSQL requires the target owner to hold CREATE on the containing schema
-- during ownership transfer. Keep the grant temporary.
GRANT CREATE ON SCHEMA public TO cc_contract_owner;
ALTER FUNCTION public.cc_export_snapshot() OWNER TO cc_contract_owner;
ALTER FUNCTION public.cc_export_snapshot() SECURITY DEFINER;
REVOKE CREATE ON SCHEMA public FROM cc_contract_owner;

REVOKE EXECUTE ON FUNCTION public.cc_export_snapshot() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cc_export_snapshot() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cc_export_snapshot() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.cc_export_snapshot() TO command_center;

COMMIT;
