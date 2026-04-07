-- ============================================================================
-- Migration 190: QEP Moonshot Command Center — Finance / CFO (Slice 3)
--
-- Adds the columns and materialized views the CFO lens needs. Per the
-- "columns added per slice" rule, only what the 8 CFO KPIs actually
-- consume is added here.
--
-- New columns (additive, all nullable so no backfill required):
--   crm_deals: loaded_margin_pct, net_contribution_after_load, forecast_confidence_score
--   deposits:  verification_cycle_hours, refund_initiated_at, refund_completed_at
--   payment_validations: exception_reason, required_approver_role, attempt_outcome
--   quotes (quote_packages): freight_estimate, discount_total
--
-- New MVs:
--   mv_exec_payment_compliance — receipt + check exception rates
--   mv_exec_deposits_aging      — verification cycle + unverified count
--   mv_exec_margin_waterfall    — gross → loaded margin breakdown
--
-- Seeds 8 CFO metric definitions.
-- ============================================================================

-- ── 1. Targeted column additions ────────────────────────────────────────────
--
-- Migration 170 renamed crm_deals → qrm_deals and made crm_deals a compat
-- VIEW over qrm_deals. DDL must target the underlying qrm_* table; the
-- compat view inherits new columns automatically.

alter table public.qrm_deals
  add column if not exists loaded_margin_pct numeric,
  add column if not exists net_contribution_after_load numeric,
  add column if not exists forecast_confidence_score numeric;

comment on column public.qrm_deals.loaded_margin_pct is
  'CFO metric: net_contribution_after_load / amount. Computed by deal-composite or set manually for legacy deals.';

alter table public.deposits
  add column if not exists verification_cycle_hours numeric,
  add column if not exists refund_initiated_at timestamptz,
  add column if not exists refund_completed_at timestamptz;

comment on column public.deposits.verification_cycle_hours is
  'CFO metric: hours from received_at to verified_at. Surfaces deposit-verification SLA breaches.';

alter table public.payment_validations
  add column if not exists exception_reason text,
  add column if not exists required_approver_role text,
  add column if not exists attempt_outcome text
    check (attempt_outcome is null or attempt_outcome in ('passed', 'requires_override', 'override_granted', 'rejected'));

comment on column public.payment_validations.attempt_outcome is
  'CFO metric: lifecycle outcome for the validation attempt. Drives check_exception_count + check_exception_rate.';

-- quotes lives in public.quote_packages in this repo (see exec_quote_risk view)
alter table public.quote_packages
  add column if not exists freight_estimate numeric,
  add column if not exists discount_total numeric;

-- ── 2. Materialized views ───────────────────────────────────────────────────

drop materialized view if exists public.mv_exec_payment_compliance cascade;
create materialized view public.mv_exec_payment_compliance as
select
  pv.workspace_id,
  date_trunc('day', pv.created_at)::date as day,
  count(*)::int as total_attempts,
  count(*) filter (where pv.passed = true)::int as passed_attempts,
  count(*) filter (where pv.passed = false)::int as exception_attempts,
  count(*) filter (where pv.attempt_outcome = 'override_granted')::int as overrides,
  case when count(*) > 0
       then ((count(*) filter (where pv.passed = false))::numeric / count(*) * 100)::numeric(6,2)
       else 0 end as exception_rate_pct
from public.payment_validations pv
group by pv.workspace_id, date_trunc('day', pv.created_at)::date;

create unique index if not exists uq_mv_exec_payment_compliance
  on public.mv_exec_payment_compliance(workspace_id, day);

comment on materialized view public.mv_exec_payment_compliance is
  'QEP Command Center CFO: daily payment validation outcomes. Drives check_exception_count + check_exception_rate.';

drop materialized view if exists public.mv_exec_deposits_aging cascade;
create materialized view public.mv_exec_deposits_aging as
select
  d.workspace_id,
  count(*) filter (where d.status = 'pending')::int as pending_count,
  count(*) filter (where d.status = 'requested')::int as requested_count,
  count(*) filter (where d.status = 'received' and d.verified_at is null)::int as received_unverified_count,
  count(*) filter (where d.status = 'verified')::int as verified_count,
  count(*) filter (where d.refund_initiated_at is not null and d.refund_completed_at is null)::int as refund_in_flight_count,
  coalesce(sum(d.required_amount) filter (where d.status in ('pending', 'requested')), 0)::numeric(14,2) as ar_exposure_dollars,
  coalesce(sum(d.required_amount) filter (where d.refund_initiated_at is not null and d.refund_completed_at is null), 0)::numeric(14,2) as refund_exposure_dollars,
  coalesce(avg(d.verification_cycle_hours) filter (where d.verification_cycle_hours is not null), 0)::numeric(8,2) as avg_verification_hours
from public.deposits d
group by d.workspace_id;

create unique index if not exists uq_mv_exec_deposits_aging
  on public.mv_exec_deposits_aging(workspace_id);

comment on materialized view public.mv_exec_deposits_aging is
  'QEP Command Center CFO: deposit pipeline + AR exposure + refund exposure + verification SLA.';

drop materialized view if exists public.mv_exec_margin_waterfall cascade;
create materialized view public.mv_exec_margin_waterfall as
select
  d.workspace_id,
  date_trunc('month', d.closed_at)::date as month,
  coalesce(sum(d.amount), 0)::numeric(14,2) as revenue,
  coalesce(sum(d.margin_amount), 0)::numeric(14,2) as gross_margin_dollars,
  coalesce(sum(d.net_contribution_after_load), 0)::numeric(14,2) as net_contribution_dollars,
  coalesce(sum(d.amount - coalesce(d.net_contribution_after_load, d.margin_amount)), 0)::numeric(14,2) as load_dollars,
  case when sum(d.amount) > 0
       then (sum(coalesce(d.net_contribution_after_load, d.margin_amount)) / sum(d.amount) * 100)::numeric(6,2)
       else null end as loaded_margin_pct
