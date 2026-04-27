-- 504_wave4_financial_reporting_views.sql
--
-- Wave 4 AR/AP/customer profitability reporting views and materialized views.
-- Sources:
--   docs/intellidealer-gap-audit/phase-4-service.yaml#work_order.total_ar
--   docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#profitability.sort_by
--   docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#ar_aging.bucket_current
--   docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#ap_aging.aging_method
--   docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#ar_invoice.customer_ar_history_link
--   docs/intellidealer-gap-audit/phase-9-advanced-intelligence.yaml#customer.available_credit
--   docs/intellidealer-gap-audit/phase-9-advanced-intelligence.yaml#customer_portal_view.ar_aging
--   docs/intellidealer-gap-audit/phase-9-advanced-intelligence.yaml#customer_portal_view.fiscal_ytd_profitability
--
-- Rollback notes:
--   drop view if exists public.v_customer_available_credit;
--   drop materialized view if exists public.mv_customer_fiscal_ytd;
--   drop materialized view if exists public.mv_customer_ar_aging;
--   drop view if exists public.customer_ar_history;
--   drop view if exists public.ap_aging_view;
--   drop view if exists public.ar_aging_view;
--   drop materialized view if exists public.qrm_customer_profitability_mv;
--   drop view if exists public.v_customer_open_ar;

create or replace view public.v_customer_open_ar
  with (security_invoker = true) as
select
  ci.workspace_id,
  ci.crm_company_id as company_id,
  round(sum(ci.balance_due) * 100)::bigint as open_ar_cents,
  sum(ci.balance_due)::numeric as open_ar_amount
from public.customer_invoices ci
where ci.crm_company_id is not null
  -- Audit hint used open/partially_paid; Wave 3 enum uses pending/sent/viewed/partial/overdue.
  and ci.status not in ('paid', 'void')
  and ci.balance_due > 0
group by ci.workspace_id, ci.crm_company_id;

comment on view public.v_customer_open_ar is
  'Wave 4 customer open A/R rollup. QEP stores balance_due as decimal dollars, so open_ar_cents is computed by multiplying by 100.';

drop materialized view if exists public.qrm_customer_profitability_mv;
create materialized view public.qrm_customer_profitability_mv as
select
  d.workspace_id,
  d.company_id,
  c.classification,
  c.territory_code,
  c.assigned_rep_id,
  sum(d.total_revenue_cents)::bigint as sales_cents,
  sum(d.total_cost_cents)::bigint as cost_cents,
  sum(d.gross_margin_cents)::bigint as margin_cents,
  case
    when sum(d.total_revenue_cents) = 0 then null::numeric
    else round((sum(d.gross_margin_cents)::numeric / nullif(sum(d.total_revenue_cents), 0)::numeric) * 100, 2)
  end as margin_pct,
  date_trunc('day', now())::date as as_of_date
from public.qb_deals d
join public.qrm_companies c on c.id = d.company_id
where d.deleted_at is null
group by d.workspace_id, d.company_id, c.classification, c.territory_code, c.assigned_rep_id;

comment on materialized view public.qrm_customer_profitability_mv is
  'Wave 4 IntelliDealer customer-level profitability rollup from qb_deals, extended with classification/territory/assigned_rep axes called out by the audit.';

create unique index qrm_customer_profitability_mv_pk
  on public.qrm_customer_profitability_mv (workspace_id, company_id);
comment on index public.qrm_customer_profitability_mv_pk is
  'Purpose: unique key required for concurrent Wave 4 profitability refreshes.';

create index qrm_customer_profitability_mv_margin_idx
  on public.qrm_customer_profitability_mv (workspace_id, margin_cents desc, sales_cents desc);
comment on index public.qrm_customer_profitability_mv_margin_idx is
  'Purpose: customer profitability report sorting by margin and sales.';

create or replace view public.ar_aging_view
  with (security_invoker = true) as
select
  ci.workspace_id,
  ci.crm_company_id,
  ci.branch_id,
  c.assigned_rep_id,
  sum(case when ci.due_date > current_date then ci.balance_due else 0 end)::numeric as future_amount,
  -- Keep current distinct from future_amount so finance dashboards can safely
  -- sum visible buckets without double-counting future-due invoices.
  sum(case when ci.due_date = current_date then ci.balance_due else 0 end)::numeric as current_amount,
  sum(case when current_date - ci.due_date between 1 and 30 then ci.balance_due else 0 end)::numeric as bucket_1_30,
  sum(case when current_date - ci.due_date between 31 and 60 then ci.balance_due else 0 end)::numeric as bucket_31_60,
  sum(case when current_date - ci.due_date between 61 and 90 then ci.balance_due else 0 end)::numeric as bucket_61_90,
  sum(case when current_date - ci.due_date between 91 and 120 then ci.balance_due else 0 end)::numeric as bucket_91_120,
  sum(case when current_date - ci.due_date > 120 then ci.balance_due else 0 end)::numeric as bucket_over_120,
  sum(ci.balance_due)::numeric as total_outstanding,
  exists (
    select 1
    from public.service_jobs sj
    where sj.customer_id = ci.crm_company_id
      and sj.workspace_id = ci.workspace_id
      and sj.closed_at is null
      and sj.deleted_at is null
  ) as has_open_work_order,
  exists (
    select 1
    from public.rental_contracts rc
    join public.portal_customers pc on pc.id = rc.portal_customer_id
    where pc.crm_company_id = ci.crm_company_id
      and rc.workspace_id = ci.workspace_id
      and rc.status in ('approved', 'awaiting_payment', 'active')
  ) as has_active_rental
