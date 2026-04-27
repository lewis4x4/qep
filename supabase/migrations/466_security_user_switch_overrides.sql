-- 466_security_user_switch_overrides.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#security_switch.code.
-- Column grant renamed to grant_access because GRANT is SQL syntax.
--
-- Rollback notes:
--   drop trigger if exists set_security_user_switch_overrides_updated_at on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_rep_select" on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_rep_scope" on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_rep_own_select" on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_workspace_select" on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_workspace_insert" on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_workspace_update" on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_delete_elevated" on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_all_elevated" on public.security_user_switch_overrides;
--   drop policy if exists "security_user_switch_overrides_service_all" on public.security_user_switch_overrides;
--   drop table if exists public.security_user_switch_overrides;
create table public.security_user_switch_overrides (
  workspace_id text not null default public.get_my_workspace(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  switch_code text not null,
  grant_access boolean not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (workspace_id, profile_id, switch_code, effective_from),
  foreign key (workspace_id, switch_code) references public.security_switches(workspace_id, code) on delete cascade,
  check (effective_to is null or effective_to > effective_from)
);

comment on table public.security_user_switch_overrides is 'Per-user security switch grants/denials with effective windows.';

alter table public.security_user_switch_overrides enable row level security;

create policy "security_user_switch_overrides_service_all"
  on public.security_user_switch_overrides for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "security_user_switch_overrides_all_elevated"
  on public.security_user_switch_overrides for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_security_user_switch_overrides_updated_at
  before update on public.security_user_switch_overrides
  for each row execute function public.set_updated_at();
