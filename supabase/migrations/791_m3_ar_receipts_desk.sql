-- ============================================================================
-- Migration 791: M3.1 — AR receipts desk (cash application)
--
--   Stream M (Revenue Convergence, blueprint §6, RF-012). The AR side of the
--   m661 AP payment machinery: a customer_payments ledger (one physical
--   tender: check/ACH/cash/card/wire) + customer_payment_applications
--   (per-invoice allocation) + record_ar_payment RPC with the m661 double-pay
--   guard shape — FOR UPDATE row locks in deterministic order, balance
--   validation against greatest(header amount_paid, ledger sum), and the
--   exact status ternary every existing payment writer uses
--   (>= total → paid, > 0 → partial). Dunning (m664) and credit holds (m657)
--   both key solely off balance_due/status, so applying a payment here is
--   sufficient to stop the chase and auto-release AUTO holds on the next
--   sweep — no dunning code change needed.
--
--   Role model: mirrors m661 AP (admin/manager/owner could pay vendors) ∪
--   finance_admin (m662 finance set) — branch managers run counters and must
--   be able to apply a walk-in check. Stripe portal self-pay path unchanged.
-- ============================================================================

BEGIN;

-- ── 1. Payment header: one physical tender ─────────────────────────────────
create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  crm_company_id uuid references public.qrm_companies(id) on delete set null,
  portal_customer_id uuid references public.portal_customers(id) on delete set null,
  tender_type text not null check (tender_type in ('cash', 'check', 'card', 'ach', 'wire', 'other')),
  reference text,
  amount numeric(14, 2) not null check (amount > 0),
  unapplied_amount numeric(14, 2) not null default 0 check (unapplied_amount >= 0),
  received_at timestamptz not null default now(),
  received_by uuid references public.profiles(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  deposit_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_payments_anchor_chk
    check (crm_company_id is not null or portal_customer_id is not null)
);

comment on table public.customer_payments is
  'M3.1 AR cash receipts ledger — one row per physical tender (check/ACH/cash/card/wire). Applications to invoices live in customer_payment_applications.';
comment on column public.customer_payments.unapplied_amount is
  'Cash on account: tender remainder not yet applied to an invoice.';

create index if not exists idx_customer_payments_company
  on public.customer_payments (workspace_id, crm_company_id, received_at desc);

create trigger set_customer_payments_updated_at
  before update on public.customer_payments
  for each row execute function public.set_updated_at();

-- ── 2. Per-invoice application ──────────────────────────────────────────────
create table if not exists public.customer_payment_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  customer_payment_id uuid not null references public.customer_payments(id) on delete cascade,
  customer_invoice_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (customer_payment_id, customer_invoice_id),
  constraint customer_payment_applications_invoice_fkey
    foreign key (workspace_id, customer_invoice_id)
    references public.customer_invoices(workspace_id, id) on delete restrict
);

create index if not exists idx_customer_payment_applications_invoice
  on public.customer_payment_applications (workspace_id, customer_invoice_id);

-- ── 3. Defense-in-depth guard (m661 fn_ap_payments_guard_balance mirror) ───
-- Fires even on direct INSERTs that bypass the RPC. Locks the invoice row,
-- re-derives the outstanding balance as total − greatest(header amount_paid,
-- ledger total) so neither drifting value can admit an over-application.
create or replace function public.fn_customer_payment_applications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total       numeric(14, 2);
  v_amount_paid numeric(14, 2);
  v_status      text;
  v_already     numeric(14, 2);
  v_balance     numeric(14, 2);
begin
  select coalesce(total, 0)::numeric(14, 2), coalesce(amount_paid, 0)::numeric(14, 2), status
    into v_total, v_amount_paid, v_status
  from public.customer_invoices
  where id = new.customer_invoice_id
  for update;

  if not found then
    raise exception 'customer invoice % not found', new.customer_invoice_id;
  end if;

  if v_status in ('void', 'reversed') then
    raise exception 'invoice is % and cannot accept payment', v_status
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount), 0)::numeric(14, 2)
    into v_already
  from public.customer_payment_applications
  where customer_invoice_id = new.customer_invoice_id;

  v_balance := v_total - greatest(v_amount_paid, v_already);

  if v_balance <= 0 then
    raise exception 'invoice already fully paid' using errcode = 'check_violation';
  end if;
  if new.amount > v_balance then
    raise exception 'payment application % exceeds outstanding balance %', new.amount, v_balance
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_customer_payment_applications_guard on public.customer_payment_applications;
create trigger trg_customer_payment_applications_guard
  before insert on public.customer_payment_applications
  for each row execute function public.fn_customer_payment_applications_guard();

