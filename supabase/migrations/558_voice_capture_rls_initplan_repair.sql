-- Repair voice_captures RLS policies so auth/workspace helpers are initplan-safe
-- for already-applied databases that ran migration 557 before the wrapper fix.

drop policy if exists "voice_captures_select" on public.voice_captures;
create policy "voice_captures_select" on public.voice_captures
  for select using (
    user_id = (select auth.uid())
    or (
      workspace_id = (select public.get_my_workspace())
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role in ('admin', 'manager', 'owner')
      )
    )
  );

drop policy if exists "voice_captures_insert" on public.voice_captures;
create policy "voice_captures_insert" on public.voice_captures
  for insert with check (
    user_id = (select auth.uid())
    and (workspace_id is null or workspace_id = (select public.get_my_workspace()))
  );

drop policy if exists "voice_captures_update" on public.voice_captures;
create policy "voice_captures_update" on public.voice_captures
  for update using (
    (
      user_id = (select auth.uid())
      and (workspace_id is null or workspace_id = (select public.get_my_workspace()))
    )
    or (
      workspace_id = (select public.get_my_workspace())
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role in ('admin', 'manager', 'owner')
      )
    )
  ) with check (
    (
      user_id = (select auth.uid())
      and (workspace_id is null or workspace_id = (select public.get_my_workspace()))
    )
    or (
      workspace_id = (select public.get_my_workspace())
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role in ('admin', 'manager', 'owner')
      )
    )
  );