from public.customer_invoices ci
left join public.qrm_companies c on c.id = ci.crm_company_id
where ci.crm_company_id is not null
  and ci.balance_due > 0
  and ci.status not in ('paid', 'void')
group by ci.workspace_id, ci.crm_company_id, ci.branch_id, c.assigned_rep_id;

comment on view public.ar_aging_view is
  'Wave 4 IntelliDealer AR aging view. Includes audit should-tier dimensions assigned_rep_id, future_amount, has_open_work_order, and has_active_rental.';

create or replace view public.ap_aging_view
  with (security_invoker = true) as
select
  b.id,
  b.workspace_id,
  b.vendor_id,
  coalesce(v.name, b.vendor_name, 'Vendor') as vendor_name,
  b.invoice_number,
  b.invoice_date,
  b.due_date,
  b.payable_account_code,
  b.payable_account_name,
  b.description,
  b.status,
  b.approval_status,
  b.total_amount,
  b.amount_paid,
  b.balance_due,
  case
    when current_date - b.due_date <= 30 then 'current'
    when current_date - b.due_date <= 60 then '31_60'
    when current_date - b.due_date <= 90 then '61_90'
    when current_date - b.due_date <= 120 then '91_120'
    else 'over_120'
  end as due_age_bucket,
  case
    when current_date - b.invoice_date <= 30 then 'current'
    when current_date - b.invoice_date <= 60 then '31_60'
    when current_date - b.invoice_date <= 90 then '61_90'
    when current_date - b.invoice_date <= 120 then '91_120'
    else 'over_120'
  end as invoice_age_bucket,
  greatest(current_date - b.due_date, 0) as days_overdue,
  greatest(current_date - b.invoice_date, 0) as days_from_invoice,
  v.vendor_number as vendor_code,
  b.payable_account_code as ap_account_number,
  'due_date'::text as aging_basis
from public.ap_bills b
left join public.vendor_profiles v on v.id = b.vendor_id
where b.status <> 'void'
  and b.balance_due > 0;

comment on view public.ap_aging_view is
  'Wave 4 IntelliDealer AP aging compatibility view. Preserves the existing ap_bills row-level contract and appends vendor_code/ap_account_number/aging_basis; vendor TIN is intentionally not exposed.';

create or replace view public.customer_ar_history
  with (security_invoker = true) as
select
  i.*,
  p.amount_cents as payment_amount_cents,
  p.succeeded_at as payment_succeeded_at,
  p.status as payment_status
from public.customer_invoices i
left join public.portal_payment_intents p on p.invoice_id = i.id;

comment on view public.customer_ar_history is
  'Wave 4 Customer Profile AR history view over customer_invoices with linked portal payment attempts.';

drop materialized view if exists public.mv_customer_ar_aging;
create materialized view public.mv_customer_ar_aging as
select
  ci.workspace_id,
  ci.crm_company_id as company_id,
  sum(case when ci.due_date >= current_date then round(ci.balance_due * 100) else 0 end)::bigint as current_cents,
  sum(case when ci.due_date between current_date - interval '30 days' and current_date - interval '1 day' then round(ci.balance_due * 100) else 0 end)::bigint as d30_cents,
  sum(case when ci.due_date between current_date - interval '60 days' and current_date - interval '31 days' then round(ci.balance_due * 100) else 0 end)::bigint as d60_cents,
  sum(case when ci.due_date between current_date - interval '90 days' and current_date - interval '61 days' then round(ci.balance_due * 100) else 0 end)::bigint as d90_cents,
  sum(case when ci.due_date < current_date - interval '90 days' then round(ci.balance_due * 100) else 0 end)::bigint as d120plus_cents,
  sum(round(ci.balance_due * 100))::bigint as total_cents,
  now() as refreshed_at
from public.customer_invoices ci
where ci.crm_company_id is not null
  and ci.balance_due > 0
  and ci.status not in ('paid', 'void')
