-- ============================================================================
-- 543_qrm_quote_wizard_rls_initplan_fix.sql
--
-- Recreate QRM quote wizard policies with initplan-safe helper calls. Migration
-- 542 introduced the tables and policies; this follow-up keeps deployed
-- databases aligned with the repository's RLS initplan audit while preserving
-- the same access model.
-- ============================================================================

set statement_timeout = 0;

-- ── Tax jurisdictions ───────────────────────────────────────────────────────

drop policy if exists "tax_jurisdictions_select" on public.tax_jurisdictions;
drop policy if exists "tax_jurisdictions_manage" on public.tax_jurisdictions;
drop policy if exists "tax_jurisdictions_service" on public.tax_jurisdictions;

create policy "tax_jurisdictions_select" on public.tax_jurisdictions
  for select using (
    workspace_id = (select public.get_my_workspace())
    or workspace_id = 'global'
  );

create policy "tax_jurisdictions_manage" on public.tax_jurisdictions
  for all using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  )
  with check (workspace_id = (select public.get_my_workspace()));

create policy "tax_jurisdictions_service" on public.tax_jurisdictions
  for all to service_role using (true) with check (true);

-- ── Financing scenarios ─────────────────────────────────────────────────────

drop policy if exists "qfs_package_access" on public.quote_financing_scenarios;
drop policy if exists "qfs_service_all" on public.quote_financing_scenarios;

create policy "qfs_package_access" on public.quote_financing_scenarios
  for all using (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
  );

create policy "qfs_service_all" on public.quote_financing_scenarios
  for all to service_role using (true) with check (true);

-- ── Document artifacts ──────────────────────────────────────────────────────

drop policy if exists "qda_package_access" on public.quote_document_artifacts;
drop policy if exists "qda_service_all" on public.quote_document_artifacts;

create policy "qda_package_access" on public.quote_document_artifacts
  for all using (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
  );

create policy "qda_service_all" on public.quote_document_artifacts
  for all to service_role using (true) with check (true);

-- ── Delivery events ─────────────────────────────────────────────────────────

drop policy if exists "qde_package_access" on public.quote_delivery_events;
drop policy if exists "qde_package_select" on public.quote_delivery_events;
drop policy if exists "qde_client_preview_insert" on public.quote_delivery_events;
drop policy if exists "qde_service_all" on public.quote_delivery_events;

create policy "qde_package_select" on public.quote_delivery_events
  for select using (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
  );

create policy "qde_client_preview_insert" on public.quote_delivery_events
  for insert with check (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
    and channel = 'preview'
    and status = 'draft'
    and coalesce(provider, '') = 'local_preview'
  );

create policy "qde_service_all" on public.quote_delivery_events
  for all to service_role using (true) with check (true);
