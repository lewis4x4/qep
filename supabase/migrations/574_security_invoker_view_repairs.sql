-- Repair Supabase advisor ERRORs for views that should evaluate caller RLS.
-- The view definitions are unchanged; only the security context is made
-- explicit so callers do not inherit owner privileges through REST.

alter view public.crm_deal_stage_groups set (security_invoker = true);
alter view public.oem_portal_credentials_safe set (security_invoker = true);
alter view public.pdi_average_by_model set (security_invoker = true);

alter table public.customer_invoices
  add column if not exists quickbooks_gl_status text not null default 'not_synced',
  add column if not exists quickbooks_gl_txn_id text,
  add column if not exists quickbooks_gl_synced_at timestamptz,
  add column if not exists quickbooks_gl_last_error text;

alter table public.customer_invoices
  drop constraint if exists customer_invoices_quickbooks_gl_status_chk;

alter table public.customer_invoices
  add constraint customer_invoices_quickbooks_gl_status_chk
  check (quickbooks_gl_status in ('not_synced', 'queued', 'posted', 'failed'));

create index if not exists idx_customer_invoices_qb_gl_status
  on public.customer_invoices (workspace_id, quickbooks_gl_status, invoice_date desc, id desc)
  where quickbooks_gl_status <> 'not_synced';

comment on view public.crm_deal_stage_groups is
  '21-stage pipeline collapsed into 5 operator buckets. SECURITY INVOKER so qrm_deal_stages RLS applies to the caller.';

comment on view public.oem_portal_credentials_safe is
  'Operator-safe projection of oem_portal_credentials metadata only. SECURITY INVOKER preserves base-table RLS and avoids ciphertext exposure through owner privileges.';

comment on view public.pdi_average_by_model is
  'Workspace-scoped rolling average PDI cost by make/model for quote prefill. SECURITY INVOKER so pdi_actuals RLS applies to the caller.';

comment on column public.customer_invoices.quickbooks_gl_status is
  'QuickBooks GL sync state used by equipment sale reversal policy and GL posting workflows.';
comment on column public.customer_invoices.quickbooks_gl_txn_id is
  'QuickBooks transaction id after invoice GL sync succeeds.';
comment on column public.customer_invoices.quickbooks_gl_synced_at is
  'Timestamp of the most recent successful QuickBooks GL sync for this invoice.';
comment on column public.customer_invoices.quickbooks_gl_last_error is
  'Most recent QuickBooks GL sync error message for this invoice.';
