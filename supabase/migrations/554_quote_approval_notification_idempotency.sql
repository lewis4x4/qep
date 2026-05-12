-- Quote approval bell notification idempotency.
-- One pending quote-approval notification per recipient and approval case.
--
-- Targets the underlying renamed table public.qrm_in_app_notifications
-- (migration 170 renamed crm_in_app_notifications -> qrm_in_app_notifications
-- and left a compat view at the old name). Indexes cannot be created on
-- views, so this index lives on the qrm_* table; inserts through the
-- compat view still route through this index because the view is a
-- simple, auto-updatable security_invoker view.

create unique index if not exists qrm_in_app_notifications_quote_approval_case_once
  on public.qrm_in_app_notifications (user_id, (metadata->>'quote_approval_case_id'))
  where kind = 'quote_approval_pending'
    and metadata ? 'quote_approval_case_id';
