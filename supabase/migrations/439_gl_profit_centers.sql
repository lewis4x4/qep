-- 439_gl_profit_centers.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#gl_account.profit_center.
--
-- Rollback notes:
--   drop trigger if exists set_gl_profit_centers_updated_at on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_rep_select" on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_rep_scope" on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_rep_own_select" on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_workspace_select" on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_workspace_insert" on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_workspace_update" on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_delete_elevated" on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_all_elevated" on public.gl_profit_centers;
--   drop policy if exists "gl_profit_centers_service_all" on public.gl_profit_centers;
--   drop table if exists public.gl_profit_centers;
create table public.gl_profit_centers (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  name text not null,
  department text,
  manager_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.gl_profit_centers is 'GL profit-center dimension for employee, branch, and journal reporting.';

alter table public.gl_profit_centers enable row level security;

create policy "gl_profit_centers_service_all"
  on public.gl_profit_centers for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "gl_profit_centers_all_elevated"
  on public.gl_profit_centers for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_gl_profit_centers_updated_at
  before update on public.gl_profit_centers
  for each row execute function public.set_updated_at();
