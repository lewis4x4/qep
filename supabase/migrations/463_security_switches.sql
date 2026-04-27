-- 463_security_switches.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#security_switch.code.
--
-- Rollback notes:
--   drop trigger if exists set_security_switches_updated_at on public.security_switches;
--   drop policy if exists "security_switches_rep_select" on public.security_switches;
--   drop policy if exists "security_switches_rep_scope" on public.security_switches;
--   drop policy if exists "security_switches_rep_own_select" on public.security_switches;
--   drop policy if exists "security_switches_workspace_select" on public.security_switches;
--   drop policy if exists "security_switches_workspace_insert" on public.security_switches;
--   drop policy if exists "security_switches_workspace_update" on public.security_switches;
--   drop policy if exists "security_switches_delete_elevated" on public.security_switches;
--   drop policy if exists "security_switches_all_elevated" on public.security_switches;
--   drop policy if exists "security_switches_service_all" on public.security_switches;
--   drop table if exists public.security_switches;
create table public.security_switches (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  screen_id text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.security_switches is 'Fine-grained IntelliDealer-style security switches for per-screen access control.';

alter table public.security_switches enable row level security;

create policy "security_switches_service_all"
  on public.security_switches for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "security_switches_all_elevated"
  on public.security_switches for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_security_switches_updated_at
  before update on public.security_switches
  for each row execute function public.set_updated_at();
