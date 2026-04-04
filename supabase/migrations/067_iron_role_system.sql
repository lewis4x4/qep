-- ============================================================================
-- Migration 067: Iron Role System
--
-- Maps existing system roles to Iron nomenclature per owner's SOPs.
-- Does NOT create new auth roles — extends the existing profiles table.
--
-- Mapping:
--   role = 'manager'                → iron_manager (Iron Manager)
--   role = 'rep' (no support flag)  → iron_advisor (Iron Advisor)
--   role = 'admin'                  → iron_woman   (Iron Woman)
--   role = 'rep' + is_support=true  → iron_man     (Iron Man)
-- ============================================================================

-- ── 1. Add Iron role columns to profiles ────────────────────────────────────

alter table public.profiles
  add column if not exists iron_role text
    check (iron_role in ('iron_manager', 'iron_advisor', 'iron_woman', 'iron_man')),
  add column if not exists iron_role_display text,
  add column if not exists is_support boolean not null default false;

comment on column public.profiles.iron_role is 'Iron nomenclature role (derived from system role + is_support flag)';
comment on column public.profiles.iron_role_display is 'Display name: Iron Manager, Iron Advisor, Iron Woman, Iron Man';
comment on column public.profiles.is_support is 'Support tech flag — when true with role=rep, maps to Iron Man instead of Iron Advisor';

-- ── 2. Backfill existing profiles ───────────────────────────────────────────

update public.profiles
set
  iron_role = case
    when role = 'manager' then 'iron_manager'
    when role = 'owner' then 'iron_manager'
    when role = 'admin' then 'iron_woman'
    when role = 'rep' and is_support = true then 'iron_man'
    when role = 'rep' then 'iron_advisor'
  end,
  iron_role_display = case
    when role = 'manager' then 'Iron Manager'
    when role = 'owner' then 'Iron Manager'
    when role = 'admin' then 'Iron Woman'
    when role = 'rep' and is_support = true then 'Iron Man'
    when role = 'rep' then 'Iron Advisor'
  end
where iron_role is null;

-- ── 3. Auto-sync iron_role when system role changes ─────────────────────────

create or replace function public.sync_iron_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  NEW.iron_role := case
    when NEW.role = 'manager' then 'iron_manager'
    when NEW.role = 'owner' then 'iron_manager'
    when NEW.role = 'admin' then 'iron_woman'
    when NEW.role = 'rep' and NEW.is_support = true then 'iron_man'
    when NEW.role = 'rep' then 'iron_advisor'
  end;
  NEW.iron_role_display := case
    when NEW.role = 'manager' then 'Iron Manager'
    when NEW.role = 'owner' then 'Iron Manager'
    when NEW.role = 'admin' then 'Iron Woman'
    when NEW.role = 'rep' and NEW.is_support = true then 'Iron Man'
    when NEW.role = 'rep' then 'Iron Advisor'
  end;
  return NEW;
end;
$$;

drop trigger if exists sync_iron_role_on_change on public.profiles;
create trigger sync_iron_role_on_change
  before insert or update of role, is_support on public.profiles
  for each row
  execute function public.sync_iron_role();

-- ── 4. Helper function: get current user's Iron role ────────────────────────

create or replace function public.get_my_iron_role()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select iron_role from public.profiles where id = auth.uid();
$$;

revoke execute on function public.get_my_iron_role() from public;
grant execute on function public.get_my_iron_role() to authenticated;

-- ── 5. Index for role-based queries ─────────────────────────────────────────

create index if not exists idx_profiles_iron_role on public.profiles(iron_role) where iron_role is not null;
