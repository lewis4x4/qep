-- ============================================================================
-- Migration 355: Owner Data Miner Equivalents
--
-- Rollback notes:
--   1. Drop view public.owner_data_miner_service_labor.
--   2. Drop view public.owner_data_miner_credit_exposure.
--   3. Drop view public.owner_data_miner_profitability.
-- ============================================================================

create or replace view public.owner_data_miner_profitability with (security_barrier = true) as
with won_deals as (
  select
    d.workspace_id,
    d.company_id,
    coalesce(c.name, 'Unknown customer') as customer_name,
    date_trunc('month', coalesce(d.closed_at, d.updated_at, d.created_at))::date as closed_month,
    coalesce(d.closed_at, d.updated_at, d.created_at) as closed_at,
    coalesce(d.amount, 0)::numeric(14, 2) as sales_amount,
    coalesce(
      d.margin_amount,
      case
        when d.amount is not null and d.margin_pct is not null
          then round(d.amount * (d.margin_pct / 100.0), 2)
        else 0
      end
    )::numeric(14, 2) as gross_margin_amount
  from public.qrm_deals d
  join public.qrm_deal_stages s on s.id = d.stage_id
  left join public.qrm_companies c on c.id = d.company_id
  where d.workspace_id = public.get_my_workspace()
    and d.deleted_at is null
    and coalesce(s.is_closed_won, false) = true
)
select
  workspace_id,
  company_id,
  customer_name,
  closed_month,
  count(*)::integer as won_deal_count,
  sum(sales_amount)::numeric(14, 2) as sales_amount,
  sum(gross_margin_amount)::numeric(14, 2) as gross_margin_amount,
  round(
    case
      when sum(sales_amount) = 0 then null
      else (sum(gross_margin_amount) / sum(sales_amount) * 100)::numeric
    end,
    2
  ) as gross_margin_pct,
  max(closed_at) as last_closed_at
from won_deals
group by workspace_id, company_id, customer_name, closed_month;
alter view public.owner_data_miner_profitability set (security_invoker = true);
comment on view public.owner_data_miner_profitability is
  'Data Miner equivalent: monthly customer profitability rollup over closed-won QRM deals for elevated roles.';
grant select on public.owner_data_miner_profitability to authenticated;
create or replace view public.owner_data_miner_credit_exposure with (security_barrier = true) as
with invoice_rollup as (
  select
    ci.workspace_id,
    ci.crm_company_id as company_id,
    count(*)::integer as open_invoice_count,
    count(*) filter (
      where ci.due_date < current_date and coalesce(ci.balance_due, 0) > 0
    )::integer as overdue_invoice_count,
    coalesce(sum(ci.balance_due), 0)::numeric(14, 2) as open_balance_due,
    coalesce(
      sum(ci.balance_due) filter (
        where ci.due_date < current_date and coalesce(ci.balance_due, 0) > 0
      ),
      0
    )::numeric(14, 2) as overdue_balance_due,
    coalesce(
      max((current_date - ci.due_date)) filter (
        where ci.due_date < current_date and coalesce(ci.balance_due, 0) > 0
      ),
      0
    )::integer as max_days_past_due,
    min(ci.due_date) filter (
      where ci.due_date < current_date and coalesce(ci.balance_due, 0) > 0
    ) as oldest_due_date,
    max(ci.updated_at) as last_invoice_at
  from public.customer_invoices ci
  where ci.workspace_id = public.get_my_workspace()
    and coalesce(ci.balance_due, 0) > 0
    and ci.status <> 'paid'
    and ci.status <> 'void'
  group by ci.workspace_id, ci.crm_company_id
),
block_rollup as (
  select distinct on (b.workspace_id, b.company_id)
    b.workspace_id,
    b.company_id,
    b.status as block_status,
    b.block_reason,
    b.current_max_aging_days,
    b.override_until,
    b.blocked_at
  from public.ar_credit_blocks b
  where b.workspace_id = public.get_my_workspace()
  order by
    b.workspace_id,
    b.company_id,
    case b.status
      when 'active' then 0
      when 'overridden' then 1
      else 2
    end,
    b.blocked_at desc
)
select
  i.workspace_id,
  i.company_id,
  coalesce(c.name, 'Unknown customer') as customer_name,
  i.open_invoice_count,
  i.overdue_invoice_count,
  i.open_balance_due,
  i.overdue_balance_due,
  i.max_days_past_due,
  i.oldest_due_date,
  i.last_invoice_at,
  b.block_status,
  b.block_reason,
  b.current_max_aging_days,
  b.override_until,
  b.blocked_at,
  case
    when coalesce(i.overdue_balance_due, 0) >= 50000
      or coalesce(i.max_days_past_due, 0) >= 90
      or b.block_status = 'active' then 'critical'
    when coalesce(i.overdue_balance_due, 0) >= 10000
      or coalesce(i.max_days_past_due, 0) >= 60
      or b.block_status = 'overridden' then 'warning'
    else 'healthy'
  end as exposure_band
