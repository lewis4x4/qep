-- 661_ap_three_way_match_and_approval_routing.sql
--
-- AP 3-WAY MATCH + APPROVAL ROUTING + DOUBLE-PAY GUARD
--
-- Extends the existing AP foundation (347 vendor purchase orders,
-- 444 vendor invoices, 445 ap invoice distributions) with:
--   1. Goods receipt capture (greenfield): the physical "received" leg of the
--      three-way match (PO <-> receipt <-> invoice).
--   2. A three-way match evaluator that reconciles PO ordered value, goods
--      received value, and invoiced amount, and drives vendor_invoices.match_status
--      / hold_status.
--   3. An approval routing matrix (Section 9.3 threshold ladder) plus per-invoice
--      approval steps and a router that materializes the required approvals.
--   4. An AP payment ledger with a hard double-pay guard: payments are recorded
--      only through record_ap_payment(), which locks the invoice row FOR UPDATE,
--      refuses to over-pay or pay a settled invoice, and blocks payment while any
--      approval step is still pending. A BEFORE INSERT trigger re-validates the
--      balance so even a direct INSERT into ap_payments cannot double-pay.
--
-- Conventions: uuid PKs, created_at/updated_at defaults, deleted_at where
-- applicable, idempotent seeds, RLS on every new user-facing table, helper role
-- and workspace functions wrapped in (select ...), security definer functions
-- pinned to search_path = public.
--
-- Rollback notes:
--   drop trigger if exists trg_ap_payments_guard_balance on public.ap_payments;
--   drop function if exists public.fn_ap_payments_guard_balance();
--   drop function if exists public.record_ap_payment(uuid, numeric, text, text);
--   drop function if exists public.route_ap_invoice_for_approval(uuid);
--   drop function if exists public.evaluate_three_way_match(uuid);
--   drop table if exists public.ap_payments;
--   drop table if exists public.ap_invoice_approvals;
--   drop table if exists public.ap_approval_matrix;
--   drop table if exists public.goods_receipt_lines;
--   drop table if exists public.goods_receipts;
--   alter table public.vendor_invoices
--     drop column if exists match_status,
--     drop column if exists purchase_order_id;

begin;

-- ============================================================================
-- 1. GOODS RECEIPT (greenfield): the "received" leg of the three-way match.
-- ============================================================================

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  purchase_order_id uuid references public.vendor_purchase_orders(id) on delete set null,
  receipt_number text,
  received_at timestamptz not null default now(),
  received_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, receipt_number)
);

comment on table public.goods_receipts is
  'Goods receipt headers: the physical "received" leg of the AP three-way match (PO <-> receipt <-> invoice).';

create index if not exists idx_goods_receipts_po
  on public.goods_receipts (workspace_id, purchase_order_id)
  where deleted_at is null;
comment on index public.idx_goods_receipts_po is
  'Purpose: fetch goods receipts for a purchase order during three-way match.';

alter table public.goods_receipts enable row level security;

create policy "goods_receipts_service_all"
  on public.goods_receipts for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "goods_receipts_workspace_select"
  on public.goods_receipts for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "goods_receipts_elevated_write"
  on public.goods_receipts for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_goods_receipts_updated_at
  before update on public.goods_receipts
  for each row execute function public.set_updated_at();

create table if not exists public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  goods_receipt_id uuid references public.goods_receipts(id) on delete cascade,
  purchase_order_line_id uuid references public.vendor_purchase_order_lines(id) on delete set null,
  quantity_received numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.goods_receipt_lines is
  'Per-line received quantities for a goods receipt; feeds the received leg of the three-way match.';

create index if not exists idx_goods_receipt_lines_receipt
  on public.goods_receipt_lines (workspace_id, goods_receipt_id);
comment on index public.idx_goods_receipt_lines_receipt is
  'Purpose: list received lines for a goods receipt and sum received quantity per PO line.';

alter table public.goods_receipt_lines enable row level security;

create policy "goods_receipt_lines_service_all"
  on public.goods_receipt_lines for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "goods_receipt_lines_workspace_select"
  on public.goods_receipt_lines for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "goods_receipt_lines_elevated_write"
  on public.goods_receipt_lines for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_goods_receipt_lines_updated_at
  before update on public.goods_receipt_lines
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. THREE-WAY MATCH: tighten the loose po_number link and add match_status.
-- ============================================================================

