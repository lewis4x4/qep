-- 455_employees.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#employee.employee_number.
--
-- Rollback notes:
--   drop trigger if exists set_employees_updated_at on public.employees;
--   drop policy if exists "employees_rep_own_select" on public.employees;
--   drop policy if exists "employees_all_elevated" on public.employees;
--   drop policy if exists "employees_service_all" on public.employees;
--   drop table if exists public.employees;
--   drop type if exists public.pay_type;
--   drop type if exists public.profit_center_code;

create type public.profit_center_code as enum ('0','1','2','3','4','5','6','7','8','9');
create type public.pay_type as enum ('hourly','salary','commission','piecework','flat_rate');

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  profile_id uuid references public.profiles(id) on delete set null,
  employee_number text not null,
  display_name text,
  class_code text,
  profit_center public.profit_center_code,
  category_code text,
  pay_type public.pay_type,
  hire_date date,
  termination_date date,
  termination_reason text,
  shop_rate_cents integer check (shop_rate_cents is null or shop_rate_cents >= 0),
  shop_rate_effective_from date,
  shift_code text,
  supervisor_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, employee_number),
  foreign key (workspace_id, class_code) references public.employee_classes(workspace_id, code) on delete restrict
);

comment on table public.employees is 'Generic employee master for payroll, technicians, managers, sales, traffic, and cross-module cost reporting.';
comment on column public.employees.profit_center is '0=Balance Sheet,1=Admin,2=Equipment,3=Parts,4=Service,5=Rental,6-9=User.';

create index idx_employees_profile
  on public.employees (workspace_id, profile_id)
  where profile_id is not null and deleted_at is null;
comment on index public.idx_employees_profile is 'Purpose: map authenticated profile rows to employee records.';

create index idx_employees_active
  on public.employees (workspace_id, employee_number)
  where termination_date is null and deleted_at is null;
comment on index public.idx_employees_active is 'Purpose: employee picker/list defaults to active employees.';

alter table public.employees enable row level security;

create policy "employees_service_all"
  on public.employees for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "employees_all_elevated"
  on public.employees for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "employees_rep_own_select"
  on public.employees for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and profile_id = (select auth.uid())
  );

create trigger set_employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();