from invoice_rollup i
left join public.qrm_companies c on c.id = i.company_id
left join block_rollup b
  on b.workspace_id = i.workspace_id
 and b.company_id = i.company_id;
alter view public.owner_data_miner_credit_exposure set (security_invoker = true);
comment on view public.owner_data_miner_credit_exposure is
  'Data Miner equivalent: live A/R exposure and credit-block rollup for elevated roles.';
grant select on public.owner_data_miner_credit_exposure to authenticated;
create or replace view public.owner_data_miner_service_labor with (security_barrier = true) as
with carded_jobs as (
  select
    st.workspace_id,
    date_trunc('day', st.clocked_in_at)::date as labor_date,
    sj.branch_id,
    sj.shop_or_field,
    st.technician_id,
    coalesce(nullif(p.full_name, ''), nullif(p.email, ''), 'Unknown technician') as technician_name,
    st.service_job_id,
    round(sum(coalesce(st.hours, 0))::numeric, 2) as hours_worked,
    coalesce(sj.invoice_total, 0)::numeric(14, 2) as billed_value,
    coalesce(sj.quote_total, 0)::numeric(14, 2) as quoted_value,
    sj.current_stage::text as current_stage
  from public.service_timecards st
  join public.service_jobs sj on sj.id = st.service_job_id
  left join public.profiles p on p.id = st.technician_id
  where st.workspace_id = public.get_my_workspace()
  group by
    st.workspace_id,
    date_trunc('day', st.clocked_in_at)::date,
    sj.branch_id,
    sj.shop_or_field,
    st.technician_id,
    coalesce(nullif(p.full_name, ''), nullif(p.email, ''), 'Unknown technician'),
    st.service_job_id,
    coalesce(sj.invoice_total, 0)::numeric(14, 2),
    coalesce(sj.quote_total, 0)::numeric(14, 2),
    sj.current_stage::text
)
select
  workspace_id,
  labor_date,
  branch_id,
  shop_or_field,
  technician_id,
  technician_name,
  count(*)::integer as job_count,
  round(sum(hours_worked)::numeric, 2) as hours_worked,
  sum(billed_value)::numeric(14, 2) as billed_value,
  sum(quoted_value)::numeric(14, 2) as quoted_value,
  count(*) filter (where current_stage in ('closed', 'invoiced'))::integer as closed_job_count
from carded_jobs
group by
  workspace_id,
  labor_date,
  branch_id,
  shop_or_field,
  technician_id,
  technician_name;
alter view public.owner_data_miner_service_labor set (security_invoker = true);
comment on view public.owner_data_miner_service_labor is
  'Data Miner equivalent: daily technician labor rollup over service timecards and linked jobs.';
grant select on public.owner_data_miner_service_labor to authenticated;
