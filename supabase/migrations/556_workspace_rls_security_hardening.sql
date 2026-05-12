-- Harden elevated CRM/QB policies so privileged users remain tenant-scoped.
--
-- IMPORTANT: Per migration 170 the CRM tables were renamed crm_* -> qrm_* and
-- compatibility views (with the same crm_* names) were created over them.
-- RLS policies followed the underlying tables on rename and therefore live on
-- the qrm_* tables today, even though their policy *names* still start with
-- "crm_". This migration targets the real qrm_* tables. The qb_*_audit tables
-- were never renamed, so we keep those names as-is.

drop policy if exists "crm_companies_all_elevated" on public.qrm_companies;
create policy "crm_companies_all_elevated" on public.qrm_companies for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_contacts_all_elevated" on public.qrm_contacts;
create policy "crm_contacts_all_elevated" on public.qrm_contacts for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_contact_companies_all_elevated" on public.qrm_contact_companies;
create policy "crm_contact_companies_all_elevated" on public.qrm_contact_companies for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_deal_stages_select_all_roles" on public.qrm_deal_stages;
create policy "crm_deal_stages_select_all_roles" on public.qrm_deal_stages for select
  using ((select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_deal_stages_modify_elevated" on public.qrm_deal_stages;
create policy "crm_deal_stages_modify_elevated" on public.qrm_deal_stages for all
  using ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_deals_all_elevated" on public.qrm_deals;
create policy "crm_deals_all_elevated" on public.qrm_deals for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_activities_all_elevated" on public.qrm_activities;
create policy "crm_activities_all_elevated" on public.qrm_activities for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_contact_tags_all_elevated" on public.qrm_contact_tags;
create policy "crm_contact_tags_all_elevated" on public.qrm_contact_tags for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_territories_all_elevated" on public.qrm_territories;
create policy "crm_territories_all_elevated" on public.qrm_territories for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_contact_territories_all_elevated" on public.qrm_contact_territories;
create policy "crm_contact_territories_all_elevated" on public.qrm_contact_territories for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_auth_audit_events_select_elevated" on public.qrm_auth_audit_events;
create policy "crm_auth_audit_events_select_elevated" on public.qrm_auth_audit_events for select
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_external_id_map_admin_owner_select" on public.qrm_external_id_map;
create policy "crm_external_id_map_admin_owner_select" on public.qrm_external_id_map for select
  using ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_equipment_all_elevated" on public.qrm_equipment;
create policy "crm_equipment_all_elevated" on public.qrm_equipment for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_custom_field_definitions_read_all_elevated" on public.qrm_custom_field_definitions;
create policy "crm_custom_field_definitions_read_all_elevated" on public.qrm_custom_field_definitions for select
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_custom_field_definitions_modify_elevated" on public.qrm_custom_field_definitions;
create policy "crm_custom_field_definitions_modify_elevated" on public.qrm_custom_field_definitions for all
  using ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_custom_field_values_all_elevated" on public.qrm_custom_field_values;
create policy "crm_custom_field_values_all_elevated" on public.qrm_custom_field_values for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_duplicate_candidates_all_elevated" on public.qrm_duplicate_candidates;
create policy "crm_duplicate_candidates_all_elevated" on public.qrm_duplicate_candidates for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_merge_audit_events_elevated_select" on public.qrm_merge_audit_events;
create policy "crm_merge_audit_events_elevated_select" on public.qrm_merge_audit_events for select
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "qb_quotes_audit_select" on public.qb_quotes_audit;
create policy "qb_quotes_audit_select" on public.qb_quotes_audit for select
  using ((select public.get_my_role()) in ('admin','manager','owner') and snapshot ->> 'workspace_id' = (select public.get_my_workspace()));
drop policy if exists "qb_deals_audit_select" on public.qb_deals_audit;
create policy "qb_deals_audit_select" on public.qb_deals_audit for select
  using ((select public.get_my_role()) in ('admin','manager','owner') and snapshot ->> 'workspace_id' = (select public.get_my_workspace()));
drop policy if exists "qb_brands_audit_select" on public.qb_brands_audit;
create policy "qb_brands_audit_select" on public.qb_brands_audit for select
  using ((select public.get_my_role()) in ('admin','manager','owner') and coalesce(snapshot ->> 'workspace_id', (select public.get_my_workspace())) = (select public.get_my_workspace()));
drop policy if exists "qb_equipment_models_audit_select" on public.qb_equipment_models_audit;
create policy "qb_equipment_models_audit_select" on public.qb_equipment_models_audit for select
  using ((select public.get_my_role()) in ('admin','manager','owner') and coalesce(snapshot ->> 'workspace_id', (select public.get_my_workspace())) = (select public.get_my_workspace()));
drop policy if exists "qb_attachments_audit_select" on public.qb_attachments_audit;
create policy "qb_attachments_audit_select" on public.qb_attachments_audit for select
  using ((select public.get_my_role()) in ('admin','manager','owner') and coalesce(snapshot ->> 'workspace_id', (select public.get_my_workspace())) = (select public.get_my_workspace()));
drop policy if exists "qb_programs_audit_select" on public.qb_programs_audit;
create policy "qb_programs_audit_select" on public.qb_programs_audit for select
  using ((select public.get_my_role()) in ('admin','manager','owner') and coalesce(snapshot ->> 'workspace_id', (select public.get_my_workspace())) = (select public.get_my_workspace()));
drop policy if exists "qb_price_sheets_audit_select" on public.qb_price_sheets_audit;
create policy "qb_price_sheets_audit_select" on public.qb_price_sheets_audit for select
  using ((select public.get_my_role()) in ('admin','manager','owner') and snapshot ->> 'workspace_id' = (select public.get_my_workspace()));
