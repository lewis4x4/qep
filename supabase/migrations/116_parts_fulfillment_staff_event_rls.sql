-- ============================================================================
-- Migration 116: Allow internal staff (JWT) to append fulfillment events and
-- update run status — used when marking portal parts orders shipped + notify.
-- ============================================================================

create policy "parts_fulfillment_events_insert_staff"
  on public.parts_fulfillment_events for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_fulfillment_runs_update_staff"
  on public.parts_fulfillment_runs for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (workspace_id = public.get_my_workspace());