group by ci.workspace_id, ci.crm_company_id;

comment on materialized view public.mv_customer_ar_aging is
  'Wave 4 Account 360 AR aging materialized view. Audit referenced balance_cents/company_id placeholders; QEP source is customer_invoices.balance_due and crm_company_id.';

create unique index mv_customer_ar_aging_pk
  on public.mv_customer_ar_aging (workspace_id, company_id);
comment on index public.mv_customer_ar_aging_pk is
  'Purpose: unique key required for concurrent Wave 4 customer AR aging refreshes.';

drop materialized view if exists public.mv_customer_fiscal_ytd;
create materialized view public.mv_customer_fiscal_ytd as
with invoice_costs as (
  select
    pil.customer_invoice_id,
    sum(pil.qty_invoiced::numeric * round(coalesce(pc.cost_price, pc.average_cost, 0) * 100)::numeric)::bigint as parts_cost_cents
  from public.parts_invoice_lines pil
  left join public.parts_catalog pc on pc.id = pil.part_catalog_id
  where pil.deleted_at is null
  group by pil.customer_invoice_id
), invoice_fiscal as (
  select
    ci.workspace_id,
    ci.crm_company_id as company_id,
    coalesce(fp.period_year, extract(year from ci.invoice_date)::integer) as fiscal_year,
    round(ci.total * 100)::bigint as revenue_cents,
    coalesce(ic.parts_cost_cents, 0)::bigint as cost_cents
  from public.customer_invoices ci
  left join public.qrm_fiscal_periods fp
    on fp.workspace_id = ci.workspace_id
   and ci.invoice_date between fp.starts_on and fp.ends_on
   and fp.deleted_at is null
  left join invoice_costs ic on ic.customer_invoice_id = ci.id
  where ci.crm_company_id is not null
    and ci.status not in ('void')
)
select
  workspace_id,
  company_id,
  fiscal_year,
  sum(revenue_cents)::bigint as revenue_cents,
  sum(cost_cents)::bigint as cost_cents,
  sum(revenue_cents - cost_cents)::bigint as profit_cents,
  now() as refreshed_at
from invoice_fiscal
group by workspace_id, company_id, fiscal_year;

comment on materialized view public.mv_customer_fiscal_ytd is
  'Wave 4 Account 360 fiscal YTD rollup. Audit source left invoice-line union unresolved; QEP uses customer_invoices.total for revenue and derives cost only from parts_invoice_lines + parts_catalog cost where safely available, otherwise zero.';

create unique index mv_customer_fiscal_ytd_pk
  on public.mv_customer_fiscal_ytd (workspace_id, company_id, fiscal_year);
comment on index public.mv_customer_fiscal_ytd_pk is
  'Purpose: unique key required for concurrent Wave 4 fiscal YTD refreshes.';

create or replace view public.v_customer_available_credit
  with (security_invoker = true) as
select
  c.workspace_id,
  c.id as company_id,
  c.credit_limit_cents,
  coalesce(ar.total_cents, c.total_ar_cents, 0)::bigint as total_ar_cents,
  coalesce(open_commit.open_commit_cents, 0)::bigint as open_commit_cents,
  case
    when c.credit_limit_cents is null then null::bigint
    else c.credit_limit_cents
      - coalesce(ar.total_cents, c.total_ar_cents, 0)::bigint
      - coalesce(open_commit.open_commit_cents, 0)::bigint
  end as available_credit_cents
from public.qrm_companies c
left join public.mv_customer_ar_aging ar
  on ar.workspace_id = c.workspace_id
 and ar.company_id = c.id
left join lateral (
  select coalesce(sum(commit_cents), 0)::bigint as open_commit_cents
  from (
    select d.total_revenue_cents::bigint as commit_cents
    from public.qb_deals d
    where d.workspace_id = c.workspace_id
      and d.company_id = c.id
      and d.deleted_at is null
      and d.status in ('active', 'in_finance')
    union all
    select round(coalesce(rc.agreed_monthly_rate, rc.agreed_weekly_rate, rc.agreed_daily_rate, rc.estimate_monthly_rate, rc.estimate_weekly_rate, rc.estimate_daily_rate, 0) * 100)::bigint as commit_cents
    from public.rental_contracts rc
    join public.portal_customers pc on pc.id = rc.portal_customer_id
    where rc.workspace_id = c.workspace_id
      and pc.crm_company_id = c.id
      and rc.status in ('approved', 'awaiting_payment', 'active')
  ) commitments
) open_commit on true
where c.deleted_at is null;

comment on view public.v_customer_available_credit is
  'Wave 4 computed available credit. Open commitments combine active/in-finance qb_deals and conservative active rental rate exposure; AR comes from mv_customer_ar_aging with total_ar_cents fallback.';
