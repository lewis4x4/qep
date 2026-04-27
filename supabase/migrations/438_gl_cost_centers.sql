-- 438_gl_cost_centers.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#gl_account.cost_center.
--
-- Rollback notes:
--   drop trigger if exists set_gl_cost_centers_updated_at on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_rep_select" on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_rep_scope" on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_rep_own_select" on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_workspace_select" on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_workspace_insert" on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_workspace_update" on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_delete_elevated" on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_all_elevated" on public.gl_cost_centers;
--   drop policy if exists "gl_cost_centers_service_all" on public.gl_cost_centers;
--   drop table if exists public.gl_cost_centers;
create table public.gl_cost_centers (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  name text not null,
  branch_id uuid references public.branches(id) on delete set null,
  department text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.gl_cost_centers is 'GL cost-center dimension for journal lines and financial reporting.';

alter table public.gl_cost_centers enable row level security;

create policy "gl_cost_centers_service_all"
  on public.gl_cost_centers for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "gl_cost_centers_all_elevated"
  on public.gl_cost_centers for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_gl_cost_centers_updated_at
  before update on public.gl_cost_centers
  for each row execute function public.set_updated_at();
