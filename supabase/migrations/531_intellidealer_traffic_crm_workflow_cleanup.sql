-- 531_intellidealer_traffic_crm_workflow_cleanup.sql
--
-- Residual IntelliDealer cleanup for:
--   - traffic_ticket.mass_change_print backend print marking
--   - customer.search_extended_fields backend search toggle support
--
-- Additive/compatible: existing callers can keep using list_crm_companies_page
-- without the new p_include_extended_fields argument.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_qrm_contacts_primary_company_name_trgm
  on public.qrm_contacts
  using gin (lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) extensions.gin_trgm_ops)
  where deleted_at is null and primary_company_id is not null;
comment on index public.idx_qrm_contacts_primary_company_name_trgm is
  'Purpose: IntelliDealer Customer Search Extended Fields toggle; contact-name search by primary company.';

create index if not exists idx_qrm_company_ship_to_addresses_label_trgm
  on public.qrm_company_ship_to_addresses
  using gin (lower(label) extensions.gin_trgm_ops)
  where deleted_at is null and is_active = true;
comment on index public.idx_qrm_company_ship_to_addresses_label_trgm is
  'Purpose: IntelliDealer Customer Search Extended Fields toggle; ship-to/jobsite label search.';

create index if not exists idx_qrm_company_ship_to_addresses_contact_name_trgm
  on public.qrm_company_ship_to_addresses
  using gin (lower(coalesce(contact_name, '')) extensions.gin_trgm_ops)
  where deleted_at is null and is_active = true and contact_name is not null;
comment on index public.idx_qrm_company_ship_to_addresses_contact_name_trgm is
  'Purpose: IntelliDealer Customer Search Extended Fields toggle; ship-to contact-name search.';

drop function if exists public.list_crm_companies_page(text, text, uuid, integer);
drop function if exists public.list_crm_companies_page(text, text, uuid, integer, boolean);

create or replace function public.list_crm_companies_page(
  p_search text default null,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 25,
  p_include_extended_fields boolean default false
)
returns table (
  id uuid,
  workspace_id text,
  name text,
  parent_company_id uuid,
  assigned_rep_id uuid,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  created_at timestamptz,
  updated_at timestamptz,
  search_1 text,
  search_2 text,
  legacy_customer_number text
)
language sql
security invoker
set search_path = public
as $$
  with normalized as (
    select
      nullif(trim(coalesce(p_search, '')), '') as search_term,
      nullif(replace(replace(trim(coalesce(p_search, '')), '%', ''), '_', ''), '') as search_like,
      nullif(replace(replace(lower(trim(coalesce(p_search, ''))), '%', ''), '_', ''), '') as search_prefix
  )
  select
    c.id,
    c.workspace_id,
    c.name,
    c.parent_company_id,
    c.assigned_rep_id,
    c.address_line_1,
    c.address_line_2,
    c.city,
    c.state,
    c.postal_code,
    c.country,
    c.created_at,
    c.updated_at,
    c.search_1,
    c.search_2,
    c.legacy_customer_number
  from public.crm_companies c
  cross join normalized n
  where c.deleted_at is null
    and (
      n.search_term is null
      or c.name ilike ('%' || n.search_like || '%')
      or coalesce(c.city, '') ilike ('%' || n.search_like || '%')
      or coalesce(c.state, '') ilike ('%' || n.search_like || '%')
      or coalesce(c.legacy_customer_number, '') ilike ('%' || n.search_like || '%')
      or (n.search_prefix is not null and lower(coalesce(c.search_1, '')) like (n.search_prefix || '%'))
      or (n.search_prefix is not null and lower(coalesce(c.search_2, '')) like (n.search_prefix || '%'))
      or (n.search_prefix is not null and lower(coalesce(c.legacy_customer_number, '')) like (n.search_prefix || '%'))
      or (
        coalesce(p_include_extended_fields, false)
        and (
          exists (
            select 1
            from public.crm_contacts ct
            where ct.primary_company_id = c.id
              and ct.deleted_at is null
              and (
                (coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')) ilike ('%' || n.search_like || '%')
                or coalesce(ct.first_name, '') ilike ('%' || n.search_like || '%')
                or coalesce(ct.last_name, '') ilike ('%' || n.search_like || '%')
              )
          )
          or exists (
            select 1
            from public.qrm_company_ship_to_addresses ship
            where ship.company_id = c.id
              and ship.deleted_at is null
              and ship.is_active = true
              and (
                ship.label ilike ('%' || n.search_like || '%')
                or coalesce(ship.contact_name, '') ilike ('%' || n.search_like || '%')
              )
          )
        )
      )
    )
    and (
      p_after_id is null
      or (c.name, c.id) > (p_after_name, p_after_id)
    )
  order by c.name asc, c.id asc
  limit greatest(coalesce(p_limit, 25), 1);
$$;

comment on function public.list_crm_companies_page(text, text, uuid, integer, boolean) is
  'Keyset CRM company listing. p_include_extended_fields=true extends search to contact names and active ship-to label/contact names for IntelliDealer parity.';

create or replace function public.traffic_ticket_mark_printed(
  p_ticket_ids uuid[]
)
returns table (
  id uuid,
  workspace_id text,
  receipt_number text,
  status text,
  printed_count integer,
  last_printed_at timestamptz,
  stock_number text,
  ticket_type text,
  receipt_type public.traffic_receipt_type,
  direction public.traffic_direction,
  shipping_date date,
  from_location text,
  to_location text,
  to_contact_name text,
  to_contact_phone text,
  unit_description_snapshot text,
  make_snapshot text,
  model_snapshot text,
  serial_number_snapshot text,
  ship_instructions text,
  billing_comments text
)
language sql
security invoker
set search_path = public
as $$
  with requested as (
    select distinct unnest(coalesce(p_ticket_ids, '{}'::uuid[])) as id
  ),
  updated as (
    update public.traffic_tickets t
       set printed_count = coalesce(t.printed_count, 0) + 1,
           last_printed_at = now()
      from requested r
     where t.id = r.id
       and t.workspace_id = public.get_my_workspace()
     returning
       t.id,
       t.workspace_id,
       t.receipt_number,
       t.status,
       t.printed_count,
       t.last_printed_at,
       t.stock_number,
       t.ticket_type,
       t.receipt_type,
       t.direction,
       t.shipping_date,
       t.from_location,
       t.to_location,
       t.to_contact_name,
       t.to_contact_phone,
       t.unit_description_snapshot,
       t.make_snapshot,
       t.model_snapshot,
       t.serial_number_snapshot,
       t.ship_instructions,
       t.billing_comments
  )
  select * from updated order by shipping_date asc, receipt_number asc nulls last, id asc;
$$;

comment on function public.traffic_ticket_mark_printed(uuid[]) is
  'Marks selected traffic tickets as printed and returns delivery-receipt fields for the Traffic Mass Change/Print workflow.';
