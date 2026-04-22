-- ============================================================================
-- Migration 353: Accounts Payable Module
--
-- Rollback notes:
--   1. Drop trigger set_ap_bill_lines_updated_at and set_ap_bills_updated_at.
--   2. Drop trigger trg_recalculate_ap_bill_totals_on_line_change.
--   3. Drop function public.recalculate_ap_bill_totals(uuid).
--   4. Drop view public.ap_aging_view.
--   5. Drop indexes idx_ap_bill_lines_bill, idx_ap_bills_vendor, idx_ap_bills_status_due.
--   6. Drop policies on ap_bill_lines and ap_bills.
--   7. Drop tables ap_bill_lines and ap_bills.
-- ============================================================================

create table public.ap_bills (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  vendor_id uuid references public.vendor_profiles(id) on delete set null,
  vendor_name text,
  invoice_number text not null,
  invoice_date date not null,
  due_date date not null,
  payable_account_code text,
  payable_account_name text,
  description text,
  status text not null default 'pending_approval' check (
    status in ('draft', 'pending_approval', 'approved', 'partially_paid', 'paid', 'void')
  ),
  approval_status text not null default 'pending' check (
    approval_status in ('pending', 'approved', 'rejected', 'not_required')
  ),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  subtotal_amount numeric(12, 2) not null default 0,
  tax_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  amount_paid numeric(12, 2) not null default 0,
  balance_due numeric(12, 2) generated always as ((total_amount - amount_paid)) stored,
  payment_reference text,
  last_payment_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ap_bills is
  'Vendor bills and voucher headers for the Accounts Payable module.';

create index idx_ap_bills_vendor
  on public.ap_bills(vendor_id)
  where vendor_id is not null;

create index idx_ap_bills_status_due
  on public.ap_bills(workspace_id, status, due_date, invoice_date);

alter table public.ap_bills enable row level security;

create policy "ap_bills_select"
  on public.ap_bills for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "ap_bills_mutate"
  on public.ap_bills for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "ap_bills_service_all"
  on public.ap_bills for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_ap_bills_updated_at
  before update on public.ap_bills
  for each row execute function public.set_updated_at();

create table public.ap_bill_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  bill_id uuid not null references public.ap_bills(id) on delete cascade,
  line_number integer not null,
  description text not null,
  quantity numeric(12, 2) not null default 1,
  unit_cost numeric(12, 2) not null default 0,
  line_total numeric(12, 2) generated always as ((quantity * unit_cost)) stored,
  gl_code text,
  gl_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bill_id, line_number)
);

comment on table public.ap_bill_lines is
  'Voucher/account line detail for Accounts Payable bills.';

create index idx_ap_bill_lines_bill
  on public.ap_bill_lines(bill_id, line_number);

alter table public.ap_bill_lines enable row level security;

create policy "ap_bill_lines_select"
  on public.ap_bill_lines for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "ap_bill_lines_mutate"
  on public.ap_bill_lines for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "ap_bill_lines_service_all"
  on public.ap_bill_lines for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_ap_bill_lines_updated_at
  before update on public.ap_bill_lines
  for each row execute function public.set_updated_at();

create or replace function public.recalculate_ap_bill_totals(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(12, 2);
begin
  select coalesce(sum(line_total), 0)::numeric(12, 2)
    into v_subtotal
  from public.ap_bill_lines
  where bill_id = p_bill_id;

  update public.ap_bills
     set subtotal_amount = v_subtotal,
         total_amount = v_subtotal + coalesce(tax_amount, 0),
         updated_at = now()
   where id = p_bill_id;
end;
$$;

create or replace function public.trg_recalculate_ap_bill_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_ap_bill_totals(coalesce(new.bill_id, old.bill_id));
  return coalesce(new, old);
end;
$$;

create trigger trg_recalculate_ap_bill_totals_on_line_change
  after insert or update or delete on public.ap_bill_lines
  for each row execute function public.trg_recalculate_ap_bill_totals();

create or replace view public.ap_aging_view as
select
  b.id,
  b.workspace_id,
  b.vendor_id,
  coalesce(v.name, b.vendor_name, 'Vendor') as vendor_name,
  b.invoice_number,
  b.invoice_date,
  b.due_date,
  b.payable_account_code,
  b.payable_account_name,
  b.description,
  b.status,
  b.approval_status,
  b.total_amount,
  b.amount_paid,
  b.balance_due,
  case
    when current_date - b.due_date <= 30 then 'current'
    when current_date - b.due_date <= 60 then '31_60'
    when current_date - b.due_date <= 90 then '61_90'
    when current_date - b.due_date <= 120 then '91_120'
    else 'over_120'
  end as due_age_bucket,
  case
    when current_date - b.invoice_date <= 30 then 'current'
    when current_date - b.invoice_date <= 60 then '31_60'
    when current_date - b.invoice_date <= 90 then '61_90'
    when current_date - b.invoice_date <= 120 then '91_120'
    else 'over_120'
  end as invoice_age_bucket,
  greatest(current_date - b.due_date, 0) as days_overdue,
  greatest(current_date - b.invoice_date, 0) as days_from_invoice
from public.ap_bills b
left join public.vendor_profiles v on v.id = b.vendor_id
where b.status <> 'void'
  and b.balance_due > 0;

alter view public.ap_aging_view set (security_invoker = true);

comment on view public.ap_aging_view is
  'Outstanding AP balances bucketed by due date and invoice date for the Accounts Payable Outstanding surface.';
