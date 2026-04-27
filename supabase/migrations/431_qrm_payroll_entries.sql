-- 431_qrm_payroll_entries.sql
--
-- Wave 1 clean foundation: Phase-5 Deal Genome from
-- docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_payroll.summary_by.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_payroll_entries_updated_at on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_rep_select" on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_rep_scope" on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_rep_own_select" on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_workspace_select" on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_workspace_insert" on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_workspace_update" on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_delete_elevated" on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_all_elevated" on public.qrm_payroll_entries;
--   drop policy if exists "qrm_payroll_entries_service_all" on public.qrm_payroll_entries;
--   drop table if exists public.qrm_payroll_entries;
create table public.qrm_payroll_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  employee_id uuid not null,
  premium_code_id uuid not null references public.qrm_payroll_premium_codes(id) on delete restrict,
  labor_date date not null,
  billing_run_date date,
  hours numeric(8,2) not null check (hours >= 0),
  branch_id uuid references public.branches(id) on delete set null,
  source_module text,
  source_record_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.qrm_payroll_entries is 'Payroll/labor entries by employee, premium code, date, and branch for payroll analysis reports.';
comment on column public.qrm_payroll_entries.employee_id is 'Employee UUID retained without FK until the Cross-Cutting employees foundation exists later in Wave 1.';

create index idx_qrm_payroll_entries_labor_date
  on public.qrm_payroll_entries (workspace_id, labor_date, employee_id)
  where deleted_at is null;
comment on index public.idx_qrm_payroll_entries_labor_date is 'Purpose: payroll analysis by labor date and employee.';

alter table public.qrm_payroll_entries enable row level security;

create policy "qrm_payroll_entries_service_all"
  on public.qrm_payroll_entries for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_payroll_entries_all_elevated"
  on public.qrm_payroll_entries for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_qrm_payroll_entries_updated_at
  before update on public.qrm_payroll_entries
  for each row execute function public.set_updated_at();
