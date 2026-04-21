-- ============================================================================
-- Migration 319: Hub — tighten hub_comments insert policy
--
-- Fixes the asymmetry in migration 312: the original insert policy granted
-- managers permission to insert internal (is_internal=true) comments, but
-- the update policy only allowed admin/owner to moderate. Result: managers
-- could drop private triage notes but couldn't retract them, creating a
-- moderation orphan. Post-build audit (P1).
--
-- Resolution:
--   * Stakeholders: insert non-internal comments only (unchanged).
--   * Internal managers: insert non-internal comments only (was: either flavor).
--   * Internal admin/owner: insert either flavor (unchanged).
--
-- Service role path is still covered by hub_comments_service_all.
-- ============================================================================

drop policy if exists hub_comments_insert on public.hub_comments;

create policy hub_comments_insert on public.hub_comments
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and author_id = auth.uid()
    and (
      (public.get_my_audience() = 'stakeholder' and is_internal = false)
      or (public.get_my_audience() = 'internal' and is_internal = false
          and public.get_my_role() in ('admin', 'manager', 'owner'))
      or (public.get_my_audience() = 'internal' and is_internal = true
          and public.get_my_role() in ('admin', 'owner'))
    )
  );
