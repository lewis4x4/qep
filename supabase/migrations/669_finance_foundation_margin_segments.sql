-- 669_finance_foundation_margin_segments.sql
--
-- Finance foundation Part 8: finance-only margin segmentation across
-- equipment, parts, and service.
--
-- Rollback notes:
--   drop view if exists public.finance_margin_segment_matrix;
--   drop view if exists public.finance_margin_segment_facts;
--   drop function if exists public.qep_finance_equipment_net_book_value_cents(uuid);

create or replace function public.qep_finance_equipment_net_book_value_cents(
  p_equipment_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.role()) = 'service_role' or public.qep_finance_can_read() then (
      select e.net_book_value_cents
      from public.qrm_equipment e
      where e.id = p_equipment_id
        and (
          (select auth.role()) = 'service_role'
          or e.workspace_id = (select public.get_my_workspace())
        )
      limit 1
    )
    else null::bigint
  end;
$$;

comment on function public.qep_finance_equipment_net_book_value_cents(uuid) is
  'Finance-gated accessor for qrm_equipment.net_book_value_cents. Keeps the raw NBV column grant revoked from authenticated users while allowing finance-only margin reporting.';

revoke execute on function public.qep_finance_equipment_net_book_value_cents(uuid) from public;
grant execute on function public.qep_finance_equipment_net_book_value_cents(uuid) to authenticated;
grant execute on function public.qep_finance_equipment_net_book_value_cents(uuid) to service_role;

drop view if exists public.finance_margin_segment_matrix;
drop view if exists public.finance_margin_segment_facts;

create or replace view public.finance_margin_segment_facts
with (security_invoker = true) as
with raw_facts as (
  select
    ei.workspace_id,
    'equipment'::text as margin_department,
    'customer'::text as margin_payer,
    'equipment_invoice'::text as margin_fact_type,
    'equipment_invoices'::text as source_table,
    ei.id as source_id,
    ei.invoice_date as source_date,
    ei.company_id,
    ei.id as customer_invoice_id,
    null::uuid as service_job_id,
    ei.equipment_id,
    null::uuid as part_catalog_id,
    coalesce(ei.invoice_total_cents, 0)::bigint as sale_cents,
    public.qep_finance_equipment_net_book_value_cents(ei.equipment_id)::bigint as direct_cost_cents,
    0::bigint as operating_burden_cents,
    'equipment_margin_cents = equipment invoice total cents - qrm_equipment.net_book_value_cents'::text as formula
  from public.equipment_invoices ei
  where ((select auth.role()) = 'service_role' or public.qep_finance_can_read())
    and ei.status not in ('void', 'reversed')

  union all

  select
    pil.workspace_id,
    'parts'::text as margin_department,
    'customer'::text as margin_payer,
    'parts_invoice_line'::text as margin_fact_type,
    'parts_invoice_lines'::text as source_table,
    pil.id as source_id,
    ci.invoice_date as source_date,
    ci.crm_company_id as company_id,
    pil.customer_invoice_id,
    null::uuid as service_job_id,
    null::uuid as equipment_id,
    pil.part_catalog_id,
    coalesce(pil.extended_price_cents, 0)::bigint as sale_cents,
    (
      pil.qty_invoiced::numeric
      * round(coalesce(pc.cost_price, pc.average_cost, 0) * 100)::numeric
    )::bigint as direct_cost_cents,
    0::bigint as operating_burden_cents,
    'parts_margin_cents = parts_invoice_lines.extended_price_cents - qty_invoiced * parts_catalog cost/average_cost cents'::text as formula
  from public.parts_invoice_lines pil
  join public.customer_invoices ci
    on ci.id = pil.customer_invoice_id
   and ci.workspace_id = pil.workspace_id
  left join public.parts_catalog pc
    on pc.id = pil.part_catalog_id
  where ((select auth.role()) = 'service_role' or public.qep_finance_can_read())
    and pil.deleted_at is null
    and ci.status <> 'void'

  union all

  select
    sll.workspace_id,
    'service'::text as margin_department,
    case
      when sll.revenue_type::text in ('customer', 'warranty', 'internal') then sll.revenue_type::text
      else 'internal'
    end as margin_payer,
    'service_labor'::text as margin_fact_type,
    'service_labor_ledger'::text as source_table,
    sll.id as source_id,
    coalesce(sll.labor_date, sll.started_at::date, sll.created_at::date) as source_date,
    sj.customer_id as company_id,
    sll.customer_invoice_id,
    sll.service_job_id,
    null::uuid as equipment_id,
    null::uuid as part_catalog_id,
    coalesce(sll.labor_sale_cents, 0)::bigint as sale_cents,
    coalesce(sll.labor_cost_cents, 0)::bigint as direct_cost_cents,
    0::bigint as operating_burden_cents,
    'service_gross_margin_cents = service_labor_ledger.labor_sale_cents - labor_cost_cents'::text as formula
  from public.service_labor_ledger sll
  left join public.service_jobs sj
    on sj.id = sll.service_job_id
  where ((select auth.role()) = 'service_role' or public.qep_finance_can_read())
    and sll.deleted_at is null
    and sll.billed_status <> 'void'

  union all

  select
    sbr.workspace_id,
    'service'::text as margin_department,
    case
      when sbr.row_type::text = 'sublet' then 'sublet'
      when sbr.revenue_type::text in ('customer', 'warranty', 'internal') then sbr.revenue_type::text
      else 'internal'
    end as margin_payer,
    'service_operating_burden'::text as margin_fact_type,
    'service_billing_rows'::text as source_table,
    sbr.id as source_id,
    coalesce(sbr.posted_to_gl_at::date, sbr.created_at::date) as source_date,
    sj.customer_id as company_id,
    sbr.customer_invoice_id,
    sbr.service_job_id,
    null::uuid as equipment_id,
    null::uuid as part_catalog_id,
    coalesce(sbr.extended_price_cents, 0)::bigint as sale_cents,
    0::bigint as direct_cost_cents,
    coalesce(sbr.extended_cost_cents, 0)::bigint as operating_burden_cents,
    'service_operating_margin_cents = service billing row revenue - below-GM burden; labor GM remains labor sale - labor cost'::text as formula
  from public.service_billing_rows sbr
  left join public.service_jobs sj
    on sj.id = sbr.service_job_id
  where ((select auth.role()) = 'service_role' or public.qep_finance_can_read())
    and sbr.deleted_at is null
    and sbr.billed_status <> 'void'
    and sbr.row_type::text in ('shop_supply', 'haul', 'sublet', 'freight', 'misc', 'discount')
)
select
  rf.workspace_id,
  rf.margin_department,
  rf.margin_payer,
  rf.margin_fact_type,
  rf.source_table,
  rf.source_id,
  rf.source_date,
  rf.company_id,
  rf.customer_invoice_id,
  rf.service_job_id,
  rf.equipment_id,
  rf.part_catalog_id,
  rf.sale_cents,
  rf.direct_cost_cents,
  rf.operating_burden_cents,
  case
    when rf.direct_cost_cents is null then null::bigint
    else (rf.sale_cents - rf.direct_cost_cents)
  end as gross_margin_cents,
  case
    when rf.direct_cost_cents is null then null::bigint
    else (rf.sale_cents - rf.direct_cost_cents - coalesce(rf.operating_burden_cents, 0))
  end as operating_margin_cents,
  rf.formula
