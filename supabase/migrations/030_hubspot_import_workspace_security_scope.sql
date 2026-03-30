-- Security remediation (QUA-273)
-- Enforce workspace-scoped non-service access for HubSpot import and portal
-- binding surfaces to prevent cross-workspace read/modify access.

-- ── workspace_hubspot_portal select scope ───────────────────────────────────
drop policy if exists "workspace_hubspot_portal_select_elevated"
  on public.workspace_hubspot_portal;
drop policy if exists "workspace_hubspot_portal_select_elevated_workspace"
  on public.workspace_hubspot_portal;

create policy "workspace_hubspot_portal_select_elevated_workspace"
  on public.workspace_hubspot_portal
  for select
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

-- ── crm_hubspot_import_runs scope ───────────────────────────────────────────
drop policy if exists "crm_import_runs_admin_owner_all"
  on public.crm_hubspot_import_runs;
drop policy if exists "crm_import_runs_admin_owner_all_workspace"
  on public.crm_hubspot_import_runs;
drop policy if exists "crm_import_runs_service_all"
  on public.crm_hubspot_import_runs;
drop policy if exists "crm_import_runs_service_all_workspace"
  on public.crm_hubspot_import_runs;

create policy "crm_import_runs_admin_owner_all_workspace"
  on public.crm_hubspot_import_runs
  for all
  using (
    public.get_my_role() in ('admin', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create policy "crm_import_runs_service_all_workspace"
  on public.crm_hubspot_import_runs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── crm_hubspot_import_errors scope ─────────────────────────────────────────
drop policy if exists "crm_import_errors_admin_owner_select"
  on public.crm_hubspot_import_errors;
drop policy if exists "crm_import_errors_admin_owner_select_workspace"
  on public.crm_hubspot_import_errors;
drop policy if exists "crm_import_errors_service_all"
  on public.crm_hubspot_import_errors;
drop policy if exists "crm_import_errors_service_all_workspace"
  on public.crm_hubspot_import_errors;

create policy "crm_import_errors_admin_owner_select_workspace"
  on public.crm_hubspot_import_errors
  for select
  using (
    public.get_my_role() in ('admin', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create policy "crm_import_errors_service_all_workspace"
  on public.crm_hubspot_import_errors
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Rollback notes (manual):
-- 1) Drop *_workspace policies above.
-- 2) Recreate:
--    - "workspace_hubspot_portal_select_elevated"
--    - "crm_import_runs_admin_owner_all"
--    - "crm_import_runs_service_all"
--    - "crm_import_errors_admin_owner_select"
--    - "crm_import_errors_service_all"
