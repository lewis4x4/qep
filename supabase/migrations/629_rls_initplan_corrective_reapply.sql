-- Re-apply the final RLS init-plan optimized policy definitions from 47b8b211.
-- The original optimization edited already-applied migrations in place, so live
-- databases need this corrective migration to receive the wrapped scalar
-- subselect forms.

BEGIN;

DROP POLICY IF EXISTS qep_roadmap_tasks_authenticated_update ON public.qep_roadmap_tasks;
CREATE POLICY qep_roadmap_tasks_authenticated_update ON public.qep_roadmap_tasks
  FOR UPDATE TO authenticated
  USING ((select public.get_my_role()) IN ('admin', 'manager', 'owner'))
  WITH CHECK ((select public.get_my_role()) IN ('admin', 'manager', 'owner'));

DROP POLICY IF EXISTS qep_decisions_authenticated_update ON public.qep_decisions;
CREATE POLICY qep_decisions_authenticated_update ON public.qep_decisions
  FOR UPDATE TO authenticated
  USING ((select public.get_my_role()) IN ('admin', 'manager', 'owner'))
  WITH CHECK ((select public.get_my_role()) IN ('admin', 'manager', 'owner'));

DROP POLICY IF EXISTS "qcf_service_all" ON public.quote_customer_feedback;
CREATE POLICY "qcf_service_all" ON public.quote_customer_feedback FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "qcf_staff_select_workspace" ON public.quote_customer_feedback;
CREATE POLICY "qcf_staff_select_workspace" ON public.quote_customer_feedback FOR SELECT
  USING (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN ('rep', 'admin', 'manager', 'owner')
  );

DROP POLICY IF EXISTS "voice_capture_stream_sessions_select" ON public.voice_capture_stream_sessions;
CREATE POLICY "voice_capture_stream_sessions_select"
  ON public.voice_capture_stream_sessions
  FOR SELECT
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (select auth.uid())
        AND p.role IN ('admin', 'manager', 'owner')
        AND coalesce(p.active_workspace_id, 'default') = voice_capture_stream_sessions.workspace_id
    )
  );

DROP POLICY IF EXISTS "voice_capture_stream_sessions_service_all" ON public.voice_capture_stream_sessions;
CREATE POLICY "voice_capture_stream_sessions_service_all"
  ON public.voice_capture_stream_sessions
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "voice_capture_stream_chunks_select" ON public.voice_capture_stream_chunks;
CREATE POLICY "voice_capture_stream_chunks_select"
  ON public.voice_capture_stream_chunks
  FOR SELECT
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (select auth.uid())
        AND p.role IN ('admin', 'manager', 'owner')
        AND coalesce(p.active_workspace_id, 'default') = voice_capture_stream_chunks.workspace_id
    )
  );

DROP POLICY IF EXISTS "voice_capture_stream_chunks_service_all" ON public.voice_capture_stream_chunks;
CREATE POLICY "voice_capture_stream_chunks_service_all"
  ON public.voice_capture_stream_chunks
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "customer_invoice_signatures_internal" ON public.customer_invoice_signatures;
CREATE POLICY "customer_invoice_signatures_internal" ON public.customer_invoice_signatures FOR SELECT
  USING (workspace_id = (select public.get_my_workspace()) AND (select public.get_my_role()) IN ('rep', 'admin', 'manager', 'owner'));

DROP POLICY IF EXISTS "customer_invoice_signatures_service" ON public.customer_invoice_signatures;
CREATE POLICY "customer_invoice_signatures_service" ON public.customer_invoice_signatures FOR ALL
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "rental_contract_signatures_internal" ON public.rental_contract_signatures;
CREATE POLICY "rental_contract_signatures_internal" ON public.rental_contract_signatures FOR SELECT
  USING (workspace_id = (select public.get_my_workspace()) AND (select public.get_my_role()) IN ('rep', 'admin', 'manager', 'owner'));

DROP POLICY IF EXISTS "rental_contract_signatures_service" ON public.rental_contract_signatures;
CREATE POLICY "rental_contract_signatures_service" ON public.rental_contract_signatures FOR ALL
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "qb_price_change_events_service" ON public.qb_price_change_events;
CREATE POLICY "qb_price_change_events_service" ON public.qb_price_change_events
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "qb_price_change_items_service" ON public.qb_price_change_items;
CREATE POLICY "qb_price_change_items_service" ON public.qb_price_change_items
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "qb_quote_reprice_impacts_service" ON public.qb_quote_reprice_impacts;
CREATE POLICY "qb_quote_reprice_impacts_service" ON public.qb_quote_reprice_impacts
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "qb_quote_reprice_impact_lines_service" ON public.qb_quote_reprice_impact_lines;
CREATE POLICY "qb_quote_reprice_impact_lines_service" ON public.qb_quote_reprice_impact_lines
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "qb_quote_reprice_drafts_service" ON public.qb_quote_reprice_drafts;
CREATE POLICY "qb_quote_reprice_drafts_service" ON public.qb_quote_reprice_drafts
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "qb_price_change_events_elevated" ON public.qb_price_change_events;
CREATE POLICY "qb_price_change_events_elevated" ON public.qb_price_change_events
  FOR ALL
  USING (workspace_id = (select public.get_my_workspace()) AND (select public.get_my_role()) IN ('admin','manager','owner'))
  WITH CHECK (workspace_id = (select public.get_my_workspace()) AND (select public.get_my_role()) IN ('admin','manager','owner'));

