-- 404_customer_loyalty_enrollments.sql
--
-- Wave 1A: per-customer loyalty enrollment rows from
-- docs/intellidealer-gap-audit/phase-1-crm.yaml#customer.loyalty_programs.
-- Depends on 403_customer_loyalty_programs.sql.
--
-- Rollback notes:
--   drop trigger if exists set_customer_loyalty_enrollments_updated_at on public.customer_loyalty_enrollments;
--   drop policy if exists "customer_loyalty_enrollments_rep_scope" on public.customer_loyalty_enrollments;
--   drop policy if exists "customer_loyalty_enrollments_all_elevated" on public.customer_loyalty_enrollments;
--   drop policy if exists "customer_loyalty_enrollments_service_all" on public.customer_loyalty_enrollments;
--   drop table if exists public.customer_loyalty_enrollments;

create table public.customer_loyalty_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  program_id uuid not null references public.customer_loyalty_programs(id) on delete restrict,
  member_number text,
  tier text,
  points_balance numeric(12,2) default 0,
  enrolled_at date,
  tier_expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, company_id, program_id)
);

comment on table public.customer_loyalty_enrollments is
  'Customer enrollment rows for loyalty/rewards programs, including tier, points, and member number.';

create index idx_customer_loyalty_enrollments_company
  on public.customer_loyalty_enrollments (workspace_id, company_id, tier_expires_at)
  where deleted_at is null;
comment on index public.idx_customer_loyalty_enrollments_company is
  'Purpose: load customer loyalty enrollments and upcoming tier expirations on Customer Profile.';

alter table public.customer_loyalty_enrollments enable row level security;

create policy "customer_loyalty_enrollments_service_all"
  on public.customer_loyalty_enrollments for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "customer_loyalty_enrollments_all_elevated"
  on public.customer_loyalty_enrollments for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "customer_loyalty_enrollments_rep_scope"
  on public.customer_loyalty_enrollments for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  );

create trigger set_customer_loyalty_enrollments_updated_at
  before update on public.customer_loyalty_enrollments
  for each row execute function public.set_updated_at();
