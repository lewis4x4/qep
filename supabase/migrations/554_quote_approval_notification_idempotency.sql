-- Quote approval bell notification idempotency.
-- One pending quote-approval notification per recipient and approval case.

create unique index if not exists crm_in_app_notifications_quote_approval_case_once
  on public.crm_in_app_notifications (user_id, (metadata->>'quote_approval_case_id'))
  where kind = 'quote_approval_pending'
    and metadata ? 'quote_approval_case_id';
