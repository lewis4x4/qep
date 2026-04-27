-- 401_qrm_company_department_reps.sql
--
-- Wave 1A: IntelliDealer per-department customer rep assignment from
-- docs/intellidealer-gap-audit/phase-1-crm.yaml#customer.salesperson_per_department.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_company_department_reps_updated_at on public.qrm_company_department_reps;
--   drop policy if exists "qrm_company_department_reps_rep_scope" on public.qrm_company_department_reps;
--   drop policy if exists "qrm_company_department_reps_all_elevated" on public.qrm_company_department_reps;
--   drop policy if exists "qrm_company_department_reps_service_all" on public.qrm_company_department_reps;
--   drop table if exists public.qrm_company_department_reps;
--   drop type if exists public.rep_department;

create type public.rep_department as enum ('parts','service','rental','equipment','admin','other');

create table public.qrm_company_department_reps (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  department public.rep_department not null,
  rep_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, company_id, department)
);

comment on table public.qrm_company_department_reps is
  'Per-customer salesperson ownership by department (parts, service, rental, equipment, admin, other).';

create index idx_qrm_company_department_reps_company
  on public.qrm_company_department_reps (workspace_id, company_id, department)
  where deleted_at is null;
comment on index public.idx_qrm_company_department_reps_company is
  'Purpose: load department-specific rep assignments on Customer Profile Contact tab.';

create index idx_qrm_company_department_reps_rep
  on public.qrm_company_department_reps (workspace_id, rep_id, department)
  where deleted_at is null;
comment on index public.idx_qrm_company_department_reps_rep is
  'Purpose: rep workload and territory views by department assignment.';

alter table public.qrm_company_department_reps enable row level security;

create policy "qrm_company_department_reps_service_all"
  on public.qrm_company_department_reps for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_company_department_reps_all_elevated"
  on public.qrm_company_department_reps for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_company_department_reps_rep_scope"
  on public.qrm_company_department_reps for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (rep_id = (select auth.uid()) or public.crm_rep_can_access_company(company_id))
  );

create trigger set_qrm_company_department_reps_updated_at
  before update on public.qrm_company_department_reps
  for each row execute function public.set_updated_at();