-- ── 4. RLS (m664 finance trio; manager included on read via finance_can_read)
alter table public.customer_payments enable row level security;
alter table public.customer_payment_applications enable row level security;

create policy customer_payments_service_all on public.customer_payments
  for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy customer_payments_finance_read on public.customer_payments
  for select using (workspace_id = (select public.get_my_workspace()) and (select public.qep_finance_can_read()));
create policy customer_payments_finance_mutate on public.customer_payments
  for all using (
    workspace_id = (select public.get_my_workspace())
    and ((select public.qep_finance_can_mutate()) or (select public.get_my_role()) in ('manager'))
  ) with check (
    workspace_id = (select public.get_my_workspace())
    and ((select public.qep_finance_can_mutate()) or (select public.get_my_role()) in ('manager'))
  );

create policy customer_payment_applications_service_all on public.customer_payment_applications
  for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy customer_payment_applications_finance_read on public.customer_payment_applications
  for select using (workspace_id = (select public.get_my_workspace()) and (select public.qep_finance_can_read()));
create policy customer_payment_applications_finance_mutate on public.customer_payment_applications
  for all using (
    workspace_id = (select public.get_my_workspace())
    and ((select public.qep_finance_can_mutate()) or (select public.get_my_role()) in ('manager'))
  ) with check (
    workspace_id = (select public.get_my_workspace())
    and ((select public.qep_finance_can_mutate()) or (select public.get_my_role()) in ('manager'))
  );

