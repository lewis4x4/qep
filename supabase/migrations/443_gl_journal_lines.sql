-- 443_gl_journal_lines.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#gl_journal.debit_amount.
--
-- Rollback notes:
--   drop trigger if exists set_gl_journal_lines_updated_at on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_rep_select" on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_rep_scope" on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_rep_own_select" on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_workspace_select" on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_workspace_insert" on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_workspace_update" on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_delete_elevated" on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_all_elevated" on public.gl_journal_lines;
--   drop policy if exists "gl_journal_lines_service_all" on public.gl_journal_lines;
--   drop table if exists public.gl_journal_lines;
create table public.gl_journal_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  journal_entry_id uuid not null references public.gl_journal_entries(id) on delete cascade,
  line_number integer not null,
  gl_account_id uuid not null references public.gl_accounts(id) on delete restrict,
  cost_center_id uuid references public.gl_cost_centers(id) on delete set null,
  profit_center_id uuid references public.gl_profit_centers(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  debit_amount numeric not null default 0 check (debit_amount >= 0),
  credit_amount numeric not null default 0 check (credit_amount >= 0),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (journal_entry_id, line_number),
  check (not (debit_amount > 0 and credit_amount > 0))
);

comment on table public.gl_journal_lines is 'Debit/credit GL journal entry lines with account, cost center, profit center, branch, and memo.';

create index idx_gl_journal_lines_entry
  on public.gl_journal_lines (workspace_id, journal_entry_id, line_number)
  where deleted_at is null;
comment on index public.idx_gl_journal_lines_entry is 'Purpose: render journal entry detail lines in line-number order.';

alter table public.gl_journal_lines enable row level security;

create policy "gl_journal_lines_service_all"
  on public.gl_journal_lines for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "gl_journal_lines_all_elevated"
  on public.gl_journal_lines for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_gl_journal_lines_updated_at
  before update on public.gl_journal_lines
  for each row execute function public.set_updated_at();
