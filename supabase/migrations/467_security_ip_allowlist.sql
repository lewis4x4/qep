-- 467_security_ip_allowlist.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#security.ip_device_restriction.
--
-- Rollback notes:
--   drop trigger if exists set_security_ip_allowlist_updated_at on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_rep_select" on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_rep_scope" on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_rep_own_select" on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_workspace_select" on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_workspace_insert" on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_workspace_update" on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_delete_elevated" on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_all_elevated" on public.security_ip_allowlist;
--   drop policy if exists "security_ip_allowlist_service_all" on public.security_ip_allowlist;
--   drop table if exists public.security_ip_allowlist;
create table public.security_ip_allowlist (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  scope text not null check (scope in ('role','user','switch')),
  scope_ref text not null,
  cidr inet not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  revoked_at timestamptz,
  deleted_at timestamptz
);

comment on table public.security_ip_allowlist is 'Role, user, or switch scoped IP allowlist restrictions.';

create index idx_security_ip_allowlist_scope
  on public.security_ip_allowlist (workspace_id, scope, scope_ref)
  where revoked_at is null and deleted_at is null;
comment on index public.idx_security_ip_allowlist_scope is 'Purpose: resolve active IP allowlist entries for a role/user/switch scope.';

alter table public.security_ip_allowlist enable row level security;

create policy "security_ip_allowlist_service_all"
  on public.security_ip_allowlist for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "security_ip_allowlist_all_elevated"
  on public.security_ip_allowlist for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_security_ip_allowlist_updated_at
  before update on public.security_ip_allowlist
  for each row execute function public.set_updated_at();
