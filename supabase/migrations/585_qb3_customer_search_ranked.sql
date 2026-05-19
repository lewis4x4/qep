-- ============================================================================
-- 585_qb3_customer_search_ranked.sql
-- QB-3 cycle 2:
--   1) Restore v_rep_customers one-row-per-company via lateral primary-contact
--      selection (preserves search_1/search_2).
--   2) Add DB-side ranked customer/company picker RPCs with normalized
--      phone-digit matching and phone-first ranking under limit pressure.
-- ============================================================================

create or replace view public.v_rep_customers
  with (security_barrier = true, security_invoker = true) as
select
  co.id as customer_id,
  co.name as company_name,
  pc.contact_name as primary_contact_name,
  pc.phone as primary_contact_phone,
  pc.email as primary_contact_email,
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
left join lateral (
  select
    concat_ws(' ', ct.first_name, ct.last_name) as contact_name,
    ct.phone,
    ct.email
  from public.crm_contacts ct
  where ct.primary_company_id = co.id
    and ct.deleted_at is null
  order by ct.created_at asc
  limit 1
) pc on true
left join public.crm_deals d
  on d.company_id = co.id
 and d.assigned_rep_id = auth.uid()
left join public.quotes q
  on q.crm_deal_id = d.id
 and q.created_by = auth.uid()
left join public.crm_activities a
  on a.company_id = co.id
 and a.created_by = auth.uid()
where co.deleted_at is null
  and co.id in (
    select distinct company_id
    from public.crm_deals
    where assigned_rep_id = auth.uid()
      and deleted_at is null
    union
    select distinct company_id
    from public.crm_activities
    where created_by = auth.uid()
      and deleted_at is null
      and company_id is not null
  )
group by
  co.id,
  co.name,
  pc.contact_name,
  pc.phone,
  pc.email,
  co.city,
  co.state,
  co.search_1,
  co.search_2
order by opportunity_score desc, last_interaction desc nulls last;

create or replace function public.search_customer_picker_ranked(
  p_query text,
  p_workspace_id text,
  p_limit integer default 8
)
returns table (
  row_kind text,
  contact_id uuid,
  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,
  company_id uuid,
  company_name text,
  company_dba text,
  company_phone text,
  company_city text,
  company_state text,
  company_classification text,
  phone_match boolean
)
language sql
security invoker
set search_path = public
as $$
with params as (
  select
    trim(coalesce(p_query, '')) as raw_query,
    lower(trim(coalesce(p_query, ''))) as q_lower,
    regexp_replace(trim(coalesce(p_query, '')), '[%_]', '', 'g') as q_sanitized,
    regexp_replace(trim(coalesce(p_query, '')), '\\D', '', 'g') as q_digits,
    greatest(coalesce(p_limit, 8), 1) as lim,
    nullif(trim(coalesce(p_workspace_id, '')), '') as ws
),
search_terms as (
  select
    raw_query,
    q_lower,
    q_sanitized,
    q_digits,
    ('%' || q_sanitized || '%')::text as q_pattern,
    lim,
    ws
  from params
  where length(raw_query) >= 2
),
contact_candidates as (
  select
    'contact'::text as row_kind,
    ct.id as contact_id,
    concat_ws(' ', ct.first_name, ct.last_name) as contact_name,
    ct.title as contact_title,
    ct.email as contact_email,
    ct.phone as contact_phone,
    co.id as company_id,
    co.name as company_name,
    co.dba as company_dba,
    co.phone as company_phone,
    co.city as company_city,
    co.state as company_state,
    co.classification as company_classification,
    (
      st.q_digits <> ''
      and regexp_replace(coalesce(ct.phone, ''), '\\D', '', 'g') like ('%' || st.q_digits || '%')
    ) as phone_match,
    greatest(
      coalesce(extensions.word_similarity(st.q_lower, lower(concat_ws(' ', ct.first_name, ct.last_name))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(ct.email, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(ct.phone, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.name, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.search_1, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.search_2, ''))), 0)
    ) as score
  from search_terms st
  join public.crm_contacts ct
    on ct.deleted_at is null
   and (st.ws is null or ct.workspace_id = st.ws)
  left join public.crm_companies co
    on co.id = ct.primary_company_id
   and co.deleted_at is null
  where
    concat_ws(' ', ct.first_name, ct.last_name) ilike st.q_pattern
    or coalesce(ct.email, '') ilike st.q_pattern
    or coalesce(ct.phone, '') ilike st.q_pattern
    or coalesce(co.name, '') ilike st.q_pattern
    or coalesce(co.dba, '') ilike st.q_pattern
    or coalesce(co.search_1, '') ilike st.q_pattern
    or coalesce(co.search_2, '') ilike st.q_pattern
    or (
      st.q_digits <> ''
      and regexp_replace(coalesce(ct.phone, ''), '\\D', '', 'g') like ('%' || st.q_digits || '%')
    )
),
company_candidates as (
  select
    'company'::text as row_kind,
    null::uuid as contact_id,
    null::text as contact_name,
    null::text as contact_title,
    null::text as contact_email,
    null::text as contact_phone,
    co.id as company_id,
    co.name as company_name,
    co.dba as company_dba,
    co.phone as company_phone,
    co.city as company_city,
    co.state as company_state,
    co.classification as company_classification,
    (
      st.q_digits <> ''
      and regexp_replace(coalesce(co.phone, ''), '\\D', '', 'g') like ('%' || st.q_digits || '%')
    ) as phone_match,
    greatest(
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.name, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.dba, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.search_1, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.search_2, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.phone, ''))), 0)
    ) as score
  from search_terms st
  join public.crm_companies co
    on co.deleted_at is null
   and (st.ws is null or co.workspace_id = st.ws)
  where
    co.name ilike st.q_pattern
    or coalesce(co.dba, '') ilike st.q_pattern
    or coalesce(co.phone, '') ilike st.q_pattern
    or coalesce(co.legal_name, '') ilike st.q_pattern
    or coalesce(co.owner_name, '') ilike st.q_pattern
    or coalesce(co.legacy_customer_number, '') ilike st.q_pattern
    or coalesce(co.search_1, '') ilike st.q_pattern
    or coalesce(co.search_2, '') ilike st.q_pattern
    or (
      st.q_digits <> ''
      and regexp_replace(coalesce(co.phone, ''), '\\D', '', 'g') like ('%' || st.q_digits || '%')
    )
),
combined as (
  select * from contact_candidates
  union all
  select * from company_candidates
)
select
  c.row_kind,
  c.contact_id,
  c.contact_name,
  c.contact_title,
  c.contact_email,
  c.contact_phone,
  c.company_id,
  c.company_name,
  c.company_dba,
  c.company_phone,
  c.company_city,
  c.company_state,
  c.company_classification,
  c.phone_match
