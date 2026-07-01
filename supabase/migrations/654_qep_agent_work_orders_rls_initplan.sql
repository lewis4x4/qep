-- Re-apply the RLS init-plan optimized read policy for qep_agent_work_orders.
-- Migration 652 originally created qep_agent_work_orders_authenticated_read with
-- raw public.get_my_role() and auth.uid() calls, which Postgres re-evaluates per
-- row. 652 is already applied to live databases, so editing it in place does not
-- reach them; this corrective migration DROPs and re-CREATEs the policy with the
-- wrapped scalar subselect forms so the helpers evaluate once per query.

BEGIN;

DROP POLICY IF EXISTS qep_agent_work_orders_authenticated_read ON public.qep_agent_work_orders;
CREATE POLICY qep_agent_work_orders_authenticated_read ON public.qep_agent_work_orders
  FOR SELECT TO authenticated
  USING (
    (select public.get_my_role()) IN ('admin', 'manager', 'owner')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (select auth.uid()) AND p.is_agent_service_account = true)
  );

COMMIT;
