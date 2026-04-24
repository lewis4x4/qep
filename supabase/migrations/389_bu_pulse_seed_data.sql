-- 388_bu_pulse_seed_data.sql
--
-- Seeds realistic 60-day operational data across three business units so
-- the Owner /floor BU Pulse strip renders non-zero values:
--   - Parts:    15 parts_orders + matching customer_invoices
--   - Service:  close 10 existing service_jobs + seed TAT metrics
--               (calibrated to ~82% on-SLA)
--   - Rentals:  10 rental_contracts (spread across active/completed/
--               approved/quoted statuses)
--   - Stockouts: bump reorder_point on 5 SKUs so stockout count renders
--
-- Scope: workspace_id='default' only. Links to existing qrm_companies,
--   qrm_equipment, service_jobs, portal_customers (no new customer rows).
-- Deterministic IDs are prefixed 51... 52... 53... so re-running is a no-op
--   via ON CONFLICT. Service UPDATE is a one-shot operation gated by
--   closed_at IS NULL; once applied, re-runs are safe.

begin;

-- ============================================================================
-- PART 1 — PARTS: create 15 parts_orders, then 15 customer_invoices
-- ============================================================================

with days_back as (
  select
    n,
    ('51000000-0000-7000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid as order_id,
    ('52000000-0000-7000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid as invoice_id,
    round((60 + random() * 4000)::numeric, 2) as subtotal,
    now() - (((60 - n * 4))::int || ' days')::interval as created_at,
    (select id from public.qrm_companies
       where deleted_at is null
       order by id
       offset (n % 18) limit 1) as company_id
  from generate_series(1, 15) n
),
ins_orders as (
  insert into public.parts_orders (
    id, workspace_id, crm_company_id, order_source, status, subtotal, total, created_at
  )
  select
    order_id,
    'default',
    company_id,
    'counter',
    case when n % 6 = 0 then 'submitted' else 'delivered' end,
    subtotal,
    round(subtotal * 1.08, 2),
    created_at
  from days_back
  on conflict (id) do nothing
  returning id
)
insert into public.customer_invoices (
  id, workspace_id, crm_company_id, parts_order_id, status,
  amount, total, amount_paid,
  due_date, paid_at, created_at
)
select
  db.invoice_id,
  'default',
  db.company_id,
  db.order_id,
  case when random() < 0.7 then 'paid' else 'sent' end,
  db.subtotal,
  round(db.subtotal * 1.08, 2),
  case when random() < 0.7 then round(db.subtotal * 1.08, 2) else 0::numeric end,
  (db.created_at + interval '30 days')::date,
  case when random() < 0.7 then db.created_at + interval '10 days' else null end,
  db.created_at + interval '1 day'
from days_back db
where exists (select 1 from public.parts_orders po where po.id = db.order_id)
on conflict (id) do nothing;

-- ============================================================================
-- PART 2 — SERVICE: close 10 jobs + seed service_tat_metrics
-- ============================================================================

-- Close 10 oldest open jobs in the default workspace with a realistic
-- closed_at in the last 60 days and an invoice_total.
update public.service_jobs
set
  closed_at = now() - (((random() * 60)::int)::text || ' days')::interval,
  invoice_total = round((random() * 3500 + 500)::numeric, 2),
  quote_total = coalesce(quote_total, round((random() * 3500 + 500)::numeric, 2)),
  updated_at = now()
where id in (
  select id from public.service_jobs
  where workspace_id = 'default' and closed_at is null
  order by created_at asc
  limit 10
);

-- Seed TAT metrics for the closed jobs — 82% on-SLA, 15% machine-down.
insert into public.service_tat_metrics (
  id, workspace_id, job_id, segment_name,
  started_at, completed_at,
  target_duration_hours, actual_duration_hours,
  is_machine_down
)
select
  gen_random_uuid(),
  'default',
  sj.id,
  'diagnose_to_complete',
  sj.closed_at - interval '8 hours',
  sj.closed_at,
  24,
  case when random() < 0.82 then round((random() * 22 + 2)::numeric, 2)
       else round((random() * 24 + 24)::numeric, 2) end,
  random() < 0.15
from public.service_jobs sj
where sj.workspace_id = 'default'
  and sj.closed_at is not null
  and not exists (
    select 1 from public.service_tat_metrics tat
    where tat.job_id = sj.id
      and tat.segment_name = 'diagnose_to_complete'
  );

-- ============================================================================
-- PART 3 — RENTALS: 10 rental_contracts
-- ============================================================================

-- Round-robin across the 3 existing portal_customers and 15 qrm_equipment.
-- Status spread: 4 active, 2 completed, 2 approved, 2 quoted.
insert into public.rental_contracts (
  id, workspace_id, portal_customer_id, equipment_id,
  delivery_mode, request_type,
  requested_start_date, requested_end_date,
  approved_start_date, approved_end_date,
  status,
  estimate_daily_rate, estimate_weekly_rate, estimate_monthly_rate,
  agreed_daily_rate, agreed_weekly_rate, agreed_monthly_rate,
  deposit_required, deposit_amount, deposit_status,
  assignment_status,
  created_at, updated_at
)
select
  ('53000000-0000-7000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid,
  'default',
  (array['a1000000-0000-4000-8000-000000000001'::uuid,
         'f0000008-0000-4000-8000-000000000001'::uuid,
         'f0000008-0000-4000-8000-000000000002'::uuid])[(n % 3) + 1],
  (select id from public.qrm_equipment
     where deleted_at is null
     order by id
     offset (n % 15) limit 1),
  case when n % 2 = 0 then 'delivery' else 'pickup' end,
  'booking',
  (now() - (((60 - n * 6))::int || ' days')::interval)::date,
  (now() - (((60 - n * 6 - 14))::int || ' days')::interval)::date,
  (now() - (((60 - n * 6))::int || ' days')::interval)::date,
  (now() - (((60 - n * 6 - 14))::int || ' days')::interval)::date,
  case
    when n <= 4 then 'active'
    when n <= 6 then 'completed'
    when n <= 8 then 'approved'
    else 'quoted'
  end,
  round((random() * 400 + 150)::numeric, 2),
  round((random() * 2000 + 800)::numeric, 2),
  round((random() * 7000 + 3000)::numeric, 2),
  round((random() * 400 + 150)::numeric, 2),
  round((random() * 2000 + 800)::numeric, 2),
  round((random() * 7000 + 3000)::numeric, 2),
  true,
  round((random() * 2000 + 500)::numeric, 2),
  case when n % 3 = 0 then 'pending' else 'paid' end,
  'assigned',
  now() - (((60 - n * 6))::int || ' days')::interval,
  now() - (((60 - n * 6 - 1))::int || ' days')::interval
from generate_series(1, 10) n
on conflict (id) do nothing;

-- ============================================================================
-- PART 4 — STOCKOUTS: bump reorder_point on 5 low-qty parts catalog entries
-- so the stockout aggregation returns a non-zero count.
-- ============================================================================

update public.parts_catalog pc
set reorder_point = pi.qty_on_hand + 5
from public.parts_inventory pi
where pi.catalog_id = pc.id
  and pi.deleted_at is null
  and pi.id in (
    select pi2.id from public.parts_inventory pi2
    where pi2.deleted_at is null
    order by pi2.qty_on_hand asc
    limit 5
  );

commit;
