-- 454_employee_classes.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#employee.class.
--
-- Rollback notes:
--   drop trigger if exists set_employee_classes_updated_at on public.employee_classes;
--   drop policy if exists "employee_classes_rep_select" on public.employee_classes;
--   drop policy if exists "employee_classes_rep_scope" on public.employee_classes;
--   drop policy if exists "employee_classes_rep_own_select" on public.employee_classes;
--   drop policy if exists "employee_classes_workspace_select" on public.employee_classes;
--   drop policy if exists "employee_classes_workspace_insert" on public.employee_classes;
--   drop policy if exists "employee_classes_workspace_update" on public.employee_classes;
--   drop policy if exists "employee_classes_delete_elevated" on public.employee_classes;
--   drop policy if exists "employee_classes_all_elevated" on public.employee_classes;
--   drop policy if exists "employee_classes_service_all" on public.employee_classes;
--   drop table if exists public.employee_classes;
create table public.employee_classes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  description text,
  gl_expense_account text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.employee_classes is 'Employee class lookup for payroll, GL expense routing, and cost reporting.';

alter table public.employee_classes enable row level security;

create policy "employee_classes_service_all"
  on public.employee_classes for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "employee_classes_all_elevated"
  on public.employee_classes for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "employee_classes_rep_select"
  on public.employee_classes for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_employee_classes_updated_at
  before update on public.employee_classes
  for each row execute function public.set_updated_at();
