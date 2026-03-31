-- Archive core CRM records atomically with dependency checks
-- and block new links to archived records.

create or replace function public.crm_assert_active_reference()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_record_type text := tg_argv[0];
  v_column_name text := tg_argv[1];
  v_reference_id uuid;
  v_deleted_at timestamptz;
begin
  v_reference_id := nullif(to_jsonb(new) ->> v_column_name, '')::uuid;

  if v_reference_id is null then
    return new;
  end if;

  if v_record_type = 'contact' then
    select deleted_at
    into v_deleted_at
    from public.crm_contacts
    where id = v_reference_id
    for key share;
  elsif v_record_type = 'company' then
    select deleted_at
    into v_deleted_at
    from public.crm_companies
    where id = v_reference_id
    for key share;
  elsif v_record_type = 'deal' then
    select deleted_at
    into v_deleted_at
    from public.crm_deals
    where id = v_reference_id
    for key share;
  else
    raise exception 'UNKNOWN_REFERENCE_TYPE';
  end if;

  if not found or v_deleted_at is not null then
    raise exception 'ARCHIVED_REFERENCE_NOT_ALLOWED';
  end if;

  return new;
end;
$$;

create or replace function public.archive_crm_contact(
  p_contact_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_contact public.crm_contacts%rowtype;
  v_workspace_id uuid;
begin
  select *
  into v_contact
  from public.crm_contacts
  where id = p_contact_id
    and deleted_at is null;
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  v_workspace_id := v_contact.workspace_id;

  if exists (
    select 1
    from public.crm_deals
    where workspace_id = v_workspace_id
      and primary_contact_id = p_contact_id
      and deleted_at is null
  ) then
    raise exception 'CONTACT_ARCHIVE_HAS_DEALS';
  end if;

  if exists (
    select 1
    from public.crm_equipment
    where workspace_id = v_workspace_id
      and primary_contact_id = p_contact_id
      and deleted_at is null
  ) then
    raise exception 'CONTACT_ARCHIVE_HAS_EQUIPMENT';
  end if;

  update public.crm_contacts
  set deleted_at = now()
  where id = p_contact_id
    and deleted_at is null
  returning * into v_contact;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_contact.id,
    'workspaceId', v_contact.workspace_id,
    'dgeCustomerProfileId', v_contact.dge_customer_profile_id,
    'firstName', v_contact.first_name,
    'lastName', v_contact.last_name,
    'email', v_contact.email,
    'phone', v_contact.phone,
    'title', v_contact.title,
    'primaryCompanyId', v_contact.primary_company_id,
    'assignedRepId', v_contact.assigned_rep_id,
    'mergedIntoContactId', v_contact.merged_into_contact_id,
    'createdAt', v_contact.created_at,
    'updatedAt', v_contact.updated_at
  );
end;
$$;

create or replace function public.archive_crm_company(
  p_company_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company public.crm_companies%rowtype;
  v_workspace_id uuid;
begin
  select *
  into v_company
  from public.crm_companies
  where id = p_company_id
    and deleted_at is null;
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  v_workspace_id := v_company.workspace_id;

  if exists (
    select 1
    from public.crm_companies
    where workspace_id = v_workspace_id
      and parent_company_id = p_company_id
      and deleted_at is null
  ) then
    raise exception 'COMPANY_ARCHIVE_HAS_CHILDREN';
  end if;

  if exists (
    select 1
    from public.crm_contacts
    where workspace_id = v_workspace_id
      and primary_company_id = p_company_id
      and deleted_at is null
  ) then
    raise exception 'COMPANY_ARCHIVE_HAS_CONTACTS';
  end if;

  if exists (
    select 1
    from public.crm_deals
    where workspace_id = v_workspace_id
      and company_id = p_company_id
      and deleted_at is null
  ) then
    raise exception 'COMPANY_ARCHIVE_HAS_DEALS';
  end if;

  if exists (
    select 1
    from public.crm_equipment
    where workspace_id = v_workspace_id
      and company_id = p_company_id
      and deleted_at is null
  ) then
    raise exception 'COMPANY_ARCHIVE_HAS_EQUIPMENT';
  end if;

  update public.crm_companies
  set deleted_at = now()
  where id = p_company_id
    and deleted_at is null
  returning * into v_company;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_company.id,
    'workspaceId', v_company.workspace_id,
    'name', v_company.name,
    'parentCompanyId', v_company.parent_company_id,
    'assignedRepId', v_company.assigned_rep_id,
    'addressLine1', v_company.address_line_1,
    'addressLine2', v_company.address_line_2,
    'city', v_company.city,
    'state', v_company.state,
    'postalCode', v_company.postal_code,
    'country', v_company.country,
    'createdAt', v_company.created_at,
    'updatedAt', v_company.updated_at
  );
end;
$$;

