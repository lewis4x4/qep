-- ============================================================================
-- Migration 352: QuickBooks GL Sync
--
-- Rollback notes:
--   1. Drop trigger set_quickbooks_gl_sync_jobs_updated_at.
--   2. Drop indexes idx_quickbooks_gl_sync_jobs_status and
--      idx_quickbooks_gl_sync_jobs_invoice.
--   3. Drop policies on quickbooks_gl_sync_jobs.
--   4. Drop table quickbooks_gl_sync_jobs.
--   5. Drop customer_invoices quickbooks_* columns if no downstream slice
--      depends on them.
-- ============================================================================

alter table public.customer_invoices
  add column if not exists quickbooks_gl_status text not null default 'not_synced'
    check (quickbooks_gl_status in ('not_synced', 'queued', 'processing', 'posted', 'failed'));

alter table public.customer_invoices
  add column if not exists quickbooks_gl_txn_id text;

alter table public.customer_invoices
  add column if not exists quickbooks_gl_synced_at timestamptz;

alter table public.customer_invoices
  add column if not exists quickbooks_gl_last_error text;

comment on column public.customer_invoices.quickbooks_gl_status is
  'QuickBooks GL posting state for this invoice.';

create table public.quickbooks_gl_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  invoice_id uuid not null references public.customer_invoices(id) on delete cascade,
  source_type text not null default 'customer_invoice' check (source_type = 'customer_invoice'),
  posting_mode text not null default 'journal_entry' check (posting_mode = 'journal_entry'),
  status text not null default 'queued' check (status in ('queued', 'processing', 'posted', 'failed')),
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  quickbooks_txn_id text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id)
);

comment on table public.quickbooks_gl_sync_jobs is
  'Queue and audit trail for posting QEP invoices into QuickBooks Online general ledger.';

alter table public.quickbooks_gl_sync_jobs enable row level security;

create policy "quickbooks_gl_sync_jobs_select"
  on public.quickbooks_gl_sync_jobs for select
  using (workspace_id = public.get_my_workspace());

create policy "quickbooks_gl_sync_jobs_insert"
  on public.quickbooks_gl_sync_jobs for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "quickbooks_gl_sync_jobs_update"
  on public.quickbooks_gl_sync_jobs for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "quickbooks_gl_sync_jobs_delete"
  on public.quickbooks_gl_sync_jobs for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "quickbooks_gl_sync_jobs_service_all"
  on public.quickbooks_gl_sync_jobs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_quickbooks_gl_sync_jobs_status
  on public.quickbooks_gl_sync_jobs(workspace_id, status, created_at desc);

create index idx_quickbooks_gl_sync_jobs_invoice
  on public.quickbooks_gl_sync_jobs(invoice_id);

create trigger set_quickbooks_gl_sync_jobs_updated_at
  before update on public.quickbooks_gl_sync_jobs
  for each row execute function public.set_updated_at();

insert into public.integration_status (
  workspace_id,
  integration_key,
  display_name,
  status,
  auth_type,
  sync_frequency,
  config
)
select
  'default',
  'quickbooks',
  'QuickBooks Online',
  'pending_credentials',
  'oauth_app',
  'manual',
  '{"sync_mode":"journal_entry"}'::jsonb
where not exists (
  select 1
  from public.integration_status
  where workspace_id = 'default'
    and integration_key = 'quickbooks'
);
