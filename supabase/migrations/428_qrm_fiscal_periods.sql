-- 428_qrm_fiscal_periods.sql
--
-- Wave 1 clean foundation: Phase-5 Deal Genome from
-- docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#profitability.analysis_by.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_fiscal_periods_updated_at on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_rep_select" on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_rep_scope" on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_rep_own_select" on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_workspace_select" on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_workspace_insert" on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_workspace_update" on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_delete_elevated" on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_all_elevated" on public.qrm_fiscal_periods;
--   drop policy if exists "qrm_fiscal_periods_service_all" on public.qrm_fiscal_periods;
--   drop table if exists public.qrm_fiscal_periods;
create table public.qrm_fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  period_year integer not null,
  period_number integer not null check (period_number between 1 and 13),
  starts_on date not null,
  ends_on date not null,
  is_closed boolean not null default false,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, period_year, period_number),
  check (ends_on >= starts_on)
);

comment on table public.qrm_fiscal_periods is 'IntelliDealer fiscal period lookup for customer profitability and financial reporting slices.';

create index idx_qrm_fiscal_periods_open
  on public.qrm_fiscal_periods (workspace_id, period_year, period_number)
  where is_closed = false and deleted_at is null;
comment on index public.idx_qrm_fiscal_periods_open is 'Purpose: locate open fiscal periods for financial report filters.';

alter table public.qrm_fiscal_periods enable row level security;

create policy "qrm_fiscal_periods_service_all"
  on public.qrm_fiscal_periods for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_fiscal_periods_all_elevated"
  on public.qrm_fiscal_periods for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_fiscal_periods_rep_select"
  on public.qrm_fiscal_periods for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_qrm_fiscal_periods_updated_at
  before update on public.qrm_fiscal_periods
  for each row execute function public.set_updated_at();
