-- 403_customer_loyalty_programs.sql
--
-- Wave 1A: customer loyalty/rewards program lookup from
-- docs/intellidealer-gap-audit/phase-1-crm.yaml#customer.loyalty_programs.
--
-- Rollback notes:
--   drop trigger if exists set_customer_loyalty_programs_updated_at on public.customer_loyalty_programs;
--   drop policy if exists "customer_loyalty_programs_rep_select" on public.customer_loyalty_programs;
--   drop policy if exists "customer_loyalty_programs_all_elevated" on public.customer_loyalty_programs;
--   drop policy if exists "customer_loyalty_programs_service_all" on public.customer_loyalty_programs;
--   drop table if exists public.customer_loyalty_programs;

create table public.customer_loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  program_code text not null,
  program_name text not null,
  sponsor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, program_code)
);

comment on table public.customer_loyalty_programs is
  'Loyalty/rewards program master records, including OEM-sponsored and internal programs.';

create index idx_customer_loyalty_programs_active
  on public.customer_loyalty_programs (workspace_id, sponsor, lower(program_code))
  where deleted_at is null;
comment on index public.idx_customer_loyalty_programs_active is
  'Purpose: active loyalty program lookup by workspace, sponsor, and program code.';

alter table public.customer_loyalty_programs enable row level security;

create policy "customer_loyalty_programs_service_all"
  on public.customer_loyalty_programs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "customer_loyalty_programs_all_elevated"
  on public.customer_loyalty_programs for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "customer_loyalty_programs_rep_select"
  on public.customer_loyalty_programs for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_customer_loyalty_programs_updated_at
  before update on public.customer_loyalty_programs
  for each row execute function public.set_updated_at();