DROP POLICY IF EXISTS "qb_price_change_items_elevated_select" ON public.qb_price_change_items;
CREATE POLICY "qb_price_change_items_elevated_select" ON public.qb_price_change_items
  FOR SELECT USING (workspace_id = (select public.get_my_workspace()) AND (select public.get_my_role()) IN ('admin','manager','owner'));

DROP POLICY IF EXISTS "qb_quote_reprice_impacts_select" ON public.qb_quote_reprice_impacts;
CREATE POLICY "qb_quote_reprice_impacts_select" ON public.qb_quote_reprice_impacts
  FOR SELECT USING (
    workspace_id = (select public.get_my_workspace())
    AND ((select public.get_my_role()) IN ('admin','manager','owner') OR assigned_rep_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "qb_quote_reprice_impacts_update" ON public.qb_quote_reprice_impacts;
CREATE POLICY "qb_quote_reprice_impacts_update" ON public.qb_quote_reprice_impacts
  FOR UPDATE USING (workspace_id = (select public.get_my_workspace()) AND (select public.get_my_role()) IN ('admin','manager','owner'))
  WITH CHECK (workspace_id = (select public.get_my_workspace()) AND (select public.get_my_role()) IN ('admin','manager','owner'));

DROP POLICY IF EXISTS "qb_quote_reprice_impact_lines_select" ON public.qb_quote_reprice_impact_lines;
CREATE POLICY "qb_quote_reprice_impact_lines_select" ON public.qb_quote_reprice_impact_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.qb_quote_reprice_impacts i
      WHERE i.id = qb_quote_reprice_impact_lines.impact_id
        AND i.workspace_id = (select public.get_my_workspace())
        AND ((select public.get_my_role()) IN ('admin','manager','owner') OR i.assigned_rep_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "qb_quote_reprice_drafts_select" ON public.qb_quote_reprice_drafts;
CREATE POLICY "qb_quote_reprice_drafts_select" ON public.qb_quote_reprice_drafts
  FOR SELECT USING (
    workspace_id = (select public.get_my_workspace())
    AND ((select public.get_my_role()) IN ('admin','manager','owner') OR created_by = (select auth.uid()))
  );

DROP POLICY IF EXISTS "qb_quote_reprice_drafts_insert_own" ON public.qb_quote_reprice_drafts;
CREATE POLICY "qb_quote_reprice_drafts_insert_own" ON public.qb_quote_reprice_drafts
  FOR INSERT WITH CHECK (workspace_id = (select public.get_my_workspace()) AND created_by = (select auth.uid()));

DROP POLICY IF EXISTS "qb_quote_reprice_drafts_update" ON public.qb_quote_reprice_drafts;
CREATE POLICY "qb_quote_reprice_drafts_update" ON public.qb_quote_reprice_drafts
  FOR UPDATE USING (
    workspace_id = (select public.get_my_workspace())
    AND ((select public.get_my_role()) IN ('admin','manager','owner') OR created_by = (select auth.uid()))
  ) WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND ((select public.get_my_role()) IN ('admin','manager','owner') OR created_by = (select auth.uid()))
  );

DROP POLICY IF EXISTS "oems_workspace_member_select" ON public.oems;
CREATE POLICY "oems_workspace_member_select"
  ON public.oems FOR SELECT
  USING (
    (select auth.uid()) IS NOT NULL
    AND workspace_id = (select public.get_my_workspace())
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS qep_shadow_ship_flags_authenticated_write ON public.qep_shadow_ship_flags;
CREATE POLICY qep_shadow_ship_flags_authenticated_write
  ON public.qep_shadow_ship_flags
  FOR INSERT TO authenticated
  WITH CHECK ((select public.get_my_role()) IN ('admin', 'manager', 'owner'));

DROP POLICY IF EXISTS qep_decision_delegation_policies_authenticated_write ON public.qep_decision_delegation_policies;
CREATE POLICY qep_decision_delegation_policies_authenticated_write
  ON public.qep_decision_delegation_policies
  FOR ALL TO authenticated
  USING ((select public.get_my_role()) IN ('admin', 'manager', 'owner'))
  WITH CHECK ((select public.get_my_role()) IN ('admin', 'manager', 'owner'));

DROP POLICY IF EXISTS qep_decision_audit_artifacts_authenticated_read ON public.qep_decision_audit_artifacts;
CREATE POLICY qep_decision_audit_artifacts_authenticated_read
  ON public.qep_decision_audit_artifacts
  FOR SELECT TO authenticated
  USING ((select public.get_my_role()) IN ('admin', 'manager', 'owner'));

COMMIT;
