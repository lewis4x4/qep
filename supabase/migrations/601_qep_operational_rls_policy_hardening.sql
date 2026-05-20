-- Harden QEP operational control table updates for environments where the
-- original roadmap/decision migrations were already applied with broad
-- authenticated UPDATE policies.

DROP POLICY IF EXISTS qep_roadmap_tasks_authenticated_update ON public.qep_roadmap_tasks;
CREATE POLICY qep_roadmap_tasks_authenticated_update ON public.qep_roadmap_tasks
  FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager', 'owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'manager', 'owner'));

DROP POLICY IF EXISTS qep_decisions_authenticated_update ON public.qep_decisions;
CREATE POLICY qep_decisions_authenticated_update ON public.qep_decisions
  FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager', 'owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'manager', 'owner'));
