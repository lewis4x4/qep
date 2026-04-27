-- 442_gl_journal_entries.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#gl_journal.debit_amount.
--
-- Rollback notes:
--   drop trigger if exists set_gl_journal_entries_updated_at on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_rep_select" on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_rep_scope" on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_rep_own_select" on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_workspace_select" on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_workspace_insert" on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_workspace_update" on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_delete_elevated" on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_all_elevated" on public.gl_journal_entries;
--   drop policy if exists "gl_journal_entries_service_all" on public.gl_journal_entries;
--   drop table if exists public.gl_journal_entries;
create table public.gl_journal_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid references public.gl_companies(id) on delete set null,
  journal_number text not null,
  journal_type text not null check (journal_type in ('sales','cogs','ar_cash_receipt','ap_payment','ap_invoice','adjusting','closing','manual','reversal','recurring','depreciation')),
  source_module text,
  source_reference text,
  posting_date date not null,
  period_id uuid references public.gl_periods(id) on delete set null,
  memo text,
  status text not null default 'unposted' check (status in ('unposted','posted','voided','reversed')),
  reversed_by_entry_id uuid references public.gl_journal_entries(id) on delete set null,
  reverses_entry_id uuid references public.gl_journal_entries(id) on delete set null,
  posted_at timestamptz,
  posted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, journal_number)
);

comment on table public.gl_journal_entries is 'GL journal entry headers for sales, AP, AR, manual, closing, reversal, recurring, and depreciation journals.';

create index idx_gl_journal_entries_posting
  on public.gl_journal_entries (workspace_id, posting_date desc, status)
  where deleted_at is null;
comment on index public.idx_gl_journal_entries_posting is 'Purpose: journal register filtering by posting date and status.';

alter table public.gl_journal_entries enable row level security;

create policy "gl_journal_entries_service_all"
  on public.gl_journal_entries for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "gl_journal_entries_all_elevated"
  on public.gl_journal_entries for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_gl_journal_entries_updated_at
  before update on public.gl_journal_entries
  for each row execute function public.set_updated_at();
