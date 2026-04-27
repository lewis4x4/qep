-- 447_ar_memos.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#ar_invoice.ar_memo.
--
-- Rollback notes:
--   drop trigger if exists set_ar_memos_updated_at on public.ar_memos;
--   drop policy if exists "ar_memos_rep_select" on public.ar_memos;
--   drop policy if exists "ar_memos_rep_scope" on public.ar_memos;
--   drop policy if exists "ar_memos_rep_own_select" on public.ar_memos;
--   drop policy if exists "ar_memos_workspace_select" on public.ar_memos;
--   drop policy if exists "ar_memos_workspace_insert" on public.ar_memos;
--   drop policy if exists "ar_memos_workspace_update" on public.ar_memos;
--   drop policy if exists "ar_memos_delete_elevated" on public.ar_memos;
--   drop policy if exists "ar_memos_all_elevated" on public.ar_memos;
--   drop policy if exists "ar_memos_service_all" on public.ar_memos;
--   drop table if exists public.ar_memos;
create table public.ar_memos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  crm_company_id uuid not null references public.qrm_companies(id) on delete cascade,
  invoice_id uuid references public.customer_invoices(id) on delete set null,
  memo_type text check (memo_type in ('call','dispute','promise_to_pay','note')),
  body text not null,
  promise_amount numeric,
  promise_date date,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.ar_memos is 'Accounts-receivable collection, dispute, promise-to-pay, and note memos.';

create index idx_ar_memos_company
  on public.ar_memos (workspace_id, crm_company_id, created_at desc)
  where deleted_at is null;
comment on index public.idx_ar_memos_company is 'Purpose: AR memo history by customer/company.';

alter table public.ar_memos enable row level security;

create policy "ar_memos_service_all"
  on public.ar_memos for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "ar_memos_all_elevated"
  on public.ar_memos for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_ar_memos_updated_at
  before update on public.ar_memos
  for each row execute function public.set_updated_at();
