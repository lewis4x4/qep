-- 532_intellidealer_service_report_print_cleanup.sql
--
-- IntelliDealer service report/export cleanup for residual Phase 5 Deal Genome rows.
-- Additive/idempotent only: no raw IntelliDealer files, no COL artifacts.
-- Sources:
--   docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_wip.create_wip_report_link
--   docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_payroll.print_action
--
-- Rollback notes:
--   drop trigger if exists set_service_report_export_requests_updated_at on public.service_report_export_requests;
--   drop policy if exists "service_report_export_requests_service_all" on public.service_report_export_requests;
--   drop policy if exists "service_report_export_requests_select_scope" on public.service_report_export_requests;
--   drop policy if exists "service_report_export_requests_insert_own" on public.service_report_export_requests;
--   drop policy if exists "service_report_export_requests_update_own" on public.service_report_export_requests;
--   drop table if exists public.service_report_export_requests;

create table if not exists public.service_report_export_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  report_kind text not null check (report_kind in ('service_wip_aging', 'service_payroll_hours')),
  export_format text not null check (export_format in ('csv', 'json')),
  status text not null default 'running' check (status in ('running', 'completed', 'error')),
  filters jsonb not null default '{}'::jsonb,
  row_count integer not null default 0 check (row_count >= 0),
  file_name text,
  content_type text,
  error_message text,
  generated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.service_report_export_requests is
  'Audit/request rows for IntelliDealer-compatible service WIP and payroll-hours CSV/JSON exports.';
comment on column public.service_report_export_requests.report_kind is
  'Supported service report export: service_wip_aging or service_payroll_hours.';
comment on column public.service_report_export_requests.filters is
  'Normalized report filters supplied to the edge export endpoint.';

create index if not exists idx_service_report_export_requests_workspace
  on public.service_report_export_requests (workspace_id, report_kind, created_at desc)
  where deleted_at is null;
comment on index public.idx_service_report_export_requests_workspace is
  'Purpose: list recent service report export requests by workspace and report kind.';

create index if not exists idx_service_report_export_requests_generated_by
  on public.service_report_export_requests (workspace_id, generated_by, created_at desc)
  where deleted_at is null;
comment on index public.idx_service_report_export_requests_generated_by is
  'Purpose: caller-scoped service report export history.';

alter table public.service_report_export_requests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'service_report_export_requests'
      and policyname = 'service_report_export_requests_service_all'
  ) then
    create policy "service_report_export_requests_service_all"
      on public.service_report_export_requests for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'service_report_export_requests'
      and policyname = 'service_report_export_requests_select_scope'
  ) then
    create policy "service_report_export_requests_select_scope"
      on public.service_report_export_requests for select
      using (
        workspace_id = (select public.get_my_workspace())
        and deleted_at is null
        and (
          generated_by = (select auth.uid())
          or (select public.get_my_role()) in ('admin', 'manager', 'owner')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'service_report_export_requests'
      and policyname = 'service_report_export_requests_insert_own'
  ) then
    create policy "service_report_export_requests_insert_own"
      on public.service_report_export_requests for insert
      with check (
        workspace_id = (select public.get_my_workspace())
        and generated_by = (select auth.uid())
        and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'service_report_export_requests'
      and policyname = 'service_report_export_requests_update_own'
  ) then
    create policy "service_report_export_requests_update_own"
      on public.service_report_export_requests for update
      using (
        workspace_id = (select public.get_my_workspace())
        and generated_by = (select auth.uid())
      )
      with check (
        workspace_id = (select public.get_my_workspace())
        and generated_by = (select auth.uid())
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_service_report_export_requests_updated_at'
      and tgrelid = 'public.service_report_export_requests'::regclass
  ) then
    create trigger set_service_report_export_requests_updated_at
      before update on public.service_report_export_requests
      for each row execute function public.set_updated_at();
  end if;
end $$;
