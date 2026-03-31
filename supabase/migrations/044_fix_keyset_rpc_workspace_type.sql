-- Fix list_crm_contacts_page and list_crm_companies_page:
-- workspace_id is text (not uuid) in crm_contacts/crm_companies.
-- Casting 'default'::uuid crashes the RPC at runtime.
-- Must drop first because return type changed (uuid → text for workspace_id).

drop function if exists public.list_crm_contacts_page(text, text, text, uuid, integer);
drop function if exists public.list_crm_companies_page(text, text, uuid, integer);

create or replace function public.list_crm_contacts_page(
  p_search text default null,
  p_after_last_name text default null,
  p_after_first_name text default null,
  p_after_id uuid default null,
  p_limit integer default 25
)
returns table (
  id uuid,
  workspace_id text,
  dge_customer_profile_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  title text,
  primary_company_id uuid,
  assigned_rep_id uuid,
  merged_into_contact_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with normalized as (
    select nullif(trim(coalesce(p_search, '')), '') as search_term
  )
  select
    c.id,
    c.workspace_id,
    c.dge_customer_profile_id,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    c.title,
    c.primary_company_id,
    c.assigned_rep_id,
    c.merged_into_contact_id,
    c.created_at,
    c.updated_at
  from public.crm_contacts c
  cross join normalized n
  where c.deleted_at is null
    and (
      n.search_term is null
      or c.first_name ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or c.last_name ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.email, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.phone, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
    )
    and (
      p_after_id is null
      or (c.last_name, c.first_name, c.id) > (p_after_last_name, p_after_first_name, p_after_id)
    )
  order by c.last_name asc, c.first_name asc, c.id asc
  limit greatest(coalesce(p_limit, 25), 1);
$$;

create or replace function public.list_crm_companies_page(
  p_search text default null,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 25
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
  updated_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with normalized as (
    select nullif(trim(coalesce(p_search, '')), '') as search_term
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
    c.updated_at
  from public.crm_companies c
  cross join normalized n
  where c.deleted_at is null
    and (
      n.search_term is null
      or c.name ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.city, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.state, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
    )
    and (
      p_after_id is null
      or (c.name, c.id) > (p_after_name, p_after_id)
    )
  order by c.name asc, c.id asc
  limit greatest(coalesce(p_limit, 25), 1);
$$;