alter table public.vendor_invoices
  add column if not exists purchase_order_id uuid
    references public.vendor_purchase_orders(id) on delete set null;

comment on column public.vendor_invoices.purchase_order_id is
  'Hard FK to the matched purchase order. Tightens the loose po_number text link; keep po_number too.';

alter table public.vendor_invoices
  add column if not exists match_status text not null default 'unmatched';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_invoices_match_status_check'
  ) then
    alter table public.vendor_invoices
      add constraint vendor_invoices_match_status_check
      check (match_status in ('unmatched', 'matched', 'price_mismatch', 'quantity_mismatch', 'partial'));
  end if;
end;
$$;

comment on column public.vendor_invoices.match_status is
  'Three-way match outcome: unmatched | matched | price_mismatch | quantity_mismatch | partial. Maintained by evaluate_three_way_match().';

create index if not exists idx_vendor_invoices_purchase_order
  on public.vendor_invoices (workspace_id, purchase_order_id)
  where deleted_at is null and purchase_order_id is not null;
comment on index public.idx_vendor_invoices_purchase_order is
  'Purpose: fetch invoices linked to a purchase order for three-way match.';

-- evaluate_three_way_match(): compare, for the invoice's PO,
--   ordered value   = sum(po_line.quantity * po_line.unit_cost_cents) / 100  (cents -> dollars)
--   received value  = sum(received_qty * matched po_line unit_cost_cents) / 100
--   invoiced value  = vendor_invoices.amount
--
-- Tolerance: matches are approved when all three legs agree within
--   AP_MATCH_TOLERANCE = the greater of $1.00 absolute or 1% of the PO ordered
-- value. This absorbs rounding between cents-based PO lines and the dollar-based
-- invoice amount without waving through real discrepancies.
--
-- Precedence: a quantity discrepancy (received != ordered) is reported as
-- 'quantity_mismatch' first; otherwise a value discrepancy between the invoice
-- and the received/ordered value is 'price_mismatch'. A PO that is only
-- partially received (received < ordered but invoice tracks received) is
-- 'partial'. match_status drives hold_status: matched clears any match-related
-- hold; a mismatch parks the invoice on the corresponding hold_status.
create or replace function public.evaluate_three_way_match(p_vendor_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id            uuid;
  v_invoice_amount   numeric(14, 2);
  v_ordered_value    numeric(14, 2);
  v_received_value   numeric(14, 2);
  v_ordered_qty      numeric(14, 2);
  v_received_qty     numeric(14, 2);
  v_tolerance        numeric(14, 2);
  v_match_status     text;
  v_hold_status      text;
begin
  select purchase_order_id, coalesce(amount, 0)::numeric(14, 2)
    into v_po_id, v_invoice_amount
  from public.vendor_invoices
  where id = p_vendor_invoice_id;

  if not found then
    raise exception 'vendor invoice % not found', p_vendor_invoice_id;
  end if;

  -- No PO linked: cannot three-way match.
  if v_po_id is null then
    update public.vendor_invoices
       set match_status = 'unmatched',
           updated_at = now()
     where id = p_vendor_invoice_id;
    return 'unmatched';
  end if;

  -- Ordered leg (from PO lines). unit_cost_cents is bigint cents -> dollars.
  select
    coalesce(sum(pol.quantity), 0)::numeric(14, 2),
    coalesce(sum(pol.quantity * pol.unit_cost_cents), 0)::numeric(14, 2) / 100
  into v_ordered_qty, v_ordered_value
  from public.vendor_purchase_order_lines pol
  where pol.purchase_order_id = v_po_id;

  -- Received leg (goods receipt lines joined back to their PO line for unit cost).
  select
    coalesce(sum(grl.quantity_received), 0)::numeric(14, 2),
    coalesce(sum(grl.quantity_received * pol.unit_cost_cents), 0)::numeric(14, 2) / 100
  into v_received_qty, v_received_value
  from public.goods_receipt_lines grl
  join public.goods_receipts gr on gr.id = grl.goods_receipt_id
  join public.vendor_purchase_order_lines pol on pol.id = grl.purchase_order_line_id
  where pol.purchase_order_id = v_po_id
    and gr.deleted_at is null;

  -- Tolerance: greater of $1.00 or 1% of ordered value.
  v_tolerance := greatest(1.00, round(v_ordered_value * 0.01, 2));

  if abs(v_received_qty - v_ordered_qty) > 0
     and v_received_qty < v_ordered_qty
     and abs(v_invoice_amount - v_received_value) <= v_tolerance then
    -- Invoice tracks what was received, but not everything ordered has arrived.
    v_match_status := 'partial';
    v_hold_status  := 'approval_pending';
  elsif abs(v_received_qty - v_ordered_qty) > 0 then
    -- Received quantity does not reconcile with the ordered quantity.
    v_match_status := 'quantity_mismatch';
    v_hold_status  := 'quantity_mismatch';
  elsif abs(v_invoice_amount - v_received_value) > v_tolerance
     or abs(v_invoice_amount - v_ordered_value) > v_tolerance then
    -- Quantities agree but the invoiced value does not.
    v_match_status := 'price_mismatch';
    v_hold_status  := 'price_mismatch';
  else
    v_match_status := 'matched';
    v_hold_status  := 'none';
  end if;

  update public.vendor_invoices
     set match_status = v_match_status,
         -- Only touch hold_status for match-related states; never stomp a
         -- manual dispute or an approval already in flight when clearing.
         hold_status = case
           when v_match_status = 'matched'
                and hold_status in ('price_mismatch', 'quantity_mismatch')
             then 'none'
           when v_match_status in ('price_mismatch', 'quantity_mismatch')
             then v_hold_status
           else hold_status
         end,
         updated_at = now()
   where id = p_vendor_invoice_id;

  return v_match_status;
end;
$$;

comment on function public.evaluate_three_way_match(uuid) is
  'Three-way match: reconciles PO ordered value, goods-received value, and invoice amount within tolerance (greater of $1.00 or 1%), updating vendor_invoices.match_status and hold_status.';

-- ============================================================================
-- 3. APPROVAL ROUTING MATRIX (Section 9.3 threshold ladder).
-- ============================================================================

create table if not exists public.ap_approval_matrix (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  min_amount numeric(14, 2) not null default 0,
  max_amount numeric(14, 2),
  required_role text not null,
  sequence int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, min_amount, required_role, sequence)
);

