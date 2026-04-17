-- ============================================================================
-- Migration 296: QB Price Sheet Programs — RLS
--
-- RLS on qb_price_sheet_programs (new table from migration 292).
-- Pattern matches existing qb_price_sheets policies in migration 289:
--   - Service role bypass
--   - Select: admin/manager/owner only (price sheets are not rep-facing)
--   - Insert/Update: admin/manager/owner only
--   - Delete: blocked (soft-delete via review_status = 'rejected')
-- ============================================================================

alter table public.qb_price_sheet_programs enable row level security;

-- Service role bypass (edge functions run as service_role)
create policy "qb_price_sheet_programs_service"
  on public.qb_price_sheet_programs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Admin/manager/owner: full access
create policy "qb_price_sheet_programs_select"
  on public.qb_price_sheet_programs
  for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "qb_price_sheet_programs_write"
  on public.qb_price_sheet_programs
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "qb_price_sheet_programs_update"
  on public.qb_price_sheet_programs
  for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );
