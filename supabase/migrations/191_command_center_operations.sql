-- ============================================================================
-- Migration 191: QEP Moonshot Command Center — Operations / COO (Slice 4)
--
-- Adds the columns + materialized views the COO lens needs. Same per-slice
-- discipline as mig 190 — only what the 8 COO KPIs actually consume.
--
-- New columns:
--   traffic_tickets: requested_at, scheduled_confirmed_at, departed_at,
--                    completed_at, promised_delivery_at, late_reason,
--                    proof_of_delivery_complete, blocker_reason
--   crm_equipment:   intake_stage, readiness_status, readiness_blocker_reason,
--                    sale_ready_at, aging_bucket
--   rental_returns:  inspection_started_at, decision_at, aging_bucket
--
-- New MVs:
--   mv_exec_traffic_summary       — on-time rate + at-risk + cycle time
--   mv_exec_inventory_readiness    — sale-ready + blocked + intake stalled
--   mv_exec_rental_return_summary  — aging buckets + open inspections
--
-- Seeds 8 COO metric definitions.
-- ============================================================================

-- ── 1. Column additions ────────────────────────────────────────────────────

alter table public.traffic_tickets
  add column if not exists requested_at timestamptz,
  add column if not exists scheduled_confirmed_at timestamptz,
  add column if not exists departed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists promised_delivery_at timestamptz,
  add column if not exists late_reason text,
  add column if not exists proof_of_delivery_complete boolean default false,
  add column if not exists blocker_reason text;

comment on column public.traffic_tickets.promised_delivery_at is
  'COO metric: customer-facing promised delivery. on_time_delivery_rate compares completed_at to this.';

create index if not exists idx_traffic_tickets_promised
  on public.traffic_tickets(promised_delivery_at)
  where status != 'completed';

create index if not exists idx_traffic_tickets_completed
  on public.traffic_tickets(completed_at desc)
  where completed_at is not null;

-- Migration 170 renamed crm_equipment → qrm_equipment; crm_equipment is
-- now a compat view. Target the underlying table for DDL.
alter table public.qrm_equipment
  add column if not exists intake_stage integer,
  add column if not exists readiness_status text,
  add column if not exists readiness_blocker_reason text,
  add column if not exists sale_ready_at timestamptz,
  add column if not exists aging_bucket text;

comment on column public.qrm_equipment.readiness_status is
  'COO metric: blocked|in_prep|ready. Drives units_not_ready_count + demo_readiness_rate.';

create index if not exists idx_qrm_equipment_readiness
  on public.qrm_equipment(readiness_status)
  where readiness_status is not null;

alter table public.rental_returns
  add column if not exists inspection_started_at timestamptz,
  add column if not exists decision_at timestamptz,
  add column if not exists aging_bucket text;

comment on column public.rental_returns.aging_bucket is
  'COO metric: 0-3d, 4-7d, 8-14d, 15+d. Drives rental_returns_aging_count.';

-- ── 2. Materialized views ───────────────────────────────────────────────────

drop materialized view if exists public.mv_exec_traffic_summary cascade;
create materialized view public.mv_exec_traffic_summary as
select
  t.workspace_id,
  date_trunc('day', coalesce(t.completed_at, t.created_at))::date as day,
  count(*)::int as total_tickets,
  count(*) filter (where t.status = 'completed')::int as completed,
  count(*) filter (where t.status = 'completed' and t.promised_delivery_at is not null and t.completed_at <= t.promised_delivery_at)::int as completed_on_time,
  count(*) filter (where t.status != 'completed' and t.promised_delivery_at is not null and t.promised_delivery_at < now() + interval '24 hours')::int as at_risk_24h,
  count(*) filter (where t.blocker_reason is not null and t.status != 'completed')::int as blocked,
  case when count(*) filter (where t.status = 'completed' and t.promised_delivery_at is not null) > 0
       then ((count(*) filter (where t.status = 'completed' and t.promised_delivery_at is not null and t.completed_at <= t.promised_delivery_at))::numeric
             / (count(*) filter (where t.status = 'completed' and t.promised_delivery_at is not null))::numeric * 100)::numeric(6,2)
       else null end as on_time_rate_pct,
  coalesce(avg(extract(epoch from t.completed_at - t.created_at) / 3600) filter (where t.completed_at is not null), 0)::numeric(8,2) as avg_cycle_time_hours
from public.traffic_tickets t
group by t.workspace_id, date_trunc('day', coalesce(t.completed_at, t.created_at))::date;

create unique index if not exists uq_mv_exec_traffic_summary
  on public.mv_exec_traffic_summary(workspace_id, day);

drop materialized view if exists public.mv_exec_inventory_readiness cascade;
create materialized view public.mv_exec_inventory_readiness as
select
  e.workspace_id,
  count(*)::int as total_units,
  count(*) filter (where e.readiness_status = 'ready')::int as ready_units,
  count(*) filter (where e.readiness_status = 'in_prep')::int as in_prep_units,
  count(*) filter (where e.readiness_status = 'blocked')::int as blocked_units,
  count(*) filter (where e.intake_stage is not null and e.intake_stage < 5)::int as intake_stalled,
  case when count(*) > 0
       then ((count(*) filter (where e.readiness_status = 'ready'))::numeric / count(*) * 100)::numeric(6,2)
       else 0 end as ready_rate_pct
-- Read from qrm_equipment directly — the crm_equipment compat view is a
-- frozen SELECT * snapshot that doesn't see the new readiness_status /
-- intake_stage columns added at the top of this migration.
from public.qrm_equipment e
where e.deleted_at is null
group by e.workspace_id;

create unique index if not exists uq_mv_exec_inventory_readiness
  on public.mv_exec_inventory_readiness(workspace_id);

drop materialized view if exists public.mv_exec_rental_return_summary cascade;
create materialized view public.mv_exec_rental_return_summary as
select
  rr.workspace_id,
  count(*) filter (where rr.status != 'completed')::int as open_returns,
  count(*) filter (where rr.aging_bucket = '0-3d')::int as fresh_returns,
  count(*) filter (where rr.aging_bucket in ('8-14d', '15+d'))::int as aging_returns,
  count(*) filter (where rr.refund_status = 'pending' and rr.status != 'completed')::int as refund_pending,
  coalesce(avg(extract(epoch from rr.decision_at - rr.inspection_started_at) / 3600) filter (where rr.decision_at is not null and rr.inspection_started_at is not null), 0)::numeric(8,2) as avg_resolution_hours
from public.rental_returns rr
group by rr.workspace_id;

create unique index if not exists uq_mv_exec_rental_return_summary
  on public.mv_exec_rental_return_summary(workspace_id);

-- ── 3. Refresh helper extension ─────────────────────────────────────────────

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
  begin refresh materialized view concurrently public.mv_exec_traffic_summary;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_traffic_summary; end;
  begin refresh materialized view concurrently public.mv_exec_inventory_readiness;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_inventory_readiness; end;
  begin refresh materialized view concurrently public.mv_exec_rental_return_summary;
  exception when feature_not_supported or invalid_table_definition then refresh materialized view public.mv_exec_rental_return_summary; end;
end;
$$;

-- ── 4. Seed 8 COO metric definitions ────────────────────────────────────────

insert into public.analytics_metric_definitions
  (metric_key, label, description, formula_text, display_category, owner_role,
   source_tables, refresh_cadence, drill_contract, threshold_config)
values
  ('on_time_delivery_rate_today',
   'On-Time Delivery (today)',
   'Pct of today''s completed deliveries that hit promised_delivery_at',
   '(completed where completed_at <= promised_delivery_at) / completed * 100',
   'logistics', 'coo',
   '["traffic_tickets", "mv_exec_traffic_summary"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "traffic_tickets", "filter": "completed_today"}'::jsonb,
   '{"warn_below": 90, "critical_below": 75}'::jsonb),

  ('scheduled_moves_at_risk_count',
   'Moves at risk (24h)',
   'Open traffic tickets with promised_delivery_at within 24h',
   'count where status != completed and promised_delivery_at < now() + 24h',
   'logistics', 'coo',
   '["traffic_tickets"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "traffic_tickets", "filter": "at_risk_24h"}'::jsonb,
   '{"warn_above": 5, "critical_above": 15}'::jsonb),

  ('units_not_ready_count',
   'Units not ready',
   'Equipment in blocked or in_prep readiness status',
   'count(crm_equipment) where readiness_status in (blocked, in_prep)',
   'inventory', 'coo',
   '["crm_equipment", "mv_exec_inventory_readiness"]'::jsonb,
   'hourly',
   '{"drill_view": "equipment", "filter": "not_ready"}'::jsonb,
   '{"warn_above": 10, "critical_above": 30}'::jsonb),

  ('traffic_cycle_time_avg',
   'Traffic cycle time (avg)',
   'Average hours from ticket creation to completion (last 30d)',
   'avg(completed_at - created_at) where completed_at > now() - 30d',
   'logistics', 'coo',
   '["traffic_tickets", "mv_exec_traffic_summary"]'::jsonb,
   'hourly',
   '{"drill_view": "traffic_tickets", "filter": "completed_30d"}'::jsonb,
   '{"warn_above": 48, "critical_above": 96}'::jsonb),

  ('intake_units_stalled_count',
   'Intake stalled',
   'Equipment in intake_stage < 5 (not yet to inspection)',
   'count(crm_equipment) where intake_stage < 5',
   'inventory', 'coo',
   '["crm_equipment"]'::jsonb,
   'hourly',
   '{"drill_view": "equipment", "filter": "intake_stalled"}'::jsonb,
   '{"warn_above": 5, "critical_above": 15}'::jsonb),

  ('rental_returns_aging_count',
   'Rental returns aging',
   'Open rental returns in 8-14d or 15+d aging bucket',
   'count(rental_returns) where aging_bucket in (8-14d, 15+d) and status != completed',
   'logistics', 'coo',
   '["rental_returns", "mv_exec_rental_return_summary"]'::jsonb,
   'hourly',
   '{"drill_view": "rental_returns", "filter": "aging"}'::jsonb,
   '{"warn_above": 3, "critical_above": 10}'::jsonb),

  ('demo_readiness_rate',
   'Demo readiness',
   'Pct of demo equipment in ready status',
   '(equipment where readiness_status=ready and ticket_type=demo) / total demo equipment * 100',
   'inventory', 'coo',
   '["crm_equipment", "traffic_tickets"]'::jsonb,
   'hourly',
   '{"drill_view": "equipment", "filter": "demo_inventory"}'::jsonb,
   '{"warn_below": 80, "critical_below": 60}'::jsonb),

  ('repeat_failure_index',
   'Repeat failure index',
   'Pct of failures matching one of the top 3 root-cause patterns',
   'repeated_failures / total_failures * 100',
   'synthetic', 'coo',
   '["traffic_tickets", "anomaly_alerts", "exception_queue"]'::jsonb,
   'daily',
   '{"drill_view": "failure_pattern"}'::jsonb,
   '{"warn_above": 30, "critical_above": 60, "stub": "v1_rule_weighted"}'::jsonb)
on conflict (metric_key) do nothing;
