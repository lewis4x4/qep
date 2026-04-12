-- Fix the crm_activity_templates soft-delete path so elevated workspace roles
-- can archive templates while reps stay limited to active rows and archived
-- templates remain immutable.

drop policy if exists "crm_activity_templates_select_workspace" on public.crm_activity_templates;
drop policy if exists "crm_activity_templates_select_rep_workspace" on public.crm_activity_templates;
drop policy if exists "crm_activity_templates_select_elevated_workspace" on public.crm_activity_templates;
drop policy if exists "crm_activity_templates_elevated_update_workspace" on public.crm_activity_templates;
drop policy if exists "crm_activity_templates_elevated_archive_workspace" on public.crm_activity_templates;

create policy "crm_activity_templates_select_rep_workspace"
  on public.crm_activity_templates
  for select
  using (
    public.get_my_role() = 'rep'
    and workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

create policy "crm_activity_templates_select_elevated_workspace"
  on public.crm_activity_templates
  for select
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create policy "crm_activity_templates_elevated_update_workspace"
  on public.crm_activity_templates
  for update
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
    and (
      deleted_at is null
      or (is_active = false and deleted_at is not null)
    )
  );

create or replace function public.crm_activity_templates_block_archived_updates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'Archived CRM activity templates cannot be modified.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists crm_activity_templates_block_archived_updates on public.crm_activity_templates;
create trigger crm_activity_templates_block_archived_updates
  before update on public.crm_activity_templates
  for each row execute function public.crm_activity_templates_block_archived_updates();

-- Rollback (do not execute automatically)
-- drop trigger if exists crm_activity_templates_block_archived_updates on public.crm_activity_templates;
-- drop function if exists public.crm_activity_templates_block_archived_updates();
-- drop policy if exists "crm_activity_templates_elevated_update_workspace" on public.crm_activity_templates;
-- drop policy if exists "crm_activity_templates_select_elevated_workspace" on public.crm_activity_templates;
-- drop policy if exists "crm_activity_templates_select_rep_workspace" on public.crm_activity_templates;
-- create policy "crm_activity_templates_select_workspace"
--   on public.crm_activity_templates
--   for select
--   using (
--     public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
--     and workspace_id = public.get_my_workspace()
--     and deleted_at is null
--   );
-- create policy "crm_activity_templates_elevated_update_workspace"
--   on public.crm_activity_templates
--   for update
--   using (
--     public.get_my_role() in ('admin', 'manager', 'owner')
--     and workspace_id = public.get_my_workspace()
--     and deleted_at is null
--   )
--   with check (
--     public.get_my_role() in ('admin', 'manager', 'owner')
--     and workspace_id = public.get_my_workspace()
--   );
