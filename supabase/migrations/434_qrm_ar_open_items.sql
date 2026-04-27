-- 434_qrm_ar_open_items.sql
--
-- Wave 1 clean foundation: Phase-5 Deal Genome from
-- docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#credit_limit_analysis.select_percentage_of_credit_limit.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_ar_open_items_updated_at on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_rep_select" on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_rep_scope" on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_rep_own_select" on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_workspace_select" on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_workspace_insert" on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_workspace_update" on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_delete_elevated" on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_all_elevated" on public.qrm_ar_open_items;
--   drop policy if exists "qrm_ar_open_items_service_all" on public.qrm_ar_open_items;
--   drop table if exists public.qrm_ar_open_items;
create table public.qrm_ar_open_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  receivable_account_id uuid,
  invoice_number text,
  invoice_date date,
  due_date date,
  original_amount_cents bigint not null check (original_amount_cents >= 0),
  balance_cents bigint not null check (balance_cents >= 0),
  days_outstanding integer,
  status text not null default 'open' check (status in ('open','partial','disputed','promised','paid','void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.qrm_ar_open_items is 'Open accounts-receivable items feeding credit-limit and A/R exposure analysis.';
comment on column public.qrm_ar_open_items.receivable_account_id is 'GL account UUID retained without FK until gl_accounts exists later in Wave 1.';

create index idx_qrm_ar_open_items_company
  on public.qrm_ar_open_items (workspace_id, company_id, due_date)
  where deleted_at is null and balance_cents > 0;
comment on index public.idx_qrm_ar_open_items_company is 'Purpose: customer open-A/R and credit-limit analysis by due date.';

alter table public.qrm_ar_open_items enable row level security;

create policy "qrm_ar_open_items_service_all"
  on public.qrm_ar_open_items for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_ar_open_items_all_elevated"
  on public.qrm_ar_open_items for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_ar_open_items_rep_scope"
  on public.qrm_ar_open_items for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  );

create trigger set_qrm_ar_open_items_updated_at
  before update on public.qrm_ar_open_items
  for each row execute function public.set_updated_at();
