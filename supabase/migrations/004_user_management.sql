-- ============================================================
-- USER MANAGEMENT — add is_active to profiles
-- ============================================================

alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- Owners can deactivate/reactivate any user
create policy "profiles_update_active_owner" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );
