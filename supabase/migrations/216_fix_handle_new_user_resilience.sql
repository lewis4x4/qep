-- ============================================================================
-- Migration 216: Fix handle_new_user() trigger resilience
--
-- The on_auth_user_created trigger was failing because:
--   1. sync_profile_to_auth_metadata (AFTER INSERT on profiles) writes to
--      auth.users, which can fail if the SECURITY DEFINER context isn't
--      fully set up during GoTrue's internal transaction.
--   2. Any exception in the trigger chain rolls back the entire auth.users
--      INSERT, producing "Database error creating new user".
--
-- Fix: wrap handle_new_user() body in exception handling so that auth user
-- creation always succeeds. The profile can be repaired later via the
-- admin edge function. The sync_profile_to_auth_metadata trigger is also
-- made resilient to auth.users write failures.
-- ============================================================================

-- ── 1. Make handle_new_user() resilient ──────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Seed workspace membership so the validation trigger on profiles passes.
  begin
    insert into public.profile_workspaces (profile_id, workspace_id)
    values (new.id, 'default')
    on conflict do nothing;
  exception
    when others then
      raise log 'handle_new_user: profile_workspaces insert failed for %: %', new.id, sqlerrm;
      -- Continue — profile insert will fail gracefully too
  end;

  begin
    insert into public.profiles (id, email, full_name, active_workspace_id)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', new.email),
      'default'
    );
  exception
    when unique_violation then
      -- Profile already exists (e.g., retry or manual backfill) — update instead
      begin
        update public.profiles
        set email = new.email,
            full_name = coalesce(new.raw_user_meta_data->>'full_name', new.email)
        where id = new.id;
      exception
        when others then
          raise log 'handle_new_user: profile update failed for %: %', new.id, sqlerrm;
      end;
    when others then
      raise log 'handle_new_user: profile insert failed for %: %', new.id, sqlerrm;
      -- Don't re-raise — let the auth user creation succeed
  end;

  return new;
end;
$$;

-- ── 2. Make sync_profile_to_auth_metadata resilient ──────────────────────────

create or replace function public.sync_profile_to_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No-op guard: on UPDATE, only propagate when a tracked field actually changed.
  if tg_op = 'UPDATE'
     and OLD.active_workspace_id is not distinct from NEW.active_workspace_id
     and OLD.iron_role is not distinct from NEW.iron_role
     and OLD.role is not distinct from NEW.role
  then
    return NEW;
  end if;

  begin
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object(
           'workspace_id', NEW.active_workspace_id,
           'iron_role',    NEW.iron_role,
           'role',         NEW.role::text
         )
    where id = NEW.id;
  exception
    when others then
      raise log 'sync_profile_to_auth_metadata: failed for %: %', NEW.id, sqlerrm;
      -- Don't re-raise — profile writes must not be blocked by auth metadata failures
  end;

  return NEW;
end;
$$;