from raw_facts rf
where ((select auth.role()) = 'service_role' or public.qep_finance_can_read());

comment on view public.finance_margin_segment_facts is
  'Finance-only row-level margin facts. Departments: equipment, parts, service. Payers: customer, warranty, internal, sublet. Reps receive no rows because the view gates through qep_finance_can_read/service_role.';
comment on column public.finance_margin_segment_facts.gross_margin_cents is
  'Equipment: sale - NBV. Parts: extended price - catalog cost basis. Service labor: labor sale - labor cost. Service operating-burden rows keep gross margin separate.';
comment on column public.finance_margin_segment_facts.operating_margin_cents is
  'Gross margin less below-GM service burden rows such as shop supplies, haul, freight, misc, discount, and sublet.';

create or replace view public.finance_margin_segment_matrix
with (security_invoker = true) as
select
  f.workspace_id,
  date_trunc('month', f.source_date::timestamp)::date as period_month,
  f.margin_department,
  f.margin_payer,
  count(*)::bigint as fact_count,
  sum(coalesce(f.sale_cents, 0))::bigint as sale_cents,
  sum(coalesce(f.direct_cost_cents, 0))::bigint as direct_cost_cents,
  sum(coalesce(f.operating_burden_cents, 0))::bigint as operating_burden_cents,
  sum(coalesce(f.gross_margin_cents, 0))::bigint as gross_margin_cents,
  sum(coalesce(f.operating_margin_cents, 0))::bigint as operating_margin_cents,
  case
    when sum(coalesce(f.sale_cents, 0)) = 0 then null::numeric
    else round((sum(coalesce(f.gross_margin_cents, 0))::numeric / sum(coalesce(f.sale_cents, 0))::numeric) * 100, 2)
  end as gross_margin_pct,
  case
    when sum(coalesce(f.sale_cents, 0)) = 0 then null::numeric
    else round((sum(coalesce(f.operating_margin_cents, 0))::numeric / sum(coalesce(f.sale_cents, 0))::numeric) * 100, 2)
  end as operating_margin_pct
from public.finance_margin_segment_facts f
where ((select auth.role()) = 'service_role' or public.qep_finance_can_read())
group by
  f.workspace_id,
  date_trunc('month', f.source_date::timestamp)::date,
  f.margin_department,
  f.margin_payer;

comment on view public.finance_margin_segment_matrix is
  'Finance-only aggregate margin matrix by month, department, and payer segment for equipment, parts, service labor, and service operating burden.';

grant select on public.finance_margin_segment_facts to authenticated;
grant select on public.finance_margin_segment_facts to service_role;
grant select on public.finance_margin_segment_matrix to authenticated;
grant select on public.finance_margin_segment_matrix to service_role;
