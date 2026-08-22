-- ============================================================================
-- 837: Service RO close → invoice send + AR visibility closeout
--
-- Operating role: service writer / cashier closing the RO; salesperson on next visit.
-- Dealership workflow: job done → RO closed → bill in customer's hands → warranty
-- queued when applicable → open balance visible in sales rep book.
--
-- Intelligence advantage: close is the send — no accounting retype pass.
-- ============================================================================

create or replace function public.service_sync_ar_open_item_for_invoice(
  p_invoice_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_company_id uuid;
  v_balance_cents bigint;
  v_item_id uuid;
  v_days_outstanding integer;
begin
  if p_invoice_id is null then
    return null;
  end if;

  select
    ci.id,
    ci.workspace_id,
    ci.crm_company_id,
    ci.portal_customer_id,
    ci.invoice_number,
    ci.invoice_date,
    ci.due_date,
    ci.total,
    ci.balance_due,
    ci.status
  into v_inv
  from public.customer_invoices ci
  where ci.id = p_invoice_id;

  if v_inv.id is null then
    raise exception 'invoice not found';
  end if;

  if (select auth.role()) is distinct from 'service_role'
     and v_inv.workspace_id is distinct from public.get_my_workspace() then
    raise exception 'workspace mismatch';
  end if;

  v_company_id := v_inv.crm_company_id;
  if v_company_id is null and v_inv.portal_customer_id is not null then
    select pc.crm_company_id
      into v_company_id
    from public.portal_customers pc
    where pc.id = v_inv.portal_customer_id
      and pc.workspace_id = v_inv.workspace_id
    limit 1;
  end if;

  if v_company_id is null then
    return null;
  end if;

  v_balance_cents := greatest(0, round(coalesce(v_inv.balance_due, 0) * 100)::bigint);
  v_days_outstanding := case
    when v_inv.due_date is null then 0
    else greatest(0, (current_date - v_inv.due_date))
  end;

  select q.id
    into v_item_id
  from public.qrm_ar_open_items q
  where q.workspace_id = v_inv.workspace_id
    and q.company_id = v_company_id
    and q.invoice_number = v_inv.invoice_number
    and q.deleted_at is null
  limit 1;

  if v_inv.status in ('paid', 'void') or v_balance_cents = 0 then
    if v_item_id is not null then
      update public.qrm_ar_open_items
      set balance_cents = 0,
          status = case when v_inv.status = 'void' then 'void' else 'paid' end,
          days_outstanding = v_days_outstanding,
          updated_at = now()
      where id = v_item_id;
    end if;
  elsif v_item_id is not null then
    update public.qrm_ar_open_items
    set balance_cents = v_balance_cents,
        original_amount_cents = greatest(
          original_amount_cents,
          round(coalesce(v_inv.total, 0) * 100)::bigint
        ),
        due_date = v_inv.due_date,
        days_outstanding = v_days_outstanding,
        status = case when v_inv.status = 'partial' then 'partial' else 'open' end,
        updated_at = now()
    where id = v_item_id;
  else
    insert into public.qrm_ar_open_items (
      workspace_id,
      company_id,
      invoice_number,
      invoice_date,
      due_date,
      original_amount_cents,
      balance_cents,
      days_outstanding,
      status
    ) values (
      v_inv.workspace_id,
      v_company_id,
      v_inv.invoice_number,
      v_inv.invoice_date,
      v_inv.due_date,
      round(coalesce(v_inv.total, 0) * 100)::bigint,
      v_balance_cents,
      v_days_outstanding,
      case when v_inv.status = 'partial' then 'partial' else 'open' end
    )
    returning id into v_item_id;
  end if;

  update public.qrm_companies qc
  set current_ar_balance = coalesce((
        select sum(ci.balance_due)
        from public.customer_invoices ci
        where ci.workspace_id = v_inv.workspace_id
          and ci.crm_company_id = v_company_id
          and ci.status in ('pending', 'sent', 'viewed', 'partial', 'overdue')
          and coalesce(ci.balance_due, 0) > 0
      ), 0),
      current_ar_balance_updated_at = now()
  where qc.id = v_company_id
    and qc.workspace_id = v_inv.workspace_id;

  return v_item_id;
end;
$$;

comment on function public.service_sync_ar_open_item_for_invoice(uuid) is
  'Service closeout: upsert qrm_ar_open_items and refresh qrm_companies.current_ar_balance from a customer_invoices row. Tenant-bound via get_my_workspace().';

revoke all on function public.service_sync_ar_open_item_for_invoice(uuid) from public;
grant execute on function public.service_sync_ar_open_item_for_invoice(uuid) to authenticated;
grant execute on function public.service_sync_ar_open_item_for_invoice(uuid) to service_role;

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
  co.search_2,
  coalesce((
    select sum(ci.balance_due)
    from public.customer_invoices ci
    where ci.workspace_id = co.workspace_id
      and ci.crm_company_id = co.id
      and ci.status in ('pending', 'sent', 'viewed', 'partial', 'overdue')
      and coalesce(ci.balance_due, 0) > 0
  ), 0)::numeric as open_ar_balance,
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
  ) as equipment_summary
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
