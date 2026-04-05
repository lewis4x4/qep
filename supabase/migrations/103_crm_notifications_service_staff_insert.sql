-- ============================================================================
-- Migration 103: Allow staff to insert service_* in-app notifications for routing
--
-- Previously only service_role could insert rows for other users; service-job-router
-- runs as authenticated user JWT and must notify advisors/techs/managers.
-- ============================================================================

create policy "crm_in_app_notifications_staff_insert_service"
  on public.crm_in_app_notifications for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
    and kind like 'service_%'
  );
