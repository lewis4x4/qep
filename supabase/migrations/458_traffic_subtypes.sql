-- 458_traffic_subtypes.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#traffic_ticket.subtype.
-- traffic_tickets.subtype_code is a Wave 2 extension and intentionally not included here.
--
-- Rollback notes:
--   drop trigger if exists set_traffic_subtypes_updated_at on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_rep_select" on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_rep_scope" on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_rep_own_select" on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_workspace_select" on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_workspace_insert" on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_workspace_update" on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_delete_elevated" on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_all_elevated" on public.traffic_subtypes;
--   drop policy if exists "traffic_subtypes_service_all" on public.traffic_subtypes;
--   drop table if exists public.traffic_subtypes;
create table public.traffic_subtypes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  receipt_type text not null,
  code text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, receipt_type, code)
);

comment on table public.traffic_subtypes is 'Traffic receipt subtype lookup for dispatch and receipt-detail workflows.';

alter table public.traffic_subtypes enable row level security;

create policy "traffic_subtypes_service_all"
  on public.traffic_subtypes for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "traffic_subtypes_all_elevated"
  on public.traffic_subtypes for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_subtypes_rep_select"
  on public.traffic_subtypes for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_traffic_subtypes_updated_at
  before update on public.traffic_subtypes
  for each row execute function public.set_updated_at();
