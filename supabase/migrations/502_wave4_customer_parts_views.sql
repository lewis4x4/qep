-- 502_wave4_customer_parts_views.sql
--
-- Wave 4 computed views from the IntelliDealer gap audit.
-- Sources:
--   docs/intellidealer-gap-audit/phase-1-crm.yaml#customer.resale_cert_number
--   docs/intellidealer-gap-audit/phase-3-parts.yaml#parts.months_supply
--
-- Rollback notes:
--   drop view if exists public.v_parts_months_supply;
--   drop view if exists public.v_customer_primary_resale_cert;

create or replace view public.v_customer_primary_resale_cert
  with (security_invoker = true) as
select distinct on (tec.crm_company_id)
  tec.workspace_id,
  tec.crm_company_id,
  tec.certificate_number,
  tec.issuing_state,
  tec.effective_date,
  tec.expiration_date,
  tec.status
from public.tax_exemption_certificates tec
where tec.crm_company_id is not null
  -- The audit hint names status = 'active'. Current QEP certs use the
  -- data-safe equivalent 'verified'; keep both literals so future imports that
  -- normalize to active still satisfy the same primary-cert contract.
  and tec.status in ('active', 'verified')
  and (tec.expiration_date is null or tec.expiration_date >= current_date)
order by tec.crm_company_id, tec.effective_date desc, tec.created_at desc;

comment on view public.v_customer_primary_resale_cert is
  'Wave 4 IntelliDealer shortcut: one primary, non-expired resale/tax certificate row per customer for Customer Profile display. Uses QEP verified as the active-cert synonym.';

create or replace view public.v_parts_months_supply
  with (security_invoker = true) as
with monthly_usage as (
  select
    phm.part_id,
    avg(phm.sales_qty) filter (where phm.month_offset between 1 and 6) as avg_monthly_qty_6mo,
    sum(phm.sales_qty) filter (where phm.month_offset between 1 and 12) as sales_qty_12mo
  from public.parts_history_monthly phm
  group by phm.part_id
)
select
  pc.id as part_id,
  pc.workspace_id,
  pc.part_number,
  pc.branch_code,
  pc.on_hand,
  coalesce(mu.avg_monthly_qty_6mo, 0)::numeric as avg_monthly_qty,
  case
    when coalesce(mu.avg_monthly_qty_6mo, 0) > 0
      then round((coalesce(pc.on_hand, 0)::numeric / mu.avg_monthly_qty_6mo)::numeric, 2)
    else null::numeric
  end as months_supply,
  coalesce(mu.sales_qty_12mo, 0)::numeric as sales_qty_12mo
from public.parts_catalog pc
left join monthly_usage mu on mu.part_id = pc.id
where pc.deleted_at is null;

comment on view public.v_parts_months_supply is
  'Wave 4 IntelliDealer parts months-supply view. Audit source referenced parts_history_monthly.quantity_sold/month_start; QEP uses sales_qty/month_offset, so this computes a 6-month average from month_offset 1-6.';
