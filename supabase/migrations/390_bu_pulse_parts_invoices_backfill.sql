-- 390_bu_pulse_parts_invoices_backfill.sql
--
-- Completes the BU Pulse seed from migration 389.
--
-- Migration 389 successfully seeded 15 parts_orders, 10 closed service_jobs,
-- 10 service_tat_metrics, 10 rental_contracts, and 8 low-stock SKUs — but
-- the customer_invoices INSERT used an EXISTS check on the same statement's
-- snapshot of parts_orders and rendered zero matches, so no parts invoices
-- were created. Parts MTD revenue consequently reads as NULL.
--
-- This migration runs the invoices INSERT against the now-persisted
-- parts_orders rows. Deterministic IDs (52... prefix) so re-runs are safe.

insert into public.customer_invoices (
  id, workspace_id, crm_company_id, parts_order_id, invoice_number, status,
  amount, total, amount_paid,
  due_date, paid_at, created_at
)
select
  ('52000000-0000-7000-8000-0000000003'
     || lpad(row_number() over (order by po.created_at)::text, 2, '0'))::uuid as id,
  'default',
  po.crm_company_id,
  po.id,
  'INV-2026-P' || lpad(row_number() over (order by po.created_at)::text, 4, '0'),
  case when random() < 0.7 then 'paid' else 'sent' end,
  po.subtotal,
  po.total,
  case when random() < 0.7 then po.total else 0::numeric end,
  (po.created_at + interval '30 days')::date,
  case when random() < 0.7 then po.created_at + interval '10 days' else null end,
  po.created_at + interval '1 day'
from public.parts_orders po
where po.workspace_id = 'default'
  and po.id::text like '51000000-0000-7000-8000-%'
  and not exists (
    select 1 from public.customer_invoices ci
    where ci.parts_order_id = po.id
  )
on conflict (id) do nothing;