-- Reference qrm_deals directly because the crm_deals compat view from
-- mig 170 is a frozen SELECT * snapshot and doesn't surface the new
-- net_contribution_after_load column added at the top of this migration.
from public.qrm_deals d
join public.qrm_deal_stages s on s.id = d.stage_id
where d.deleted_at is null
  and s.is_closed_won = true
  and d.closed_at is not null
group by d.workspace_id, date_trunc('month', d.closed_at)::date;

create unique index if not exists uq_mv_exec_margin_waterfall
  on public.mv_exec_margin_waterfall(workspace_id, month);

comment on materialized view public.mv_exec_margin_waterfall is
  'QEP Command Center CFO: monthly gross→loaded margin waterfall. Drives loaded_margin_pct + margin leakage explorer.';

-- ── 3. Extend refresh helper to include the new MVs ────────────────────────

create or replace function public.refresh_exec_materialized_views()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin refresh materialized view concurrently public.mv_exec_revenue_daily;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_revenue_daily; end;
  begin refresh materialized view concurrently public.mv_exec_pipeline_stage_summary;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_pipeline_stage_summary; end;
  begin refresh materialized view concurrently public.mv_exec_margin_daily;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_margin_daily; end;
  begin refresh materialized view concurrently public.mv_exec_payment_compliance;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_payment_compliance; end;
  begin refresh materialized view concurrently public.mv_exec_deposits_aging;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_deposits_aging; end;
  begin refresh materialized view concurrently public.mv_exec_margin_waterfall;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_margin_waterfall; end;
end;
$$;

-- ── 4. Seed 8 CFO metric definitions ───────────────────────────────────────

insert into public.analytics_metric_definitions
  (metric_key, label, description, formula_text, display_category, owner_role,
   source_tables, refresh_cadence, drill_contract, threshold_config)
values
  ('cash_collected_mtd',
   'Cash Collected (MTD)',
   'Verified deposits + closed-won revenue collected month-to-date',
   'sum(deposits.required_amount) where status=verified and verified_at >= start_of_month',
   'finance_controls', 'cfo',
   '["deposits", "crm_deals"]'::jsonb,
   'hourly',
   '{"drill_view": "deposits", "filter": "verified_mtd"}'::jsonb,
   '{}'::jsonb),

  ('ar_exposure_total',
   'A/R Exposure',
   'Open receivables: pending + requested deposits',
   'sum(deposits.required_amount) where status in (pending, requested)',
   'finance_controls', 'cfo',
   '["deposits"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "deposits", "filter": "open"}'::jsonb,
   '{"warn_above": 250000, "critical_above": 500000}'::jsonb),

  ('unverified_deposit_count',
   'Unverified Deposits',
   'Received deposits awaiting verification',
   'count(deposits) where status=received and verified_at is null',
   'finance_controls', 'cfo',
   '["deposits"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "deposits", "filter": "received_unverified"}'::jsonb,
   '{"warn_above": 5, "critical_above": 15}'::jsonb),

  ('refund_exposure_total',
   'Refund Exposure',
   'Refunds initiated but not yet completed',
   'sum(deposits.required_amount) where refund_initiated_at is not null and refund_completed_at is null',
   'finance_controls', 'cfo',
   '["deposits"]'::jsonb,
   'hourly',
   '{"drill_view": "deposits", "filter": "refund_in_flight"}'::jsonb,
   '{"warn_above": 50000, "critical_above": 150000}'::jsonb),

  ('check_exception_count',
   'Check Exceptions',
   'Payment validations that failed or required override (last 30d)',
   'count(payment_validations) where passed=false and created_at > now() - 30d',
   'finance_controls', 'cfo',
   '["payment_validations"]'::jsonb,
   'hourly',
   '{"drill_view": "payment_validations", "filter": "exceptions_30d"}'::jsonb,
   '{"warn_above": 10, "critical_above": 30}'::jsonb),

  ('receipt_compliance_rate',
   'Receipt Compliance',
   'Pct of payment validations passing on first attempt',
   '(count where passed=true and attempt_outcome != requires_override) / count(*) * 100',
   'finance_controls', 'cfo',
   '["payment_validations"]'::jsonb,
   'hourly',
   '{"drill_view": "payment_validations", "filter": "all_30d"}'::jsonb,
   '{"warn_below": 90, "critical_below": 75}'::jsonb),

  ('hauling_recovery_rate',
   'Hauling Recovery',
   'Hauling billed to customers vs hauling cost incurred',
   'sum(hauling_billed) / nullif(sum(hauling_cost), 0) * 100',
   'finance_controls', 'cfo',
   '["crm_deals", "quote_packages"]'::jsonb,
   'daily',
   '{"drill_view": "deals", "filter": "with_hauling"}'::jsonb,
   '{"warn_below": 80, "critical_below": 60, "stub": "wired_in_slice_4"}'::jsonb),

  ('loaded_margin_pct',
   'Loaded Margin %',
   'Net contribution after load divided by revenue',
   'sum(net_contribution_after_load) / nullif(sum(amount), 0) * 100',
   'financial', 'cfo',
   '["crm_deals", "mv_exec_margin_waterfall"]'::jsonb,
   'hourly',
   '{"drill_view": "margin_waterfall"}'::jsonb,
   '{"warn_below": 14, "critical_below": 10}'::jsonb)
on conflict (metric_key) do nothing;
