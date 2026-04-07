-- ============================================================================
-- Migration 203: Profile Identity Propagation
--
-- Establishes the operator identity propagation chain:
--
--   profiles.active_workspace_id
--     -> AFTER UPDATE trigger writes auth.users.raw_app_meta_data
--     -> next issued JWT carries workspace_id + iron_role + role claims
--     -> get_my_workspace() returns the real value (with DB fallback for stale JWTs)
--     -> ~40 tables' RLS enforces real workspace scoping
--     -> Iron Companion, DGE, edge functions all get correct context
--
-- Prior state: get_my_workspace() read JWT claims only, nothing wrote them,
-- every authenticated user effectively resolved to 'default'. Six backend
-- callsites (including both Wave 7 Iron edge functions) silently selected a
-- non-existent profiles.workspace_id column and fell back to 'default'.
--
-- See /Users/brianlewis/.claude/plans/compiled-stargazing-fountain.md
-- ============================================================================

-- ── 1. Add active_workspace_id column to profiles ───────────────────────────

alter table public.profiles
  add column if not exists active_workspace_id text;

comment on column public.profiles.active_workspace_id is
  'The workspace this user is currently acting within. Must exist in profile_workspaces for this user. Propagated into auth.users.raw_app_meta_data for JWT claims.';

-- ── 2. Backfill orphan profiles into profile_workspaces ─────────────────────
-- Any profile without a membership row gets a 'default' membership so the
-- validation trigger in step 4 does not block the backfill update in step 3.

insert into public.profile_workspaces (profile_id, workspace_id)
select p.id, 'default'
from public.profiles p
where not exists (
  select 1 from public.profile_workspaces pw
  where pw.profile_id = p.id
)
on conflict do nothing;

-- ── 3. Backfill active_workspace_id ─────────────────────────────────────────
-- Preference order:
--   1. 'default' if present in profile_workspaces (preserves historical access
--      because all ~40 workspace-scoped tables were inserted with default 'default')
--   2. Alphabetical first membership
--   3. 'default' as a final fallback
--
-- This ordering is mandatory: switching a user off 'default' when their
-- historical data was scoped to 'default' would instantly hide it from them.

update public.profiles p
set active_workspace_id = coalesce(
  (select 'default'
     from public.profile_workspaces pw
     where pw.profile_id = p.id and pw.workspace_id = 'default'
     limit 1),
  (select pw.workspace_id
     from public.profile_workspaces pw
     where pw.profile_id = p.id
     order by pw.workspace_id asc
     limit 1),
  'default'
)
where p.active_workspace_id is null;

-- ── 4. Validation trigger (closes self-update RLS hole) ─────────────────────
-- profiles_update_own RLS (migration 001) allows users to UPDATE their own
-- profile row freely, including any column. Without DB validation, a hostile
-- user could set active_workspace_id to any value via direct PostgREST and
-- reassign themselves into another workspace. Enforce membership at the DB.

create or replace function public.validate_profile_active_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.active_workspace_id is null then
    raise exception 'active_workspace_id cannot be null';
  end if;

  if not exists (
    select 1 from public.profile_workspaces
    where profile_id = NEW.id
      and workspace_id = NEW.active_workspace_id
  ) then
    raise exception 'active_workspace_id % is not a membership of profile %',
      NEW.active_workspace_id, NEW.id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists validate_profile_active_workspace on public.profiles;
create trigger validate_profile_active_workspace
  before insert or update of active_workspace_id on public.profiles
  for each row
  execute function public.validate_profile_active_workspace();

-- ── 5. Lock in NOT NULL + DEFAULT after backfill ────────────────────────────

alter table public.profiles
  alter column active_workspace_id set default 'default';

alter table public.profiles
  alter column active_workspace_id set not null;

create index if not exists idx_profiles_active_workspace
  on public.profiles(active_workspace_id);

-- ── 6. Identity propagation trigger (the breakthrough) ──────────────────────
-- Writes workspace_id, iron_role, and role into auth.users.raw_app_meta_data
-- whenever any of them change on the profile. GoTrue copies raw_app_meta_data
-- into the JWT at token issuance, so the next sign-in / refreshSession picks
-- up the new claims automatically.
--
-- SECURITY DEFINER is required because auth.users is owned by supabase_auth_admin.
-- Precedent: migration 017 already writes to auth.users from a public function.
-- No RLS on auth.users.

