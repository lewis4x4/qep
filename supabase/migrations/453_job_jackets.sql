-- 453_job_jackets.sql
--
-- Wave 1 clean foundation: Phase-9 Advanced Intelligence from
-- docs/intellidealer-gap-audit/phase-9-advanced-intelligence.yaml#customer_portal_view.job_jacket_history.
-- The service_jobs.job_jacket_id extension is Wave 2 scope and intentionally not included here.
--
-- Rollback notes:
--   drop trigger if exists set_job_jackets_updated_at on public.job_jackets;
--   drop policy if exists "job_jackets_rep_select" on public.job_jackets;
--   drop policy if exists "job_jackets_rep_scope" on public.job_jackets;
--   drop policy if exists "job_jackets_rep_own_select" on public.job_jackets;
--   drop policy if exists "job_jackets_workspace_select" on public.job_jackets;
--   drop policy if exists "job_jackets_workspace_insert" on public.job_jackets;
--   drop policy if exists "job_jackets_workspace_update" on public.job_jackets;
--   drop policy if exists "job_jackets_delete_elevated" on public.job_jackets;
--   drop policy if exists "job_jackets_all_elevated" on public.job_jackets;
--   drop policy if exists "job_jackets_service_all" on public.job_jackets;
--   drop table if exists public.job_jackets;
create table public.job_jackets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  machine_description text,
  problem_description text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.job_jackets is 'Customer portal job-jacket history for machines, problem descriptions, and open/closed lifecycle.';

create index idx_job_jackets_company
  on public.job_jackets (workspace_id, company_id, opened_at desc)
  where deleted_at is null;
comment on index public.idx_job_jackets_company is 'Purpose: customer job-jacket history and open-job lookup.';

alter table public.job_jackets enable row level security;

create policy "job_jackets_service_all"
  on public.job_jackets for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "job_jackets_all_elevated"
  on public.job_jackets for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "job_jackets_rep_scope"
  on public.job_jackets for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  );

create trigger set_job_jackets_updated_at
  before update on public.job_jackets
  for each row execute function public.set_updated_at();
