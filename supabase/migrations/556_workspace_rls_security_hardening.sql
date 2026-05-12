-- Harden elevated CRM/QB policies so privileged users remain tenant-scoped.

drop policy if exists "crm_companies_all_elevated" on public.crm_companies;
create policy "crm_companies_all_elevated" on public.crm_companies for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_contacts_all_elevated" on public.crm_contacts;
create policy "crm_contacts_all_elevated" on public.crm_contacts for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_contact_companies_all_elevated" on public.crm_contact_companies;
create policy "crm_contact_companies_all_elevated" on public.crm_contact_companies for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_deal_stages_select_all_roles" on public.crm_deal_stages;
create policy "crm_deal_stages_select_all_roles" on public.crm_deal_stages for select
  using ((select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_deal_stages_modify_elevated" on public.crm_deal_stages;
create policy "crm_deal_stages_modify_elevated" on public.crm_deal_stages for all
  using ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_deals_all_elevated" on public.crm_deals;
create policy "crm_deals_all_elevated" on public.crm_deals for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_activities_all_elevated" on public.crm_activities;
create policy "crm_activities_all_elevated" on public.crm_activities for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_contact_tags_all_elevated" on public.crm_contact_tags;
create policy "crm_contact_tags_all_elevated" on public.crm_contact_tags for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_territories_all_elevated" on public.crm_territories;
create policy "crm_territories_all_elevated" on public.crm_territories for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_contact_territories_all_elevated" on public.crm_contact_territories;
create policy "crm_contact_territories_all_elevated" on public.crm_contact_territories for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_auth_audit_events_select_elevated" on public.crm_auth_audit_events;
create policy "crm_auth_audit_events_select_elevated" on public.crm_auth_audit_events for select
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_external_id_map_admin_owner_select" on public.crm_external_id_map;
create policy "crm_external_id_map_admin_owner_select" on public.crm_external_id_map for select
  using ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_equipment_all_elevated" on public.crm_equipment;
create policy "crm_equipment_all_elevated" on public.crm_equipment for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_custom_field_definitions_read_all_elevated" on public.crm_custom_field_definitions;
create policy "crm_custom_field_definitions_read_all_elevated" on public.crm_custom_field_definitions for select
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_custom_field_definitions_modify_elevated" on public.crm_custom_field_definitions;
create policy "crm_custom_field_definitions_modify_elevated" on public.crm_custom_field_definitions for all
  using ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_custom_field_values_all_elevated" on public.crm_custom_field_values;
create policy "crm_custom_field_values_all_elevated" on public.crm_custom_field_values for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_duplicate_candidates_all_elevated" on public.crm_duplicate_candidates;
create policy "crm_duplicate_candidates_all_elevated" on public.crm_duplicate_candidates for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

drop policy if exists "crm_merge_audit_events_elevated_select" on public.crm_merge_audit_events;
create policy "crm_merge_audit_events_elevated_select" on public.crm_merge_audit_events for select
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
