-- 420_service_shop_bays.sql
--
-- Wave 1B: IntelliDealer service shop/bay assignment foundation from
-- docs/intellidealer-gap-audit/phase-4-service.yaml#work_order_segment.shop_bay.
--
-- Rollback notes:
--   drop trigger if exists set_service_shop_bays_updated_at on public.service_shop_bays;
--   drop policy if exists "service_shop_bays_rep_select" on public.service_shop_bays;
--   drop policy if exists "service_shop_bays_all_elevated" on public.service_shop_bays;
--   drop policy if exists "service_shop_bays_service_all" on public.service_shop_bays;
--   drop table if exists public.service_shop_bays;

create table public.service_shop_bays (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  shop_name text not null,
  bay_name text not null,
  is_active boolean not null default true,
  capabilities jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, branch_id, shop_name, bay_name)
);

comment on table public.service_shop_bays is
  'Service shop and bay catalog used to assign work-order segments to physical repair lanes.';

create index idx_service_shop_bays_branch_active
  on public.service_shop_bays (workspace_id, branch_id, is_active, shop_name, bay_name)
  where deleted_at is null;
comment on index public.idx_service_shop_bays_branch_active is
  'Purpose: branch-scoped service scheduling bay picker and active bay grid.';

alter table public.service_shop_bays enable row level security;

create policy "service_shop_bays_service_all"
  on public.service_shop_bays for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "service_shop_bays_all_elevated"
  on public.service_shop_bays for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "service_shop_bays_rep_select"
  on public.service_shop_bays for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_service_shop_bays_updated_at
  before update on public.service_shop_bays
  for each row execute function public.set_updated_at();
