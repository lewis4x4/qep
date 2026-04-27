-- 451_billing_run_reports.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#billing_queue.related_reports.
--
-- Rollback notes:
--   drop trigger if exists set_billing_run_reports_updated_at on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_rep_select" on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_rep_scope" on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_rep_own_select" on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_workspace_select" on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_workspace_insert" on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_workspace_update" on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_delete_elevated" on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_all_elevated" on public.billing_run_reports;
--   drop policy if exists "billing_run_reports_service_all" on public.billing_run_reports;
--   drop table if exists public.billing_run_reports;
create table public.billing_run_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  billing_queue_id uuid not null references public.billing_queue(id) on delete cascade,
  report_number text not null,
  report_name text not null,
  document_url text,
  location_id uuid references public.branches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (billing_queue_id, report_number)
);

comment on table public.billing_run_reports is 'Documents/reports emitted by billing queue runs.';

create index idx_billing_run_reports_queue
  on public.billing_run_reports (workspace_id, billing_queue_id, report_number)
  where deleted_at is null;
comment on index public.idx_billing_run_reports_queue is 'Purpose: list billing-run reports for a queue item.';

alter table public.billing_run_reports enable row level security;

create policy "billing_run_reports_service_all"
  on public.billing_run_reports for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "billing_run_reports_all_elevated"
  on public.billing_run_reports for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_billing_run_reports_updated_at
  before update on public.billing_run_reports
  for each row execute function public.set_updated_at();
