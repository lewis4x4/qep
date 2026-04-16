-- ============================================================================
-- Migration 282: post_sale_parts_playbooks RLS hardening (post-3.6 audit P0)
--
-- Migration 280 created post_sale_parts_playbooks with FOR SELECT and
-- FOR UPDATE policies but the UPDATE policy only had USING (pre-update
-- filter) — no WITH CHECK (post-update filter). A user could therefore
-- UPDATE their own row and set assigned_rep_id / workspace_id to values
-- that would take the row out of their own scope.
--
-- Explicit INSERT + DELETE policies are added with false / restrictive
-- predicates so PostgREST callers can't add or remove rows directly.
-- The service-role client used by the edge function bypasses RLS and
-- retains full control for the Claude-generated upsert path.
-- ============================================================================

-- UPDATE policy: rewrite with WITH CHECK so updated rows can't escape scope.
drop policy if exists post_sale_playbooks_update on public.post_sale_parts_playbooks;
create policy post_sale_playbooks_update on public.post_sale_parts_playbooks
  for update
  using (
    deleted_at is null
    and (
      assigned_rep_id = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('admin','manager','owner')
      )
    )
  )
  with check (
    -- Row must STILL be in caller's scope after the update
    assigned_rep_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin','manager','owner')
    )
  );

-- Explicit INSERT deny for PostgREST callers.
drop policy if exists post_sale_playbooks_no_insert on public.post_sale_parts_playbooks;
create policy post_sale_playbooks_no_insert on public.post_sale_parts_playbooks
  for insert
  with check (false);

-- Explicit DELETE deny for PostgREST callers.
drop policy if exists post_sale_playbooks_no_delete on public.post_sale_parts_playbooks;
create policy post_sale_playbooks_no_delete on public.post_sale_parts_playbooks
  for delete
  using (false);

-- Revoke write privileges from authenticated/anon for belt-and-suspenders
-- (RLS already blocks; grants make the boundary legible).
revoke insert, delete on public.post_sale_parts_playbooks from authenticated, anon;
-- UPDATE stays granted so the RLS policy applies; without the grant PostgREST
-- would reject before RLS runs and rep status-flip actions would 403.

-- ============================================================================
-- Migration 282 complete.
-- ============================================================================
