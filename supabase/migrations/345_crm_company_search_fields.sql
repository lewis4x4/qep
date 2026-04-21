-- ============================================================================
-- Migration 345: CRM company Search 1 / Search 2 fields
--
-- Rollback notes:
--   1. Drop indexes idx_qrm_companies_search_1_prefix and
--      idx_qrm_companies_search_2_prefix.
--   2. Recreate public.crm_companies without search_1 / search_2.
--   3. Recreate public.list_crm_companies_page without search_1 / search_2.
--   4. Recreate public.v_rep_customers without search_1 / search_2.
--   5. Drop columns search_1 and search_2 from public.qrm_companies.
-- ============================================================================

alter table public.qrm_companies
  add column if not exists search_1 text,
  add column if not exists search_2 text;

comment on column public.qrm_companies.search_1 is
  'Legacy IntelliDealer Search 1 field. Intended for starts-with customer lookup shortcuts.';

comment on column public.qrm_companies.search_2 is
  'Legacy IntelliDealer Search 2 field. Intended for starts-with customer lookup shortcuts.';

create index if not exists idx_qrm_companies_search_1_prefix
  on public.qrm_companies (lower(search_1) text_pattern_ops)
  where deleted_at is null and search_1 is not null;

create index if not exists idx_qrm_companies_search_2_prefix
  on public.qrm_companies (lower(search_2) text_pattern_ops)
  where deleted_at is null and search_2 is not null;

create or replace view public.crm_companies
  with (security_invoker = true)
  as
  select
    id,
    workspace_id,
    name,
    parent_company_id,
    assigned_rep_id,
    hubspot_company_id,
    address_line_1,
    address_line_2,
    city,
    state,
    postal_code,
    country,
    metadata,
    created_at,
    updated_at,
    deleted_at,
    legal_name,
    dba,
    phone,
    website,
    classification,
    territory_code,
    county,
    status,
    notes,
    search_1,
    search_2
  from public.qrm_companies;

drop function if exists public.list_crm_companies_page(text, text, uuid, integer);

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
  updated_at timestamptz,
  search_1 text,
  search_2 text
)
language sql
security invoker
set search_path = public
as $$
  with normalized as (
    select
      nullif(trim(coalesce(p_search, '')), '') as search_term,
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
    c.search_2
  from public.crm_companies c
  cross join normalized n
  where c.deleted_at is null
    and (
      n.search_term is null
      or c.name ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.city, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.state, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or (n.search_prefix is not null and lower(coalesce(c.search_1, '')) like (n.search_prefix || '%'))
      or (n.search_prefix is not null and lower(coalesce(c.search_2, '')) like (n.search_prefix || '%'))
    )
    and (
      p_after_id is null
      or (c.name, c.id) > (p_after_name, p_after_id)
    )
  order by c.name asc, c.id asc
  limit greatest(coalesce(p_limit, 25), 1);
$$;

create or replace view public.v_rep_customers
  with (security_barrier = true, security_invoker = true) as
select
  co.id as customer_id,
  co.name as company_name,
  ct.first_name || ' ' || ct.last_name as primary_contact_name,
  ct.phone as primary_contact_phone,
  ct.email as primary_contact_email,
  co.city,
  co.state,
  count(distinct d.id) filter (where d.closed_at is null and d.deleted_at is null) as open_deals,
  count(distinct q.id) filter (where q.status = 'linked' and q.deleted_at is null) as active_quotes,
  max(a.occurred_at) as last_interaction,
  extract(day from now() - max(a.occurred_at)) as days_since_contact,
  (
    coalesce(count(distinct d.id) filter (where d.closed_at is null and d.deleted_at is null), 0) * 10 +
    case when max(a.occurred_at) < now() - interval '14 days' then 15 else 0 end +
    case when max(a.occurred_at) < now() - interval '30 days' then 20 else 0 end
  ) as opportunity_score,
  co.search_1,
  co.search_2
from public.crm_companies co
left join public.crm_contacts ct on ct.primary_company_id = co.id and ct.deleted_at is null
left join public.crm_deals d on d.company_id = co.id and d.assigned_rep_id = auth.uid()
left join public.quotes q on q.crm_deal_id = d.id and q.created_by = auth.uid()
left join public.crm_activities a on a.company_id = co.id and a.created_by = auth.uid()
where co.deleted_at is null
  and co.id in (
    select distinct company_id from public.crm_deals
    where assigned_rep_id = auth.uid() and deleted_at is null
    union
    select distinct company_id from public.crm_activities
    where created_by = auth.uid() and deleted_at is null and company_id is not null
  )
group by
  co.id,
  co.name,
  ct.id,
  ct.first_name,
  ct.last_name,
  ct.phone,
  ct.email,
  co.city,
  co.state,
  co.search_1,
  co.search_2
order by opportunity_score desc, last_interaction desc nulls last;
