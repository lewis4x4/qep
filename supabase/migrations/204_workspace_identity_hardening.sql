-- ============================================================================
-- Migration 204: Workspace Identity Hardening
--
-- Tightens the identity chain introduced in 203:
--   profiles.active_workspace_id is the authenticated user's source of truth
--   get_my_workspace() prefers DB state for authenticated callers
--   deleting a profile_workspaces row cannot strand active_workspace_id
--   set_active_workspace() must update a profile row or fail loudly
-- ============================================================================

-- ── 1. Helper: choose the best remaining workspace for a profile ────────────

create or replace function public.pick_profile_active_workspace(target_profile_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (
      select 'default'
      from public.profile_workspaces pw
      where pw.profile_id = target_profile_id
        and pw.workspace_id = 'default'
      limit 1
    ),
    (
      select pw.workspace_id
      from public.profile_workspaces pw
      where pw.profile_id = target_profile_id
      order by pw.workspace_id asc
      limit 1
    )
  );
$$;

-- ── 2. Keep active_workspace_id valid when memberships change ───────────────

create or replace function public.reconcile_profile_active_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_active text;
  replacement text;
begin
  select active_workspace_id into current_active
  from public.profiles
  where id = OLD.profile_id;

  if current_active is null then
    return OLD;
  end if;

  if exists (
    select 1
    from public.profile_workspaces pw
    where pw.profile_id = OLD.profile_id
      and pw.workspace_id = current_active
  ) then
    return OLD;
  end if;

  replacement := public.pick_profile_active_workspace(OLD.profile_id);
  if replacement is null then
    raise exception 'cannot remove the last workspace membership for profile %', OLD.profile_id;
  end if;

  update public.profiles
  set active_workspace_id = replacement
  where id = OLD.profile_id;

  return OLD;
end;
$$;

drop trigger if exists reconcile_profile_active_workspace on public.profile_workspaces;
create trigger reconcile_profile_active_workspace
  after delete on public.profile_workspaces
  for each row
  execute function public.reconcile_profile_active_workspace();

-- ── 3. Repair any inconsistent profile rows from pre-hardening behavior ─────

update public.profiles p
set active_workspace_id = resolved.workspace_id
from (
  select p0.id, public.pick_profile_active_workspace(p0.id) as workspace_id
  from public.profiles p0
) as resolved
where p.id = resolved.id
  and resolved.workspace_id is not null
  and not exists (
    select 1
    from public.profile_workspaces pw
    where pw.profile_id = p.id
      and pw.workspace_id = p.active_workspace_id
  );

-- ── 4. Make DB state authoritative for authenticated callers ────────────────

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

  uid := auth.uid();
  if uid is not null then
    select active_workspace_id into profile_workspace
    from public.profiles
    where id = uid;

    -- Authenticated callers obey the profile row even when the JWT is stale.
    if profile_workspace is not null and profile_workspace <> '' then
      return profile_workspace;
    end if;
  end if;

  if claim_workspace is not null and claim_workspace <> '' then
    return claim_workspace;
  end if;

  return 'default';
end;
$$;

revoke execute on function public.get_my_workspace() from public;
grant execute on function public.get_my_workspace() to authenticated, service_role;

-- ── 5. Fail loudly if set_active_workspace touches no profile row ───────────

create or replace function public.set_active_workspace(target text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  updated_workspace text;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if target is null or target = '' then
    raise exception 'target workspace is required';
  end if;

  if not exists (
    select 1
    from public.profile_workspaces
    where profile_id = uid
      and workspace_id = target
  ) then
    raise exception 'not a member of workspace %', target;
  end if;

  update public.profiles
  set active_workspace_id = target
  where id = uid
  returning active_workspace_id into updated_workspace;

  if updated_workspace is null then
    raise exception 'profile % is missing; cannot set active workspace', uid;
  end if;

  return updated_workspace;
end;
$$;

revoke execute on function public.set_active_workspace(text) from public;
grant execute on function public.set_active_workspace(text) to authenticated;

-- ── 6. Refresh auth metadata set-wise after reconciliation ──────────────────

update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
       'workspace_id', p.active_workspace_id,
       'iron_role', p.iron_role,
       'role', p.role::text
     )
from public.profiles p
where p.id = u.id;
