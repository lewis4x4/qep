-- ============================================================================
-- Migration 133: parts_catalog RLS split (no hard-delete for rep) + list index
-- ============================================================================

-- Reps can insert/update catalog rows; only admin/manager/owner may hard-delete.
drop policy if exists "parts_catalog_mutate" on public.parts_catalog;

create policy "parts_catalog_insert_staff"
  on public.parts_catalog for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_catalog_update_staff"
  on public.parts_catalog for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_catalog_delete_elevated"
  on public.parts_catalog for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create index if not exists idx_parts_orders_ws_created_desc
  on public.parts_orders(workspace_id, created_at desc);

comment on index public.idx_parts_orders_ws_created_desc is
  'Staff parts order lists: filter by workspace and sort by recency.';