create or replace function public.archive_crm_deal(
  p_deal_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deal public.crm_deals%rowtype;
  v_workspace_id uuid;
begin
  select *
  into v_deal
  from public.crm_deals
  where id = p_deal_id
    and deleted_at is null;
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  v_workspace_id := v_deal.workspace_id;

  if exists (
    select 1
    from public.crm_quotes
    where workspace_id = v_workspace_id
      and crm_deal_id = p_deal_id
      and deleted_at is null
      and status <> 'archived'
  ) then
    raise exception 'DEAL_ARCHIVE_HAS_QUOTES';
  end if;

  if exists (
    select 1
    from public.sequence_enrollments
    where workspace_id = v_workspace_id
      and deal_id = p_deal_id
      and status in ('active', 'paused')
  ) then
    raise exception 'DEAL_ARCHIVE_HAS_SEQUENCES';
  end if;

  update public.crm_deals
  set deleted_at = now()
  where id = p_deal_id
    and deleted_at is null
  returning * into v_deal;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_deal.id,
    'workspaceId', v_deal.workspace_id,
    'name', v_deal.name,
    'stageId', v_deal.stage_id,
    'primaryContactId', v_deal.primary_contact_id,
    'companyId', v_deal.company_id,
    'assignedRepId', v_deal.assigned_rep_id,
    'amount', v_deal.amount,
    'expectedCloseOn', v_deal.expected_close_on,
    'nextFollowUpAt', v_deal.next_follow_up_at,
    'lastActivityAt', v_deal.last_activity_at,
    'closedAt', v_deal.closed_at,
    'hubspotDealId', v_deal.hubspot_deal_id,
    'createdAt', v_deal.created_at,
    'updatedAt', v_deal.updated_at
  );
end;
$$;

drop trigger if exists crm_deals_primary_contact_active_reference on public.crm_deals;
create trigger crm_deals_primary_contact_active_reference
before insert or update of primary_contact_id on public.crm_deals
for each row execute function public.crm_assert_active_reference('contact', 'primary_contact_id');

drop trigger if exists crm_equipment_primary_contact_active_reference on public.crm_equipment;
create trigger crm_equipment_primary_contact_active_reference
before insert or update of primary_contact_id on public.crm_equipment
for each row execute function public.crm_assert_active_reference('contact', 'primary_contact_id');

drop trigger if exists crm_contacts_primary_company_active_reference on public.crm_contacts;
create trigger crm_contacts_primary_company_active_reference
before insert or update of primary_company_id on public.crm_contacts
for each row execute function public.crm_assert_active_reference('company', 'primary_company_id');

drop trigger if exists crm_companies_parent_active_reference on public.crm_companies;
create trigger crm_companies_parent_active_reference
before insert or update of parent_company_id on public.crm_companies
for each row execute function public.crm_assert_active_reference('company', 'parent_company_id');

drop trigger if exists crm_deals_company_active_reference on public.crm_deals;
create trigger crm_deals_company_active_reference
before insert or update of company_id on public.crm_deals
for each row execute function public.crm_assert_active_reference('company', 'company_id');

drop trigger if exists crm_equipment_company_active_reference on public.crm_equipment;
create trigger crm_equipment_company_active_reference
before insert or update of company_id on public.crm_equipment
for each row execute function public.crm_assert_active_reference('company', 'company_id');

drop trigger if exists crm_quotes_deal_active_reference on public.crm_quotes;
create trigger crm_quotes_deal_active_reference
before insert or update of crm_deal_id on public.crm_quotes
for each row execute function public.crm_assert_active_reference('deal', 'crm_deal_id');

drop trigger if exists sequence_enrollments_deal_active_reference on public.sequence_enrollments;
create trigger sequence_enrollments_deal_active_reference
before insert or update of deal_id on public.sequence_enrollments
for each row execute function public.crm_assert_active_reference('deal', 'deal_id');

-- Rollback (do not execute -- reference only)
-- drop trigger if exists sequence_enrollments_deal_active_reference on public.sequence_enrollments;
-- drop trigger if exists crm_quotes_deal_active_reference on public.crm_quotes;
-- drop trigger if exists crm_equipment_company_active_reference on public.crm_equipment;
-- drop trigger if exists crm_deals_company_active_reference on public.crm_deals;
-- drop trigger if exists crm_companies_parent_active_reference on public.crm_companies;
-- drop trigger if exists crm_contacts_primary_company_active_reference on public.crm_contacts;
-- drop trigger if exists crm_equipment_primary_contact_active_reference on public.crm_equipment;
-- drop trigger if exists crm_deals_primary_contact_active_reference on public.crm_deals;
-- drop function if exists public.archive_crm_deal(uuid);
-- drop function if exists public.archive_crm_company(uuid);
-- drop function if exists public.archive_crm_contact(uuid);
-- drop function if exists public.crm_assert_active_reference();
