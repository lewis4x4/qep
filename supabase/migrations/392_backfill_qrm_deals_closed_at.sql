-- 392_backfill_qrm_deals_closed_at.sql
--
-- The Owner BU Pulse "Equipment MTD $" tile and the Revenue Pace widget
-- both filter qrm_deals on closed_at. The seed data from earlier
-- migrations populated deal stages (moving 4 deals to closed-won
-- equivalents) but never set qrm_deals.closed_at, so MTD sums return
-- zero.
--
-- Backfills closed_at = updated_at for every deal currently sitting in
-- a closed-won stage with a null closed_at. Idempotent — only touches
-- rows that need it.
--
-- Closed-won stages (verified in qrm_deal_stages):
--   - Invoice Closed
--   - Post-Sale Follow-Up
--   - Sales Order Signed
--   - Deposit Collected

update public.qrm_deals d
set closed_at = d.updated_at
from public.qrm_deal_stages s
where s.id = d.stage_id
  and s.name in (
    'Invoice Closed',
    'Post-Sale Follow-Up',
    'Sales Order Signed',
    'Deposit Collected'
  )
  and d.deleted_at is null
  and d.closed_at  is null;