create or replace function public.sync_profile_to_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No-op guard: on UPDATE, only propagate when a tracked field actually changed.
  -- The trigger is already scoped to update-of those columns, but that filters
  -- on the SET list, not on value change.
  if tg_op = 'UPDATE'
     and OLD.active_workspace_id is not distinct from NEW.active_workspace_id
     and OLD.iron_role is not distinct from NEW.iron_role
     and OLD.role is not distinct from NEW.role
  then
    return NEW;
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
         'workspace_id', NEW.active_workspace_id,
         'iron_role',    NEW.iron_role,
         'role',         NEW.role::text
       )
  where id = NEW.id;

  return NEW;
end;
$$;

drop trigger if exists sync_profile_to_auth_metadata on public.profiles;
create trigger sync_profile_to_auth_metadata
  after insert or update of active_workspace_id, iron_role, role on public.profiles
  for each row
  execute function public.sync_profile_to_auth_metadata();

-- Seed raw_app_meta_data for every existing profile now that the backfill
-- and triggers are in place. This ensures the next time any user refreshes
-- their session, their JWT carries the correct claims.

do $$
declare
  r record;
begin
  for r in
    select id, active_workspace_id, iron_role, role from public.profiles
  loop
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object(
           'workspace_id', r.active_workspace_id,
           'iron_role',    r.iron_role,
           'role',         r.role::text
         )
    where id = r.id;
  end loop;
end;
$$;

-- ── 7. Replace get_my_workspace() with DB fallback ──────────────────────────
-- Keep JWT claims as the primary fast path (no query). If the claim is
-- missing/empty or literally 'default' and we have an authenticated user,
-- fall back to profiles.active_workspace_id. This guarantees correctness
-- even before users re-login to pick up new JWT claims, and handles the
-- multi-tab case where tab B holds a stale JWT.

create or replace function public.get_my_workspace()
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  claims jsonb;
  claim_workspace text;
  profile_workspace text;
  uid uuid;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception
    when others then
      claims := null;
  end;

  claim_workspace := coalesce(
    claims ->> 'workspace_id',
    claims -> 'app_metadata' ->> 'workspace_id',
    claims -> 'user_metadata' ->> 'workspace_id'
  );

  -- Fast path: claim present and not the bare 'default' fallback
  if claim_workspace is not null
     and claim_workspace <> ''
     and claim_workspace <> 'default'
  then
    return claim_workspace;
  end if;

  -- DB fallback: read active_workspace_id from profiles
  uid := auth.uid();
  if uid is not null then
    select active_workspace_id into profile_workspace
    from public.profiles
    where id = uid;

    if profile_workspace is not null and profile_workspace <> '' then
      return profile_workspace;
    end if;
  end if;

  -- Final fallback: preserve legacy 'default' behavior for unauthenticated
  -- contexts (cron, service role without impersonation, etc.)
  return coalesce(nullif(claim_workspace, ''), 'default');
end;
$$;

revoke execute on function public.get_my_workspace() from public;
grant execute on function public.get_my_workspace() to authenticated, service_role;

-- ── 8. set_active_workspace(target text) RPC ────────────────────────────────
-- Frontend calls this when the user picks a different dealership in the
-- WorkspaceSwitcher. Validates membership, updates the profile (which fires
-- both triggers above), and returns the new active workspace.

create or replace function public.set_active_workspace(target text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if target is null or target = '' then
    raise exception 'target workspace is required';
  end if;

  if not exists (
    select 1 from public.profile_workspaces
    where profile_id = uid and workspace_id = target
  ) then
    raise exception 'not a member of workspace %', target;
  end if;

  update public.profiles
  set active_workspace_id = target
  where id = uid;

  return target;
end;
$$;

revoke execute on function public.set_active_workspace(text) from public;
grant execute on function public.set_active_workspace(text) to authenticated;

-- ── 9. Extend handle_new_user() to bootstrap identity ───────────────────────
-- New signups get: (1) a profile row (already handled), (2) a 'default'
-- profile_workspaces membership so the validation trigger passes, and
-- (3) active_workspace_id = 'default'. The sync trigger then seeds their
-- raw_app_meta_data automatically on first insert.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Seed membership first so the validation trigger on profiles.active_workspace_id passes.
  insert into public.profile_workspaces (profile_id, workspace_id)
  values (new.id, 'default')
  on conflict do nothing;

  insert into public.profiles (id, email, full_name, active_workspace_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'default'
  );

  return new;
end;
$$;
