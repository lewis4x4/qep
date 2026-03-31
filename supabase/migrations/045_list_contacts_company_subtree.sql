-- Keyset-paginated contacts scoped to a company subtree (matches crm_company_subtree_rollups contact logic).

create or replace function public.list_crm_contacts_for_company_subtree_page(
  p_company_id uuid,
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
  with recursive subtree as (
    select c.id
    from public.crm_companies c
    where c.deleted_at is null
      and c.id = p_company_id

    union all

    select child.id
    from public.crm_companies child
    join subtree s on child.parent_company_id = s.id
    where child.deleted_at is null
  ),
  eligible_contacts as (
    select distinct c.id
    from public.crm_contacts c
    where c.deleted_at is null
      and (
        c.primary_company_id in (select id from subtree)
        or exists (
          select 1
          from public.crm_contact_companies cc
          where cc.contact_id = c.id
            and cc.company_id in (select id from subtree)
        )
      )
  ),
  normalized as (
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
  inner join eligible_contacts ec on ec.id = c.id
  cross join normalized n
  where
    (
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
