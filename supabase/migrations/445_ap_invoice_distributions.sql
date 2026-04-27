-- 445_ap_invoice_distributions.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#ap_invoice.gl_distribution.
--
-- Rollback notes:
--   drop trigger if exists set_ap_invoice_distributions_updated_at on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_rep_select" on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_rep_scope" on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_rep_own_select" on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_workspace_select" on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_workspace_insert" on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_workspace_update" on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_delete_elevated" on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_all_elevated" on public.ap_invoice_distributions;
--   drop policy if exists "ap_invoice_distributions_service_all" on public.ap_invoice_distributions;
--   drop table if exists public.ap_invoice_distributions;
create table public.ap_invoice_distributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  vendor_invoice_id uuid not null references public.vendor_invoices(id) on delete cascade,
  line_number integer not null,
  gl_account_number text not null,
  gl_segment_branch text,
  gl_segment_department text,
  gl_segment_profit_center text,
  debit_amount numeric not null default 0 check (debit_amount >= 0),
  credit_amount numeric not null default 0 check (credit_amount >= 0),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (vendor_invoice_id, line_number),
  check (not (debit_amount > 0 and credit_amount > 0))
);

comment on table public.ap_invoice_distributions is 'AP invoice GL distribution lines with debit/credit and segment detail.';

create index idx_ap_invoice_distributions_invoice
  on public.ap_invoice_distributions (workspace_id, vendor_invoice_id, line_number)
  where deleted_at is null;
comment on index public.idx_ap_invoice_distributions_invoice is 'Purpose: render AP invoice GL distribution detail in line-number order.';

alter table public.ap_invoice_distributions enable row level security;

create policy "ap_invoice_distributions_service_all"
  on public.ap_invoice_distributions for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "ap_invoice_distributions_all_elevated"
  on public.ap_invoice_distributions for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_ap_invoice_distributions_updated_at
  before update on public.ap_invoice_distributions
  for each row execute function public.set_updated_at();
