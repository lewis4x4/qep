-- 444_vendor_invoices.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#ap_aging.select_payable_account.
--
-- Rollback notes:
--   drop trigger if exists set_vendor_invoices_updated_at on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_rep_select" on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_rep_scope" on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_rep_own_select" on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_workspace_select" on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_workspace_insert" on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_workspace_update" on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_delete_elevated" on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_all_elevated" on public.vendor_invoices;
--   drop policy if exists "vendor_invoices_service_all" on public.vendor_invoices;
--   drop table if exists public.vendor_invoices;
create table public.vendor_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  vendor_id uuid not null references public.vendor_profiles(id) on delete restrict,
  vendor_invoice_number text not null,
  invoice_date date not null,
  due_date date not null,
  amount numeric not null check (amount >= 0),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  balance_due numeric generated always as (amount - coalesce(amount_paid, 0)) stored,
  ap_account_number text,
  po_number text,
  terms_code text,
  hold_status text not null default 'none' check (hold_status in ('none','disputed','approval_pending','price_mismatch','quantity_mismatch')),
  is_1099_reportable boolean not null default false,
  branch_id uuid references public.branches(id) on delete set null,
  notes text,
  status text not null default 'open' check (status in ('open','partial','paid','void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, vendor_id, vendor_invoice_number)
);

comment on table public.vendor_invoices is 'AP vendor invoices for outstanding payable detail, hold workflow, and AP aging.';

create index idx_vendor_invoices_vendor
  on public.vendor_invoices (workspace_id, vendor_id, status)
  where deleted_at is null;
comment on index public.idx_vendor_invoices_vendor is 'Purpose: vendor AP invoice list by status.';

create index idx_vendor_invoices_due
  on public.vendor_invoices (workspace_id, due_date)
  where status <> 'paid' and deleted_at is null;
comment on index public.idx_vendor_invoices_due is 'Purpose: AP aging and due-date queues for unpaid invoices.';

alter table public.vendor_invoices enable row level security;

create policy "vendor_invoices_service_all"
  on public.vendor_invoices for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "vendor_invoices_all_elevated"
  on public.vendor_invoices for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_vendor_invoices_updated_at
  before update on public.vendor_invoices
  for each row execute function public.set_updated_at();
