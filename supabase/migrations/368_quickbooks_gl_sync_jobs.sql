-- ============================================================================
-- Migration 368: Create quickbooks_gl_sync_jobs
--
-- The QuickBooks GL sync feature (admin page + quickbooks-gl-sync edge
-- function) references this table in multiple places, but no prior
-- migration ever created it. The admin page was crashing 400 every load
-- and the edge function failed on every sync attempt.
--
-- Shape inferred from actual usage in:
--   - supabase/functions/quickbooks-gl-sync/index.ts (upsert + update)
--   - apps/web/src/features/admin/pages/QuickBooksGlSyncPage.tsx (select)
-- ============================================================================

create table if not exists public.quickbooks_gl_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Source record this sync job covers. `invoice_id` is the upsert
  -- conflict target in the edge function, so it must be unique per row.
  invoice_id uuid not null references public.customer_invoices(id) on delete cascade,
  source_type text not null default 'customer_invoice'
    check (source_type in ('customer_invoice')),

  -- How the GL entry is posted in QuickBooks.
  posting_mode text not null default 'journal_entry'
    check (posting_mode in ('journal_entry')),

  -- Lifecycle. `processing` is set before the API call; the call updates
  -- to `posted` on success or `failed` on error. `pending` is reserved
  -- for rows queued but not yet attempted.
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'posted', 'failed', 'skipped')),

  attempt_count integer not null default 0,
  last_attempt_at timestamptz,

  -- Populated on a successful post.
  quickbooks_txn_id text,
  request_payload jsonb,
  response_payload jsonb,

  -- Populated on failure. Null when status is posted.
  error_message text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (invoice_id)
);

comment on table public.quickbooks_gl_sync_jobs is
  'One row per invoice that is being synced (or has been synced) into QuickBooks as a GL journal entry. Updated inline by the quickbooks-gl-sync edge function.';

create index if not exists idx_quickbooks_gl_sync_jobs_workspace_created
  on public.quickbooks_gl_sync_jobs (workspace_id, created_at desc);
create index if not exists idx_quickbooks_gl_sync_jobs_status
  on public.quickbooks_gl_sync_jobs (workspace_id, status, last_attempt_at desc)
  where status in ('processing', 'failed', 'pending');

-- Touch updated_at on every write so status transitions are auditable.
create or replace function public.quickbooks_gl_sync_jobs_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_quickbooks_gl_sync_jobs_touch
  on public.quickbooks_gl_sync_jobs;
create trigger trg_quickbooks_gl_sync_jobs_touch
  before update on public.quickbooks_gl_sync_jobs
  for each row execute function public.quickbooks_gl_sync_jobs_touch_updated_at();

alter table public.quickbooks_gl_sync_jobs enable row level security;

-- Read access: admins/managers/owners for their workspace. Reps see nothing
-- because GL sync is an accounting concern, not a sales one.
drop policy if exists "qbgsj_select_elevated" on public.quickbooks_gl_sync_jobs;
create policy "qbgsj_select_elevated"
  on public.quickbooks_gl_sync_jobs
  for select
  to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

-- Writes are service-role only. The edge function runs under service_role
-- and PostgREST bypasses RLS for that role, so no write policy needed —
-- but we pin it explicitly so nobody can INSERT/UPDATE from the frontend.
drop policy if exists "qbgsj_service_all" on public.quickbooks_gl_sync_jobs;
create policy "qbgsj_service_all"
  on public.quickbooks_gl_sync_jobs
  for all to service_role using (true) with check (true);

grant select on public.quickbooks_gl_sync_jobs to authenticated;
