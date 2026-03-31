-- Keep crm_contacts.primary_company_id and crm_contact_companies.is_primary in sync.

create or replace function public.sync_crm_contact_primary_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_contact_companies
  set is_primary = false
  where workspace_id = new.workspace_id
    and contact_id = new.id
    and is_primary;

  if new.primary_company_id is not null then
    insert into public.crm_contact_companies (
      workspace_id,
      contact_id,
      company_id,
      is_primary
    )
    values (
      new.workspace_id,
      new.id,
      new.primary_company_id,
      true
    )
    on conflict (workspace_id, contact_id, company_id)
    do update set is_primary = true;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_crm_contact_primary_company on public.crm_contacts;

create trigger sync_crm_contact_primary_company
after insert or update of primary_company_id, workspace_id on public.crm_contacts
for each row
execute function public.sync_crm_contact_primary_company();

-- Rollback (do not execute -- reference only)
-- drop trigger if exists sync_crm_contact_primary_company on public.crm_contacts;
-- drop function if exists public.sync_crm_contact_primary_company();
