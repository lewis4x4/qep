-- Fix infinite recursion in profiles RLS policies.
-- The elevated-access policies query public.profiles to check the caller's
-- role, which re-triggers RLS evaluation and creates an infinite loop.
-- Solution: a SECURITY DEFINER function that bypasses RLS for the role lookup.

-- Helper: returns the current user's role without triggering RLS
create or replace function public.get_my_role()
returns public.user_role
language sql
security definer
stable
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Revoke execute from public, grant only to authenticated
revoke execute on function public.get_my_role() from public;
grant execute on function public.get_my_role() to authenticated;

-- Drop and recreate the recursive policies
drop policy if exists "profiles_select_elevated" on public.profiles;
create policy "profiles_select_elevated" on public.profiles
  for select using (
    public.get_my_role() in ('owner', 'manager', 'admin')
  );

drop policy if exists "profiles_update_role_owner" on public.profiles;
create policy "profiles_update_role_owner" on public.profiles
  for update using (
    public.get_my_role() = 'owner'
  );

-- Also fix the same pattern in profiles_update_active_owner (migration 004)
drop policy if exists "profiles_update_active_owner" on public.profiles;
