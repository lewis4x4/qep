-- ============================================================================
-- Migration 626: clear the Supabase security-advisor findings on QEP roadmap
--                and decision objects.
-- Target: QEP Supabase project (iciddijgonywtxoelous)
--
-- The security advisor (run after migration 599) flagged, on objects created
-- by migrations 593 / 595:
--   - 3 ERROR  security_definer_view       — the 3 v_qep_* views
--   - 6 WARN   function_search_path_mutable — the 6 fn_qep_* / *_qep helpers
--
-- This migration fixes only QEP-roadmap-owned objects. It does not touch the
-- 168 QEP business tables or the ~466 project-wide function-executable WARNs;
-- those belong to the broader QEP security pass (Command Center Wave 1).
--
-- View fix: security_invoker = on makes each view run with the QUERYING user's
-- permissions, so RLS on the base tables is enforced through the view. No
-- behavior change today (base tables still allow authenticated reads) — but it
-- means these views automatically respect base-table RLS once that is tightened.
--
-- Function fix: pinning search_path removes the role-mutable search_path. All
-- six function bodies reference tables/types as public.* already, so a pinned
-- path of 'public' is both safe and sufficient.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Views — enforce caller RLS (clears 3 ERROR security_definer_view)
-- ----------------------------------------------------------------------------
ALTER VIEW public.v_qep_roadmap_tasks_pending_linear_sync SET (security_invoker = on);
ALTER VIEW public.v_qep_decisions_owner_inbox             SET (security_invoker = on);
ALTER VIEW public.v_qep_roadmap_sync_health               SET (security_invoker = on);

-- ----------------------------------------------------------------------------
-- 2. Functions — pin search_path (clears 6 WARN function_search_path_mutable)
--    DO-block resolves each function's full signature automatically so the
--    ALTER cannot fail on an argument-type mismatch.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'log_qep_roadmap_sync_event',
        'fn_qep_roadmap_tasks_mark_linear_pending',
        'fn_qep_roadmap_tasks_touch_updated_at',
        'sync_status_from_linear_qep',
        'fn_qep_decision_resolved_promote_tasks',
        'fn_qep_decisions_touch_updated_at'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END$$;

COMMIT;

-- ============================================================================
-- Down migration (commented; copy/paste to revert)
-- ============================================================================
-- BEGIN;
--   ALTER VIEW public.v_qep_roadmap_tasks_pending_linear_sync RESET (security_invoker);
--   ALTER VIEW public.v_qep_decisions_owner_inbox             RESET (security_invoker);
--   ALTER VIEW public.v_qep_roadmap_sync_health               RESET (security_invoker);
--   -- ALTER FUNCTION ... RESET search_path; for each of the 6 functions.
-- COMMIT;
