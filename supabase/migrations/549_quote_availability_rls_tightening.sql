-- ============================================================================
-- 549_quote_availability_rls_tightening.sql
--
-- Tightens quote availability read policies so reps cannot browse every
-- availability request in a workspace through direct RLS. Managers/admins/
-- owners keep queue visibility; reps can read their own requests or requests
-- tied to quote packages they can access.
-- ============================================================================

drop policy if exists "qar_select" on public.quote_availability_requests;
create policy "qar_select" on public.quote_availability_requests
  for select using (
    workspace_id = (select public.get_my_workspace())
    and (
      (select public.get_my_role()) in ('admin', 'manager', 'owner')
      or requested_by = (select auth.uid())
      or (
        quote_package_id is not null
        and public.quote_package_accessible_to_me(quote_package_id)
      )
    )
  );

drop policy if exists "qacand_select" on public.quote_availability_candidates;
create policy "qacand_select" on public.quote_availability_candidates
  for select using (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.quote_availability_requests request
      where request.id = quote_availability_candidates.request_id
        and request.workspace_id = quote_availability_candidates.workspace_id
        and (
          (select public.get_my_role()) in ('admin', 'manager', 'owner')
          or request.requested_by = (select auth.uid())
          or (
            request.quote_package_id is not null
            and public.quote_package_accessible_to_me(request.quote_package_id)
          )
        )
    )
  );

drop policy if exists "qae_select" on public.quote_availability_events;
create policy "qae_select" on public.quote_availability_events
  for select using (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.quote_availability_requests request
      where request.id = quote_availability_events.request_id
        and request.workspace_id = quote_availability_events.workspace_id
        and (
          (select public.get_my_role()) in ('admin', 'manager', 'owner')
          or request.requested_by = (select auth.uid())
          or (
            request.quote_package_id is not null
            and public.quote_package_accessible_to_me(request.quote_package_id)
          )
        )
    )
  );