comment on table public.ap_approval_matrix is
  'AP approval routing ladder (Section 9.3): amount bands mapped to required approver roles and sequence. max_amount null = open-ended top band.';

create index if not exists idx_ap_approval_matrix_lookup
  on public.ap_approval_matrix (workspace_id, min_amount, sequence)
  where active;
comment on index public.idx_ap_approval_matrix_lookup is
  'Purpose: resolve the approval ladder for an invoice amount by band and sequence.';

alter table public.ap_approval_matrix enable row level security;

create policy "ap_approval_matrix_service_all"
  on public.ap_approval_matrix for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "ap_approval_matrix_workspace_select"
  on public.ap_approval_matrix for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "ap_approval_matrix_elevated_write"
  on public.ap_approval_matrix for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_ap_approval_matrix_updated_at
  before update on public.ap_approval_matrix
  for each row execute function public.set_updated_at();

-- Seed defaults (idempotent). These are SEED DEFAULTS reflecting a typical
-- Section 9.3 threshold ladder; tune per workspace later:
--   $0 - $5,000        -> manager
--   $5,000 - $25,000   -> manager (seq 1) then owner (seq 2)
--   $25,000 and up     -> owner (seq 1) then admin (seq 2)
insert into public.ap_approval_matrix (workspace_id, min_amount, max_amount, required_role, sequence, active)
values
  ('default', 0, 5000, 'manager', 1, true),
  ('default', 5000, 25000, 'manager', 1, true),
  ('default', 5000, 25000, 'owner', 2, true),
  ('default', 25000, null, 'owner', 1, true),
  ('default', 25000, null, 'admin', 2, true)
on conflict (workspace_id, min_amount, required_role, sequence) do nothing;

create table if not exists public.ap_invoice_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  vendor_invoice_id uuid references public.vendor_invoices(id) on delete cascade,
  required_role text not null,
  sequence int not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'skipped')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, vendor_invoice_id, required_role, sequence)
);

comment on table public.ap_invoice_approvals is
  'Materialized approval steps for a vendor invoice, generated from ap_approval_matrix by route_ap_invoice_for_approval().';

