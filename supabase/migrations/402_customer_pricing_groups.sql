-- 402_customer_pricing_groups.sql
--
-- Wave 1A: customer pricing group lookup from
-- docs/intellidealer-gap-audit/phase-1-crm.yaml#customer.customer_pricing_group.
-- The qrm_companies.pricing_group_id extension is intentionally Wave 2 scope.
--
-- Rollback notes:
--   drop trigger if exists set_customer_pricing_groups_updated_at on public.customer_pricing_groups;
--   drop policy if exists "customer_pricing_groups_rep_select" on public.customer_pricing_groups;
--   drop policy if exists "customer_pricing_groups_all_elevated" on public.customer_pricing_groups;
--   drop policy if exists "customer_pricing_groups_service_all" on public.customer_pricing_groups;
--   drop table if exists public.customer_pricing_groups;

create table public.customer_pricing_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  name text not null,
  parts_discount_pct numeric(5,2),
  labor_discount_pct numeric(5,2),
  equipment_discount_pct numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.customer_pricing_groups is
  'Customer pricing-tier groups used for parts, labor, and equipment discount defaults.';

create index idx_customer_pricing_groups_active
  on public.customer_pricing_groups (workspace_id, lower(code))
  where deleted_at is null;
comment on index public.idx_customer_pricing_groups_active is
  'Purpose: active pricing-group lookup by workspace and code for Customer Profile pricing controls.';

alter table public.customer_pricing_groups enable row level security;

create policy "customer_pricing_groups_service_all"
  on public.customer_pricing_groups for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "customer_pricing_groups_all_elevated"
  on public.customer_pricing_groups for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "customer_pricing_groups_rep_select"
  on public.customer_pricing_groups for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_customer_pricing_groups_updated_at
  before update on public.customer_pricing_groups
  for each row execute function public.set_updated_at();
