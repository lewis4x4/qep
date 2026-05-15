-- Recreate IntelliDealer generic-stage policies using initplan-safe auth helpers.
-- Migration 568 created the tables and policies; this forward migration updates
-- already-applied remote environments without relying on editing migration history.

drop policy if exists "qrm_intellidealer_equipment_stage_service_all"
  on public.qrm_intellidealer_equipment_master_stage;
drop policy if exists "qrm_intellidealer_equipment_stage_elevated_all"
  on public.qrm_intellidealer_equipment_master_stage;
drop policy if exists "qrm_intellidealer_quotes_stage_service_all"
  on public.qrm_intellidealer_quotes_history_stage;
drop policy if exists "qrm_intellidealer_quotes_stage_elevated_all"
  on public.qrm_intellidealer_quotes_history_stage;
drop policy if exists "qrm_intellidealer_parts_stage_service_all"
  on public.qrm_intellidealer_parts_master_stage;
drop policy if exists "qrm_intellidealer_parts_stage_elevated_all"
  on public.qrm_intellidealer_parts_master_stage;
drop policy if exists "qrm_intellidealer_service_stage_service_all"
  on public.qrm_intellidealer_service_history_stage;
drop policy if exists "qrm_intellidealer_service_stage_elevated_all"
  on public.qrm_intellidealer_service_history_stage;

create policy "qrm_intellidealer_equipment_stage_service_all"
  on public.qrm_intellidealer_equipment_master_stage for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_equipment_stage_elevated_all"
  on public.qrm_intellidealer_equipment_master_stage for all
  using (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'))
  with check (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'));

create policy "qrm_intellidealer_quotes_stage_service_all"
  on public.qrm_intellidealer_quotes_history_stage for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_quotes_stage_elevated_all"
  on public.qrm_intellidealer_quotes_history_stage for all
  using (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'))
  with check (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'));

create policy "qrm_intellidealer_parts_stage_service_all"
  on public.qrm_intellidealer_parts_master_stage for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_parts_stage_elevated_all"
  on public.qrm_intellidealer_parts_master_stage for all
  using (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'))
  with check (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'));

create policy "qrm_intellidealer_service_stage_service_all"
  on public.qrm_intellidealer_service_history_stage for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_service_stage_elevated_all"
  on public.qrm_intellidealer_service_history_stage for all
  using (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'))
  with check (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'));
