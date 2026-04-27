-- 448_ar_statement_runs.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#ar_invoice.print_email_actions.
--
-- Rollback notes:
--   drop trigger if exists set_ar_statement_runs_updated_at on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_rep_select" on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_rep_scope" on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_rep_own_select" on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_workspace_select" on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_workspace_insert" on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_workspace_update" on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_delete_elevated" on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_all_elevated" on public.ar_statement_runs;
--   drop policy if exists "ar_statement_runs_service_all" on public.ar_statement_runs;
--   drop table if exists public.ar_statement_runs;
create table public.ar_statement_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  run_type text not null check (run_type in ('statement','dunning','reminder')),
  scope_filter jsonb,
  delivered_count integer not null default 0 check (delivered_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  scheduled_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.ar_statement_runs is 'Statement, dunning, and reminder print/email run history for AR.';

alter table public.ar_statement_runs enable row level security;

create policy "ar_statement_runs_service_all"
  on public.ar_statement_runs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "ar_statement_runs_all_elevated"
  on public.ar_statement_runs for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_ar_statement_runs_updated_at
  before update on public.ar_statement_runs
  for each row execute function public.set_updated_at();
