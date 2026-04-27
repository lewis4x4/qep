-- 436_gl_companies.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#gl_account.company.
--
-- Rollback notes:
--   drop trigger if exists set_gl_companies_updated_at on public.gl_companies;
--   drop policy if exists "gl_companies_rep_select" on public.gl_companies;
--   drop policy if exists "gl_companies_rep_scope" on public.gl_companies;
--   drop policy if exists "gl_companies_rep_own_select" on public.gl_companies;
--   drop policy if exists "gl_companies_workspace_select" on public.gl_companies;
--   drop policy if exists "gl_companies_workspace_insert" on public.gl_companies;
--   drop policy if exists "gl_companies_workspace_update" on public.gl_companies;
--   drop policy if exists "gl_companies_delete_elevated" on public.gl_companies;
--   drop policy if exists "gl_companies_all_elevated" on public.gl_companies;
--   drop policy if exists "gl_companies_service_all" on public.gl_companies;
--   drop table if exists public.gl_companies;
create table public.gl_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  legal_name text not null,
  ein text,
  currency text not null default 'USD',
  fiscal_year_end_month integer not null default 12 check (fiscal_year_end_month between 1 and 12),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.gl_companies is 'GL company/legal-entity dimension for chart of accounts and period close.';

alter table public.gl_companies enable row level security;

create policy "gl_companies_service_all"
  on public.gl_companies for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "gl_companies_all_elevated"
  on public.gl_companies for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_gl_companies_updated_at
  before update on public.gl_companies
  for each row execute function public.set_updated_at();