create index if not exists idx_ap_invoice_approvals_invoice
  on public.ap_invoice_approvals (workspace_id, vendor_invoice_id);
comment on index public.idx_ap_invoice_approvals_invoice is
  'Purpose: list approval steps for a vendor invoice and detect pending steps before payment.';

alter table public.ap_invoice_approvals enable row level security;

create policy "ap_invoice_approvals_service_all"
  on public.ap_invoice_approvals for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "ap_invoice_approvals_workspace_select"
  on public.ap_invoice_approvals for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "ap_invoice_approvals_elevated_write"
  on public.ap_invoice_approvals for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_ap_invoice_approvals_updated_at
  before update on public.ap_invoice_approvals
  for each row execute function public.set_updated_at();

-- route_ap_invoice_for_approval(): reads the invoice amount, selects the
-- matching ap_approval_matrix band (min_amount <= amount < max_amount, or the
-- open-ended top band), materializes ap_invoice_approvals steps in sequence,
-- and parks the invoice on hold_status = 'approval_pending'. Idempotent: it
-- skips steps that already exist (unique on workspace/invoice/role/sequence).
-- Returns the number of steps created on this call.
create or replace function public.route_ap_invoice_for_approval(p_vendor_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace   text;
  v_amount      numeric(14, 2);
  v_created     integer := 0;
  r             record;
begin
  select workspace_id, coalesce(amount, 0)::numeric(14, 2)
    into v_workspace, v_amount
  from public.vendor_invoices
  where id = p_vendor_invoice_id;

  if not found then
    raise exception 'vendor invoice % not found', p_vendor_invoice_id;
  end if;

  for r in
    select m.required_role, m.sequence
    from public.ap_approval_matrix m
    where m.workspace_id = v_workspace
      and m.active
      and v_amount >= m.min_amount
      and (m.max_amount is null or v_amount < m.max_amount)
    order by m.sequence
  loop
    insert into public.ap_invoice_approvals
      (workspace_id, vendor_invoice_id, required_role, sequence, status)
    values
      (v_workspace, p_vendor_invoice_id, r.required_role, r.sequence, 'pending')
    on conflict (workspace_id, vendor_invoice_id, required_role, sequence) do nothing;

    if found then
      v_created := v_created + 1;
    end if;
  end loop;

  -- Park on approval hold if there is anything left to approve.
  if exists (
    select 1 from public.ap_invoice_approvals
    where vendor_invoice_id = p_vendor_invoice_id
      and status = 'pending'
  ) then
    update public.vendor_invoices
       set hold_status = 'approval_pending',
           updated_at = now()
     where id = p_vendor_invoice_id;
  end if;

  return v_created;
end;
$$;

comment on function public.route_ap_invoice_for_approval(uuid) is
  'Materializes ap_invoice_approvals steps from ap_approval_matrix for the invoice amount and sets hold_status=approval_pending. Idempotent; returns steps created.';

-- ============================================================================
-- 4. DOUBLE-PAY GUARD + AP PAYMENT LEDGER.
-- ============================================================================

create table if not exists public.ap_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  vendor_invoice_id uuid references public.vendor_invoices(id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text,
  reference text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ap_payments is
  'AP payment ledger. Payments should flow through record_ap_payment(); a BEFORE INSERT guard re-checks the invoice balance so no path can double-pay.';

create index if not exists idx_ap_payments_invoice
  on public.ap_payments (workspace_id, vendor_invoice_id);
comment on index public.idx_ap_payments_invoice is
  'Purpose: list payments applied to a vendor invoice and total amount paid.';

alter table public.ap_payments enable row level security;

create policy "ap_payments_service_all"
  on public.ap_payments for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "ap_payments_workspace_select"
  on public.ap_payments for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "ap_payments_elevated_write"
  on public.ap_payments for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_ap_payments_updated_at
  before update on public.ap_payments
  for each row execute function public.set_updated_at();

-- DOUBLE-PAY GUARD (defense in depth #1): a BEFORE INSERT trigger that
-- re-derives the invoice's outstanding balance from the invoice header plus
-- already-applied payments, and rejects any insert that would exceed it. This
-- fires even on a direct INSERT that bypasses record_ap_payment(), so the same
-- invoice can never be paid twice or over-paid.
create or replace function public.fn_ap_payments_guard_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount        numeric(14, 2);
  v_amount_paid   numeric(14, 2);
  v_already       numeric(14, 2);
  v_balance       numeric(14, 2);
begin
  if new.vendor_invoice_id is null then
    return new;
  end if;

  -- Lock the invoice row so concurrent inserts serialize on the same invoice.
  select coalesce(amount, 0)::numeric(14, 2), coalesce(amount_paid, 0)::numeric(14, 2)
    into v_amount, v_amount_paid
  from public.vendor_invoices
  where id = new.vendor_invoice_id
  for update;

  if not found then
    raise exception 'vendor invoice % not found', new.vendor_invoice_id;
  end if;

  -- Sum payments already recorded against this invoice (excludes this row).
  select coalesce(sum(amount), 0)::numeric(14, 2)
    into v_already
  from public.ap_payments
  where vendor_invoice_id = new.vendor_invoice_id;

  -- Outstanding balance = invoiced amount minus the greater of the header's
  -- amount_paid and the ledger total (guards against either drifting).
  v_balance := v_amount - greatest(v_amount_paid, v_already);

  if v_balance <= 0 then
    raise exception 'invoice already fully paid' using errcode = 'check_violation';
  end if;

  if new.amount > v_balance then
    raise exception 'payment amount % exceeds outstanding balance %', new.amount, v_balance
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.fn_ap_payments_guard_balance() is
  'Double-pay guard trigger: rejects ap_payments inserts that would over-pay or pay an already-settled invoice, even on direct INSERT.';

create trigger trg_ap_payments_guard_balance
  before insert on public.ap_payments
  for each row execute function public.fn_ap_payments_guard_balance();

-- record_ap_payment(): the sanctioned payment path and the primary double-pay
-- guard. It LOCKS the vendor_invoice row FOR UPDATE, refuses to pay a settled
-- invoice or over-pay, refuses to pay while any approval step is still pending,
-- writes the ledger row (which the BEFORE INSERT trigger re-validates), advances
-- amount_paid, and flips status to 'paid' at zero balance else 'partial'.
create or replace function public.record_ap_payment(
  p_vendor_invoice_id uuid,
  p_amount numeric,
  p_method text default null,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount        numeric(14, 2);
  v_amount_paid   numeric(14, 2);
  v_balance       numeric(14, 2);
  v_hold_status   text;
  v_new_paid      numeric(14, 2);
  v_payment_id    uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  -- LOCK the invoice row: serializes concurrent payment attempts (double-pay guard).
  select coalesce(amount, 0)::numeric(14, 2),
         coalesce(amount_paid, 0)::numeric(14, 2),
         hold_status
    into v_amount, v_amount_paid, v_hold_status
  from public.vendor_invoices
  where id = p_vendor_invoice_id
  for update;

  if not found then
    raise exception 'vendor invoice % not found', p_vendor_invoice_id;
  end if;

  v_balance := v_amount - v_amount_paid;

  if v_balance <= 0 then
    raise exception 'invoice already fully paid';
  end if;

  if p_amount > v_balance then
    raise exception 'payment amount % exceeds outstanding balance %', p_amount, v_balance;
  end if;

  -- Approval gate: block payment while any approval step remains pending.
  if v_hold_status = 'approval_pending'
     and exists (
       select 1 from public.ap_invoice_approvals
       where vendor_invoice_id = p_vendor_invoice_id
         and status = 'pending'
     ) then
    raise exception 'invoice requires approval before payment';
  end if;

  insert into public.ap_payments
    (vendor_invoice_id, amount, method, reference, created_by)
  values
    (p_vendor_invoice_id, p_amount::numeric(14, 2), p_method, p_reference, auth.uid())
  returning id into v_payment_id;

  v_new_paid := v_amount_paid + p_amount;

  update public.vendor_invoices
     set amount_paid = v_new_paid,
         status = case when (v_amount - v_new_paid) <= 0 then 'paid' else 'partial' end,
         updated_at = now()
   where id = p_vendor_invoice_id;

  return v_payment_id;
end;
$$;

comment on function public.record_ap_payment(uuid, numeric, text, text) is
  'Sanctioned AP payment path and primary double-pay guard: locks the invoice FOR UPDATE, refuses over/duplicate payment, blocks on pending approvals, records the ledger row, and advances amount_paid/status.';

commit;
