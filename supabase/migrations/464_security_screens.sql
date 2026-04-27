-- 464_security_screens.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#security_switch.screen_map.
-- Created after security_switches so the required-switch FK is valid.
--
-- Rollback notes:
--   drop trigger if exists set_security_screens_updated_at on public.security_screens;
--   drop policy if exists "security_screens_rep_select" on public.security_screens;
--   drop policy if exists "security_screens_rep_scope" on public.security_screens;
--   drop policy if exists "security_screens_rep_own_select" on public.security_screens;
--   drop policy if exists "security_screens_workspace_select" on public.security_screens;
--   drop policy if exists "security_screens_workspace_insert" on public.security_screens;
--   drop policy if exists "security_screens_workspace_update" on public.security_screens;
--   drop policy if exists "security_screens_delete_elevated" on public.security_screens;
--   drop policy if exists "security_screens_all_elevated" on public.security_screens;
--   drop policy if exists "security_screens_service_all" on public.security_screens;
--   drop table if exists public.security_screens;
create table public.security_screens (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  screen_id text not null,
  required_switch_code text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, screen_id),
  foreign key (workspace_id, required_switch_code) references public.security_switches(workspace_id, code) on delete restrict
);

comment on table public.security_screens is 'Screen-to-required-security-switch mapping.';

alter table public.security_screens enable row level security;

create policy "security_screens_service_all"
  on public.security_screens for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "security_screens_all_elevated"
  on public.security_screens for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_security_screens_updated_at
  before update on public.security_screens
  for each row execute function public.set_updated_at();
