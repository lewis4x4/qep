-- 437_gl_divisions.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#gl_account.division.
--
-- Rollback notes:
--   drop trigger if exists set_gl_divisions_updated_at on public.gl_divisions;
--   drop policy if exists "gl_divisions_rep_select" on public.gl_divisions;
--   drop policy if exists "gl_divisions_rep_scope" on public.gl_divisions;
--   drop policy if exists "gl_divisions_rep_own_select" on public.gl_divisions;
--   drop policy if exists "gl_divisions_workspace_select" on public.gl_divisions;
--   drop policy if exists "gl_divisions_workspace_insert" on public.gl_divisions;
--   drop policy if exists "gl_divisions_workspace_update" on public.gl_divisions;
--   drop policy if exists "gl_divisions_delete_elevated" on public.gl_divisions;
--   drop policy if exists "gl_divisions_all_elevated" on public.gl_divisions;
--   drop policy if exists "gl_divisions_service_all" on public.gl_divisions;
--   drop table if exists public.gl_divisions;
create table public.gl_divisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.gl_companies(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, company_id, code)
);

comment on table public.gl_divisions is 'GL division dimension under a company/legal entity.';

alter table public.gl_divisions enable row level security;

create policy "gl_divisions_service_all"
  on public.gl_divisions for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "gl_divisions_all_elevated"
  on public.gl_divisions for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_gl_divisions_updated_at
  before update on public.gl_divisions
  for each row execute function public.set_updated_at();