-- ── 5. record_ar_payment — multi-invoice cash application ──────────────────
create or replace function public.record_ar_payment(
  p_workspace_id text,
  p_crm_company_id uuid,
  p_tender_type text,
  p_amount numeric,
  p_applications jsonb,
  p_reference text default null,
  p_branch_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount        numeric(14, 2);
  v_applied_total numeric(14, 2) := 0;
  v_payment_id    uuid;
  v_app           record;
  v_inv           record;
  v_app_amount    numeric(14, 2);
  v_new_paid      numeric(14, 2);
  v_results       jsonb := '[]'::jsonb;
begin
  if (select auth.role()) is distinct from 'service_role'
     and not (public.qep_finance_can_mutate() or coalesce((select public.get_my_role())::text, '') = 'manager') then
    raise exception 'AR payment application requires finance, manager, or admin privileges';
  end if;

  v_amount := coalesce(p_amount, 0)::numeric(14, 2);
  if v_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;
  if p_tender_type is null or p_tender_type not in ('cash', 'check', 'card', 'ach', 'wire', 'other') then
    raise exception 'tender_type must be one of cash, check, card, ach, wire, other';
  end if;
  if p_applications is null or jsonb_typeof(p_applications) is distinct from 'array'
     or jsonb_array_length(p_applications) = 0 then
    raise exception 'applications must be a non-empty array of {invoice_id, amount}';
  end if;

  select coalesce(sum((app->>'amount')::numeric), 0)::numeric(14, 2)
    into v_applied_total
  from jsonb_array_elements(p_applications) app;

  if v_applied_total <= 0 then
    raise exception 'application total must be positive';
  end if;
  if v_applied_total > v_amount then
    raise exception 'application total % exceeds tendered amount %', v_applied_total, v_amount;
  end if;

  insert into public.customer_payments
    (workspace_id, crm_company_id, tender_type, reference, amount, unapplied_amount,
     received_by, branch_id, notes)
  values
    (p_workspace_id, p_crm_company_id, p_tender_type, p_reference, v_amount,
     v_amount - v_applied_total, auth.uid(), p_branch_id, p_notes)
  returning id into v_payment_id;

  -- Deterministic lock order (due_date, id) so two clerks applying to
  -- overlapping invoice sets cannot deadlock.
  for v_app in
    select (app->>'invoice_id')::uuid as invoice_id,
           (app->>'amount')::numeric(14, 2) as amount
    from jsonb_array_elements(p_applications) app
    join public.customer_invoices ci on ci.id = (app->>'invoice_id')::uuid
    order by ci.due_date asc, ci.id asc
  loop
    v_app_amount := v_app.amount;
    if v_app_amount is null or v_app_amount <= 0 then
      raise exception 'application amount for invoice % must be positive', v_app.invoice_id;
    end if;

    select id, workspace_id, crm_company_id, coalesce(total, 0)::numeric(14, 2) as total,
           coalesce(amount_paid, 0)::numeric(14, 2) as amount_paid, status, invoice_number, paid_at
      into v_inv
    from public.customer_invoices
    where id = v_app.invoice_id
    for update;

    if not found then
      raise exception 'customer invoice % not found', v_app.invoice_id;
    end if;
    if v_inv.workspace_id is distinct from p_workspace_id then
      raise exception 'invoice % belongs to a different workspace', v_inv.invoice_number;
    end if;
    if v_inv.crm_company_id is distinct from p_crm_company_id then
      raise exception 'invoice % belongs to a different customer', v_inv.invoice_number;
    end if;
    if v_inv.status in ('void', 'reversed') then
      raise exception 'invoice % is % and cannot accept payment', v_inv.invoice_number, v_inv.status;
    end if;
    if (v_inv.total - v_inv.amount_paid) <= 0 then
      raise exception 'invoice % already fully paid', v_inv.invoice_number;
    end if;
    if v_app_amount > (v_inv.total - v_inv.amount_paid) then
      raise exception 'application % exceeds outstanding balance % on invoice %',
        v_app_amount, v_inv.total - v_inv.amount_paid, v_inv.invoice_number;
    end if;

    insert into public.customer_payment_applications
      (workspace_id, customer_payment_id, customer_invoice_id, amount)
    values
      (p_workspace_id, v_payment_id, v_app.invoice_id, v_app_amount);

    v_new_paid := v_inv.amount_paid + v_app_amount;

    update public.customer_invoices
       set amount_paid = v_new_paid,
           payment_method = p_tender_type,
           payment_reference = coalesce(nullif(trim(p_reference), ''), payment_reference),
           paid_at = case when v_new_paid >= v_inv.total then coalesce(v_inv.paid_at, now()) else v_inv.paid_at end,
           status = case
             when v_new_paid >= v_inv.total then 'paid'
             when v_new_paid > 0 then 'partial'
             else status
           end,
           updated_at = now()
     where id = v_app.invoice_id;

    v_results := v_results || jsonb_build_object(
      'invoice_id', v_app.invoice_id,
      'invoice_number', v_inv.invoice_number,
      'applied', v_app_amount,
      'new_amount_paid', v_new_paid,
      'new_status', case
        when v_new_paid >= v_inv.total then 'paid'
        when v_new_paid > 0 then 'partial'
        else v_inv.status
      end,
      'balance_due', v_inv.total - v_new_paid
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'tender_type', p_tender_type,
    'amount', v_amount,
    'applied_total', v_applied_total,
    'unapplied_amount', v_amount - v_applied_total,
    'applications', v_results
  );
end;
$$;

revoke execute on function public.record_ar_payment(text, uuid, text, numeric, jsonb, text, uuid, text) from public;
grant execute on function public.record_ar_payment(text, uuid, text, numeric, jsonb, text, uuid, text) to authenticated;
grant execute on function public.record_ar_payment(text, uuid, text, numeric, jsonb, text, uuid, text) to service_role;

comment on function public.record_ar_payment(text, uuid, text, numeric, jsonb, text, uuid, text) is
  'M3.1 AR cash application: one physical tender applied across open invoices atomically. Mirrors the m661 AP double-pay guard (FOR UPDATE locks in due_date order, balance validation) and the shared status ternary. Dunning (m664) and credit holds (m657) read balance_due/status, so this alone stops the chase.';

COMMIT;
