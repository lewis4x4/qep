-- 441_gl_accounts.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#gl_account.account_number.
--
-- Rollback notes:
--   drop trigger if exists set_gl_accounts_updated_at on public.gl_accounts;
--   drop policy if exists "gl_accounts_rep_select" on public.gl_accounts;
--   drop policy if exists "gl_accounts_rep_scope" on public.gl_accounts;
--   drop policy if exists "gl_accounts_rep_own_select" on public.gl_accounts;
--   drop policy if exists "gl_accounts_workspace_select" on public.gl_accounts;
--   drop policy if exists "gl_accounts_workspace_insert" on public.gl_accounts;
--   drop policy if exists "gl_accounts_workspace_update" on public.gl_accounts;
--   drop policy if exists "gl_accounts_delete_elevated" on public.gl_accounts;
--   drop policy if exists "gl_accounts_all_elevated" on public.gl_accounts;
--   drop policy if exists "gl_accounts_service_all" on public.gl_accounts;
--   drop table if exists public.gl_accounts;
create table public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid references public.gl_companies(id) on delete set null,
  division_id uuid references public.gl_divisions(id) on delete set null,
  cost_center_id uuid references public.gl_cost_centers(id) on delete set null,
  profit_center_id uuid references public.gl_profit_centers(id) on delete set null,
  account_number text not null,
  account_name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','cogs','expense','contra_asset','contra_liability','contra_revenue')),
  account_subtype text,
  parent_account_id uuid references public.gl_accounts(id) on delete set null,
  is_header boolean not null default false,
  is_active boolean not null default true,
  is_wip boolean not null default false,
  is_receivable boolean not null default false,
  normal_balance text not null check (normal_balance in ('debit','credit')),
  currency text not null default 'USD',
  cost_center_required boolean not null default false,
  branch_segment_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, account_number)
);

comment on table public.gl_accounts is 'Authoritative chart of accounts for Phase-5/Phase-8 financial reporting and routing.';

create index idx_gl_accounts_parent
  on public.gl_accounts (workspace_id, parent_account_id)
  where parent_account_id is not null and deleted_at is null;
comment on index public.idx_gl_accounts_parent is 'Purpose: chart-of-accounts hierarchy traversal.';

alter table public.gl_accounts enable row level security;

create policy "gl_accounts_service_all"
  on public.gl_accounts for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "gl_accounts_all_elevated"
  on public.gl_accounts for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_gl_accounts_updated_at
  before update on public.gl_accounts
  for each row execute function public.set_updated_at();
