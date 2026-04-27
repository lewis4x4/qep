-- 459_traffic_ticket_lines.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#traffic_ticket.add_ons_lines.
--
-- Rollback notes:
--   drop trigger if exists set_traffic_ticket_lines_updated_at on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_rep_select" on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_rep_scope" on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_rep_own_select" on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_workspace_select" on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_workspace_insert" on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_workspace_update" on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_delete_elevated" on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_all_elevated" on public.traffic_ticket_lines;
--   drop policy if exists "traffic_ticket_lines_service_all" on public.traffic_ticket_lines;
--   drop table if exists public.traffic_ticket_lines;
create table public.traffic_ticket_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  traffic_ticket_id uuid not null references public.traffic_tickets(id) on delete cascade,
  line_no integer not null,
  line_kind text not null check (line_kind in ('add_on','attachment','part')),
  stock_number text,
  part_number text,
  description text,
  hours numeric,
  units integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (traffic_ticket_id, line_no)
);

comment on table public.traffic_ticket_lines is 'Traffic ticket add-on, attachment, and part lines.';

create index idx_traffic_ticket_lines_ticket
  on public.traffic_ticket_lines (workspace_id, traffic_ticket_id, line_no)
  where deleted_at is null;
comment on index public.idx_traffic_ticket_lines_ticket is 'Purpose: render traffic ticket line items in line-number order.';

alter table public.traffic_ticket_lines enable row level security;

create policy "traffic_ticket_lines_service_all"
  on public.traffic_ticket_lines for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "traffic_ticket_lines_workspace_select"
  on public.traffic_ticket_lines for select
  using (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_ticket_lines_workspace_insert"
  on public.traffic_ticket_lines for insert
  with check (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_ticket_lines_workspace_update"
  on public.traffic_ticket_lines for update
  using (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_ticket_lines_delete_elevated"
  on public.traffic_ticket_lines for delete
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_traffic_ticket_lines_updated_at
  before update on public.traffic_ticket_lines
  for each row execute function public.set_updated_at();
