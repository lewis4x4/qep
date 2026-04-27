-- 440_gl_periods.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#gl_period.fiscal_period.
--
-- Rollback notes:
--   drop trigger if exists set_gl_periods_updated_at on public.gl_periods;
--   drop policy if exists "gl_periods_rep_select" on public.gl_periods;
--   drop policy if exists "gl_periods_rep_scope" on public.gl_periods;
--   drop policy if exists "gl_periods_rep_own_select" on public.gl_periods;
--   drop policy if exists "gl_periods_workspace_select" on public.gl_periods;
--   drop policy if exists "gl_periods_workspace_insert" on public.gl_periods;
--   drop policy if exists "gl_periods_workspace_update" on public.gl_periods;
--   drop policy if exists "gl_periods_delete_elevated" on public.gl_periods;
--   drop policy if exists "gl_periods_all_elevated" on public.gl_periods;
--   drop policy if exists "gl_periods_service_all" on public.gl_periods;
--   drop table if exists public.gl_periods;
create table public.gl_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid references public.gl_companies(id) on delete cascade,
  period_year integer not null,
  period_month integer not null check (period_month between 1 and 12),
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('future','open','soft_closed','hard_closed')),
  ar_closed_at timestamptz,
  ap_closed_at timestamptz,
  gl_closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, company_id, period_year, period_month),
  check (period_end >= period_start)
);

comment on table public.gl_periods is 'GL fiscal periods with AR/AP/GL close status.';

create index idx_gl_periods_open
  on public.gl_periods (workspace_id, company_id, period_year, period_month)
  where status in ('future','open','soft_closed') and deleted_at is null;
comment on index public.idx_gl_periods_open is 'Purpose: period picker and close workflow lookup for open periods.';

alter table public.gl_periods enable row level security;

create policy "gl_periods_service_all"
  on public.gl_periods for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "gl_periods_all_elevated"
  on public.gl_periods for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_gl_periods_updated_at
  before update on public.gl_periods
  for each row execute function public.set_updated_at();
