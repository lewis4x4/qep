-- 525_intellidealer_ap_aging_summary.sql
--
-- Phase 8 Accounts Payable Outstanding summary buckets.
-- The existing ap_aging_view and v_vendor_invoice_aging expose detail rows.
-- This view adds the aggregate bucket columns referenced by the IntelliDealer
-- AP Outstanding screen without replacing either detail view.

create or replace view public.v_ap_outstanding_summary
  with (security_invoker = true) as
select
  vi.workspace_id,
  'due_date'::text as aging_basis,
  sum(case when vi.due_date >= current_date then vi.balance_due else 0 end) as current_amount,
  sum(case when vi.due_date < current_date and vi.due_date >= current_date - interval '1 month' then vi.balance_due else 0 end) as bucket_month_1,
  sum(case when vi.due_date < current_date - interval '1 month' and vi.due_date >= current_date - interval '2 months' then vi.balance_due else 0 end) as bucket_month_2,
  sum(case when vi.due_date < current_date - interval '2 months' and vi.due_date >= current_date - interval '3 months' then vi.balance_due else 0 end) as bucket_month_3,
  sum(case when vi.due_date < current_date - interval '3 months' then vi.balance_due else 0 end) as bucket_after_3,
  sum(vi.balance_due) as total_outstanding,
  count(*)::integer as open_invoice_count,
  min(vi.due_date) as oldest_due_date,
  max(vi.invoice_date) as latest_invoice_date
from public.vendor_invoices vi
where vi.deleted_at is null
  and vi.status in ('open', 'partial')
  and vi.balance_due <> 0
group by vi.workspace_id;

comment on view public.v_ap_outstanding_summary is
  'Phase 8 IntelliDealer AP Outstanding summary buckets over vendor_invoices. Complements ap_aging_view/v_vendor_invoice_aging detail rows.';
