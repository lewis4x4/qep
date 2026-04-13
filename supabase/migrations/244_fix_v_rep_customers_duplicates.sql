-- ============================================================
-- Migration 244: Fix v_rep_customers duplicate rows
-- Problem: GROUP BY included ct.id, ct.first_name, ct.last_name, ct.phone, ct.email
-- which caused one row per contact per company. Use DISTINCT ON + lateral join
-- to pick the primary (or first) contact per company.
-- ============================================================

create or replace view public.v_rep_customers with (security_barrier = true) as
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
  -- Opportunity score: higher = more urgent to contact
  (
    coalesce(count(distinct d.id) filter (where d.closed_at is null and d.deleted_at is null), 0) * 10 +
    case when max(a.occurred_at) < now() - interval '14 days' then 15 else 0 end +
    case when max(a.occurred_at) < now() - interval '30 days' then 20 else 0 end
  ) as opportunity_score
from public.crm_companies co
-- Pick one contact per company via lateral subquery
left join lateral (
  select
    ct.first_name || ' ' || ct.last_name as contact_name,
    ct.phone,
    ct.email
  from public.crm_contacts ct
  where ct.primary_company_id = co.id and ct.deleted_at is null
  order by ct.created_at asc
  limit 1
) pc on true
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
group by co.id, co.name, pc.contact_name, pc.phone, pc.email, co.city, co.state
order by opportunity_score desc, last_interaction desc nulls last;