from combined c
cross join search_terms st
order by
  c.phone_match desc,
  c.score desc,
  case when c.row_kind = 'contact' then 0 else 1 end,
  coalesce(c.contact_name, c.company_name, '') asc
limit (select lim from params);
$$;

grant execute on function public.search_customer_picker_ranked(text, text, integer) to authenticated;

create or replace function public.search_companies_for_picker_ranked(
  p_query text,
  p_workspace_id text,
  p_limit integer default 8
)
returns table (
  id uuid,
  name text,
  dba text,
  search_1 text,
  search_2 text,
  city text,
  state text,
  phone text,
  phone_match boolean
)
language sql
security invoker
set search_path = public
as $$
with params as (
  select
    trim(coalesce(p_query, '')) as raw_query,
    lower(trim(coalesce(p_query, ''))) as q_lower,
    regexp_replace(trim(coalesce(p_query, '')), '[%_]', '', 'g') as q_sanitized,
    regexp_replace(trim(coalesce(p_query, '')), '\\D', '', 'g') as q_digits,
    greatest(coalesce(p_limit, 8), 1) as lim,
    nullif(trim(coalesce(p_workspace_id, '')), '') as ws
),
search_terms as (
  select
    q_lower,
    q_sanitized,
    q_digits,
    ('%' || q_sanitized || '%')::text as q_pattern,
    ws
  from params
  where length(raw_query) >= 2
),
company_candidates as (
  select
    co.id,
    co.name,
    co.dba,
    co.search_1,
    co.search_2,
    co.city,
    co.state,
    co.phone,
    (
      st.q_digits <> ''
      and regexp_replace(coalesce(co.phone, ''), '\\D', '', 'g') like ('%' || st.q_digits || '%')
    ) as phone_match,
    greatest(
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.name, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.dba, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.search_1, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.search_2, ''))), 0),
      coalesce(extensions.word_similarity(st.q_lower, lower(coalesce(co.phone, ''))), 0)
    ) as score
  from search_terms st
  join public.crm_companies co
    on co.deleted_at is null
   and (st.ws is null or co.workspace_id = st.ws)
  where
    co.name ilike st.q_pattern
    or coalesce(co.dba, '') ilike st.q_pattern
    or coalesce(co.phone, '') ilike st.q_pattern
    or coalesce(co.legal_name, '') ilike st.q_pattern
    or coalesce(co.owner_name, '') ilike st.q_pattern
    or coalesce(co.legacy_customer_number, '') ilike st.q_pattern
    or coalesce(co.search_1, '') ilike st.q_pattern
    or coalesce(co.search_2, '') ilike st.q_pattern
    or (
      st.q_digits <> ''
      and regexp_replace(coalesce(co.phone, ''), '\\D', '', 'g') like ('%' || st.q_digits || '%')
    )
)
select
  c.id,
  c.name,
  c.dba,
  c.search_1,
  c.search_2,
  c.city,
  c.state,
  c.phone,
  c.phone_match
from company_candidates c
order by
  c.phone_match desc,
  c.score desc,
  coalesce(c.name, '') asc
limit (select lim from params);
$$;

grant execute on function public.search_companies_for_picker_ranked(text, text, integer) to authenticated;
