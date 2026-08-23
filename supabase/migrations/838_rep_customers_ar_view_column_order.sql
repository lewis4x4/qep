-- ============================================================================
-- 838: Preserve v_rep_customers column order while adding service AR
--
-- 837 installs the AR sync function. Recreate the view here so the new column
-- is appended after every existing column.
-- ============================================================================

drop view if exists public.v_rep_customers cascade;

create view public.v_rep_customers
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
  co.search_2,
  (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'make', top_e.make,
        'model', top_e.model,
        'year', top_e.year,
        'category', top_e.category::text,
        'name', top_e.name
      )
    ), '[]'::jsonb)
    from (
      select e.make, e.model, e.year, e.category, e.name, e.engine_hours, e.updated_at
      from public.qrm_equipment e
      where e.company_id = co.id
        and e.deleted_at is null
        and e.availability != 'decommissioned'
      order by coalesce(e.engine_hours, 0) desc, e.updated_at desc
      limit 10
    ) top_e
  ) as equipment_summary,
  coalesce((
    select sum(ci.balance_due)
    from public.customer_invoices ci
    where ci.workspace_id = co.workspace_id
      and ci.crm_company_id = co.id
      and ci.status in ('pending', 'sent', 'viewed', 'partial', 'overdue')
      and coalesce(ci.balance_due, 0) > 0
  ), 0)::numeric as open_ar_balance
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
  co.workspace_id,
  pc.contact_name,
  pc.phone,
  pc.email,
  co.city,
  co.state,
  co.search_1,
  co.search_2
order by opportunity_score desc, last_interaction desc nulls last;

comment on view public.v_rep_customers is
  'Rep-scoped customer rollup with equipment_summary and open_ar_balance from customer_invoices so sales sees service AR after RO close without asking the office.';

grant select on public.v_rep_customers to authenticated;
