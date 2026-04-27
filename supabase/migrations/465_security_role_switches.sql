-- 465_security_role_switches.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#security_switch.code.
-- Adapted hint role_id to repo-native public.user_role; QEP has no role table.
--
-- Rollback notes:
--   drop trigger if exists set_security_role_switches_updated_at on public.security_role_switches;
--   drop policy if exists "security_role_switches_rep_select" on public.security_role_switches;
--   drop policy if exists "security_role_switches_rep_scope" on public.security_role_switches;
--   drop policy if exists "security_role_switches_rep_own_select" on public.security_role_switches;
--   drop policy if exists "security_role_switches_workspace_select" on public.security_role_switches;
--   drop policy if exists "security_role_switches_workspace_insert" on public.security_role_switches;
--   drop policy if exists "security_role_switches_workspace_update" on public.security_role_switches;
--   drop policy if exists "security_role_switches_delete_elevated" on public.security_role_switches;
--   drop policy if exists "security_role_switches_all_elevated" on public.security_role_switches;
--   drop policy if exists "security_role_switches_service_all" on public.security_role_switches;
--   drop table if exists public.security_role_switches;
create table public.security_role_switches (
  workspace_id text not null default public.get_my_workspace(),
  role_code public.user_role not null,
  switch_code text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (workspace_id, role_code, switch_code),
  foreign key (workspace_id, switch_code) references public.security_switches(workspace_id, code) on delete cascade
);

comment on table public.security_role_switches is 'Security switch grants/revocations for QEP user roles.';

alter table public.security_role_switches enable row level security;

create policy "security_role_switches_service_all"
  on public.security_role_switches for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "security_role_switches_all_elevated"
  on public.security_role_switches for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_security_role_switches_updated_at
  before update on public.security_role_switches
  for each row execute function public.set_updated_at();
