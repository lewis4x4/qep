-- 658_finance_foundation_ap_three_way_match.sql
--
-- Finance foundation Part 4: AP 3-way match, approval routing, and double-pay guard.
--
-- Rollback notes:
--   drop function if exists public.record_ap_payment(uuid, numeric, text, text, text, timestamptz);
--   drop trigger if exists trg_ap_payments_guard on public.ap_payments;
--   drop function if exists public.ap_payments_guard();
--   drop function if exists public.route_ap_invoice_for_approval(uuid);
--   drop function if exists public.evaluate_three_way_match(uuid);
--   drop trigger if exists set_ap_payments_updated_at on public.ap_payments;
--   drop trigger if exists set_ap_invoice_approvals_updated_at on public.ap_invoice_approvals;
--   drop trigger if exists set_ap_approval_matrix_updated_at on public.ap_approval_matrix;
--   drop trigger if exists set_goods_receipt_lines_updated_at on public.goods_receipt_lines;
--   drop trigger if exists set_goods_receipts_updated_at on public.goods_receipts;
--   drop table if exists public.ap_payments;
--   drop table if exists public.ap_invoice_approvals;
--   drop table if exists public.ap_approval_matrix;
--   drop table if exists public.goods_receipt_lines;
--   drop table if exists public.goods_receipts;
--   alter table public.vendor_invoices drop column if exists approval_route_status;
--   alter table public.vendor_invoices drop column if exists reconditioning_amount;
--   alter table public.vendor_invoices drop column if exists match_evaluated_at;
--   alter table public.vendor_invoices drop column if exists match_status;
--   alter table public.vendor_invoices drop column if exists purchase_order_id;

alter table public.vendor_invoices
  add column if not exists purchase_order_id uuid references public.vendor_purchase_orders(id) on delete set null,
  add column if not exists match_status text not null default 'unmatched',
  add column if not exists match_evaluated_at timestamptz,
  add column if not exists reconditioning_amount numeric(14, 2),
  add column if not exists approval_route_status text not null default 'not_routed',
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendor_invoices_match_status_chk') then
    alter table public.vendor_invoices
      add constraint vendor_invoices_match_status_chk
      check (match_status in ('unmatched', 'matched', 'price_mismatch', 'quantity_mismatch', 'partial'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vendor_invoices_approval_route_status_chk') then
    alter table public.vendor_invoices
      add constraint vendor_invoices_approval_route_status_chk
      check (approval_route_status in ('not_routed', 'pending', 'approved', 'rejected', 'not_required'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vendor_invoices_reconditioning_amount_chk') then
    alter table public.vendor_invoices
      add constraint vendor_invoices_reconditioning_amount_chk
      check (reconditioning_amount is null or reconditioning_amount >= 0);
  end if;
end $$;

comment on column public.vendor_invoices.purchase_order_id is
  'Canonical AP purchase order link for PO -> receipt -> bill 3-way match. Existing po_number remains import/display residue.';
comment on column public.vendor_invoices.match_status is
  '3-way match result comparing vendor invoice, PO, and received goods.';
comment on column public.vendor_invoices.reconditioning_amount is
  'Structured reconditioning amount used for approval routing. Threshold remains config-driven; no default dollar value is assumed.';

create index if not exists idx_vendor_invoices_purchase_order
  on public.vendor_invoices(workspace_id, purchase_order_id)
  where purchase_order_id is not null and deleted_at is null;

insert into public.finance_foundation_config (
  workspace_id,
  config_key,
  config_value,
  safe_default,
  authorizing_question,
  note
)
values (
  'default',
  'reconditioning_soft_cap_threshold',
  '{"threshold_cents": null}'::jsonb,
  '{"threshold_cents": null}'::jsonb,
  'Round 3 open item: trade-in reconditioning soft-cap',
  'PARKED: no default dollar figure. Approval row exists but remains inactive until threshold is configured.'
)
on conflict do nothing;

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  purchase_order_id uuid not null references public.vendor_purchase_orders(id) on delete cascade,
  receipt_number text,
  received_at timestamptz not null default now(),
  received_by uuid references public.profiles(id) on delete set null,
  status text not null default 'received' check (status in ('draft', 'received', 'void')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.goods_receipts
  add column if not exists deleted_at timestamptz;

comment on table public.goods_receipts is
  'AP receiving header for the PO -> receipt -> bill 3-way match leg.';

create index if not exists idx_goods_receipts_po
  on public.goods_receipts(workspace_id, purchase_order_id, received_at desc)
  where deleted_at is null;

create table if not exists public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  purchase_order_line_id uuid not null references public.vendor_purchase_order_lines(id) on delete restrict,
  quantity_received numeric(12, 2) not null default 0 check (quantity_received >= 0),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.goods_receipt_lines
  add column if not exists deleted_at timestamptz;

comment on table public.goods_receipt_lines is
  'Received quantity/value by purchase-order line for AP 3-way matching.';

create index if not exists idx_goods_receipt_lines_po_line
  on public.goods_receipt_lines(workspace_id, purchase_order_line_id)
  where deleted_at is null;

create table if not exists public.ap_approval_matrix (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  route_code text not null,
  description text,
  min_amount numeric(14, 2),
  max_amount numeric(14, 2),
  required_role text not null check (required_role in ('admin', 'manager', 'owner', 'finance_admin')),
  approval_sequence integer not null default 1 check (approval_sequence > 0),
  reconditioning_soft_cap_amount numeric(14, 2),
  is_reconditioning_soft_cap boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, route_code, approval_sequence),
  check (min_amount is null or min_amount >= 0),
  check (max_amount is null or max_amount >= 0),
  check (reconditioning_soft_cap_amount is null or reconditioning_soft_cap_amount >= 0)
);

alter table public.ap_approval_matrix
  add column if not exists route_code text,
  add column if not exists description text,
  add column if not exists min_amount numeric(14, 2),
  add column if not exists max_amount numeric(14, 2),
  add column if not exists required_role text,
  add column if not exists approval_sequence integer not null default 1,
  add column if not exists reconditioning_soft_cap_amount numeric(14, 2),
  add column if not exists is_reconditioning_soft_cap boolean not null default false,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

comment on table public.ap_approval_matrix is
  'AP approval routing matrix. The reconditioning soft-cap row exists with a nullable threshold and is inactive until configured.';

create table if not exists public.ap_invoice_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  vendor_invoice_id uuid not null references public.vendor_invoices(id) on delete cascade,
  approval_matrix_id uuid references public.ap_approval_matrix(id) on delete set null,
  required_role text not null check (required_role in ('admin', 'manager', 'owner', 'finance_admin')),
  approval_sequence integer not null default 1 check (approval_sequence > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'skipped')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (vendor_invoice_id, approval_sequence, required_role)
);

alter table public.ap_invoice_approvals
  add column if not exists vendor_invoice_id uuid references public.vendor_invoices(id) on delete cascade,
  add column if not exists approval_matrix_id uuid references public.ap_approval_matrix(id) on delete set null,
  add column if not exists required_role text,
  add column if not exists approval_sequence integer not null default 1,
  add column if not exists status text not null default 'pending',
  add column if not exists decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_reason text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

comment on table public.ap_invoice_approvals is
  'Materialized approval steps for vendor invoices. Rows are generated from ap_approval_matrix.';

create table if not exists public.ap_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  vendor_invoice_id uuid not null references public.vendor_invoices(id) on delete restrict,
  source_system text not null check (source_system in ('qep_os', 'quickbooks', 'check')),
  external_payment_id text,
  check_number text,
  amount numeric(14, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.ap_payments
  add column if not exists vendor_invoice_id uuid references public.vendor_invoices(id) on delete restrict,
  add column if not exists source_system text not null default 'qep_os',
  add column if not exists external_payment_id text,
  add column if not exists check_number text,
  add column if not exists amount numeric(14, 2),
  add column if not exists paid_at timestamptz not null default now(),
  add column if not exists recorded_by uuid references public.profiles(id) on delete set null,
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

comment on table public.ap_payments is
  'AP payment ledger with cross-system idempotency guards so a bill cannot be paid twice by QEP OS, QuickBooks, or check register.';

create unique index if not exists uq_ap_payments_external
  on public.ap_payments(workspace_id, source_system, external_payment_id)
  where external_payment_id is not null and deleted_at is null;

create unique index if not exists uq_ap_payments_check_number
  on public.ap_payments(workspace_id, check_number)
  where check_number is not null and deleted_at is null;

create index if not exists idx_ap_payments_invoice
  on public.ap_payments(workspace_id, vendor_invoice_id, paid_at desc)
  where deleted_at is null;

alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
alter table public.ap_approval_matrix enable row level security;
alter table public.ap_invoice_approvals enable row level security;
alter table public.ap_payments enable row level security;

drop policy if exists "goods_receipts_service_all" on public.goods_receipts;
create policy "goods_receipts_service_all" on public.goods_receipts for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
drop policy if exists "goods_receipts_finance_all" on public.goods_receipts;
create policy "goods_receipts_finance_all" on public.goods_receipts for all
  using (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_read())
  with check (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_mutate());

drop policy if exists "goods_receipt_lines_service_all" on public.goods_receipt_lines;
create policy "goods_receipt_lines_service_all" on public.goods_receipt_lines for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
drop policy if exists "goods_receipt_lines_finance_all" on public.goods_receipt_lines;
create policy "goods_receipt_lines_finance_all" on public.goods_receipt_lines for all
  using (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_read())
  with check (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_mutate());

drop policy if exists "ap_approval_matrix_service_all" on public.ap_approval_matrix;
create policy "ap_approval_matrix_service_all" on public.ap_approval_matrix for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
drop policy if exists "ap_approval_matrix_finance_all" on public.ap_approval_matrix;
create policy "ap_approval_matrix_finance_all" on public.ap_approval_matrix for all
  using (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_read())
  with check (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_mutate());

drop policy if exists "ap_invoice_approvals_service_all" on public.ap_invoice_approvals;
create policy "ap_invoice_approvals_service_all" on public.ap_invoice_approvals for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
drop policy if exists "ap_invoice_approvals_finance_all" on public.ap_invoice_approvals;
create policy "ap_invoice_approvals_finance_all" on public.ap_invoice_approvals for all
  using (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_read())
  with check (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_mutate());

drop policy if exists "ap_payments_service_all" on public.ap_payments;
create policy "ap_payments_service_all" on public.ap_payments for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
drop policy if exists "ap_payments_finance_all" on public.ap_payments;
create policy "ap_payments_finance_all" on public.ap_payments for all
  using (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_read())
  with check (workspace_id = (select public.get_my_workspace()) and public.qep_finance_can_mutate());

drop trigger if exists set_goods_receipts_updated_at on public.goods_receipts;
create trigger set_goods_receipts_updated_at
  before update on public.goods_receipts
  for each row execute function public.set_updated_at();
drop trigger if exists set_goods_receipt_lines_updated_at on public.goods_receipt_lines;
create trigger set_goods_receipt_lines_updated_at
  before update on public.goods_receipt_lines
  for each row execute function public.set_updated_at();
drop trigger if exists set_ap_approval_matrix_updated_at on public.ap_approval_matrix;
create trigger set_ap_approval_matrix_updated_at
  before update on public.ap_approval_matrix
  for each row execute function public.set_updated_at();
drop trigger if exists set_ap_invoice_approvals_updated_at on public.ap_invoice_approvals;
create trigger set_ap_invoice_approvals_updated_at
  before update on public.ap_invoice_approvals
  for each row execute function public.set_updated_at();
drop trigger if exists set_ap_payments_updated_at on public.ap_payments;
create trigger set_ap_payments_updated_at
  before update on public.ap_payments
  for each row execute function public.set_updated_at();

insert into public.ap_approval_matrix (
  workspace_id,
  route_code,
  description,
  min_amount,
  max_amount,
  required_role,
  approval_sequence,
  active
)
select *
from (
  values
  ('default', 'ap_standard_finance_admin', 'Standard AP invoice finance review', 0::numeric, null::numeric, 'finance_admin', 1, true),
  ('default', 'ap_owner_exception', 'Owner review for AP exception invoices and unmatched holds', 0::numeric, null::numeric, 'owner', 2, true),
  ('default', 'ap_reconditioning_soft_cap', 'Reconditioning soft-cap route; inactive until threshold is configured', 0::numeric, null::numeric, 'manager', 1, false)
) as seed(workspace_id, route_code, description, min_amount, max_amount, required_role, approval_sequence, active)
where not exists (
  select 1
  from public.ap_approval_matrix existing
  where existing.workspace_id = seed.workspace_id
    and existing.route_code = seed.route_code
    and existing.approval_sequence = seed.approval_sequence
    and existing.deleted_at is null
);

create or replace function public.evaluate_three_way_match(p_vendor_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.vendor_invoices;
  v_po_amount numeric := 0;
  v_received_amount numeric := 0;
  v_ordered_qty numeric := 0;
  v_received_qty numeric := 0;
  v_result text := 'unmatched';
begin
  if (select auth.role()) is distinct from 'service_role' and not public.qep_finance_can_mutate() then
    raise exception 'AP match evaluation requires finance/admin privileges';
  end if;

  select *
    into v_invoice
  from public.vendor_invoices vi
  where vi.id = p_vendor_invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'vendor invoice % not found', p_vendor_invoice_id;
  end if;

  if v_invoice.purchase_order_id is null then
    update public.vendor_invoices
    set match_status = 'unmatched',
        hold_status = case when hold_status = 'none' then 'approval_pending' else hold_status end,
        match_evaluated_at = now()
    where id = v_invoice.id;
    return 'unmatched';
  end if;

  select
    coalesce(sum(l.quantity), 0),
    coalesce(sum((l.quantity * l.unit_cost_cents)::numeric / 100.0), 0)
    into v_ordered_qty, v_po_amount
  from public.vendor_purchase_order_lines l
  where l.purchase_order_id = v_invoice.purchase_order_id;

  select
    coalesce(sum(grl.quantity_received), 0),
    coalesce(sum((grl.quantity_received * grl.unit_cost_cents)::numeric / 100.0), 0)
    into v_received_qty, v_received_amount
  from public.goods_receipt_lines grl
  join public.goods_receipts gr on gr.id = grl.goods_receipt_id
  where gr.purchase_order_id = v_invoice.purchase_order_id
    and gr.status = 'received'
    and gr.deleted_at is null
    and grl.deleted_at is null;

  if v_received_qty = 0 then
    v_result := 'unmatched';
  elsif v_received_qty < v_ordered_qty then
    v_result := 'partial';
  elsif abs(v_invoice.amount - v_received_amount) > 0.01 or abs(v_invoice.amount - v_po_amount) > 0.01 then
    v_result := 'price_mismatch';
  elsif v_received_qty > v_ordered_qty then
    v_result := 'quantity_mismatch';
  else
    v_result := 'matched';
  end if;

  update public.vendor_invoices
  set match_status = v_result,
      hold_status = case
        when v_result = 'matched' and hold_status in ('price_mismatch', 'quantity_mismatch') then 'none'
        when v_result = 'price_mismatch' then 'price_mismatch'
        when v_result in ('quantity_mismatch', 'partial') then 'quantity_mismatch'
        else hold_status
      end,
      match_evaluated_at = now()
  where id = v_invoice.id;

  return v_result;
end;
$$;

revoke execute on function public.evaluate_three_way_match(uuid) from public;
grant execute on function public.evaluate_three_way_match(uuid) to authenticated;
grant execute on function public.evaluate_three_way_match(uuid) to service_role;

create or replace function public.route_ap_invoice_for_approval(p_vendor_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.vendor_invoices;
  v_threshold_cents bigint;
  v_inserted integer := 0;
  v_last_inserted integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' and not public.qep_finance_can_mutate() then
    raise exception 'AP approval routing requires finance/admin privileges';
  end if;

  select *
    into v_invoice
  from public.vendor_invoices vi
  where vi.id = p_vendor_invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'vendor invoice % not found', p_vendor_invoice_id;
  end if;

  select (public.qep_finance_config_value('reconditioning_soft_cap_threshold', v_invoice.workspace_id)->>'threshold_cents')::bigint
    into v_threshold_cents;

  insert into public.ap_invoice_approvals (
    workspace_id,
    vendor_invoice_id,
    approval_matrix_id,
    required_role,
    approval_sequence
  )
  select
    v_invoice.workspace_id,
    v_invoice.id,
    m.id,
    m.required_role,
    m.approval_sequence
  from public.ap_approval_matrix m
  where m.workspace_id = v_invoice.workspace_id
    and m.active
    and m.deleted_at is null
    and not m.is_reconditioning_soft_cap
    and (m.min_amount is null or v_invoice.amount >= m.min_amount)
    and (m.max_amount is null or v_invoice.amount <= m.max_amount)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  if v_threshold_cents is not null
     and v_invoice.reconditioning_amount is not null
     and round(v_invoice.reconditioning_amount * 100)::bigint > v_threshold_cents then
    insert into public.ap_invoice_approvals (
      workspace_id,
      vendor_invoice_id,
      approval_matrix_id,
      required_role,
      approval_sequence
    )
    select
      v_invoice.workspace_id,
      v_invoice.id,
      m.id,
      m.required_role,
      m.approval_sequence
    from public.ap_approval_matrix m
    where m.workspace_id = v_invoice.workspace_id
      and m.route_code = 'ap_reconditioning_soft_cap'
      and m.deleted_at is null
    on conflict do nothing;

    get diagnostics v_last_inserted = row_count;
    v_inserted := v_inserted + v_last_inserted;
  end if;

  update public.vendor_invoices
  set approval_route_status = case when exists (
          select 1 from public.ap_invoice_approvals a
          where a.vendor_invoice_id = v_invoice.id
            and a.deleted_at is null
        ) then 'pending' else 'not_required' end,
      hold_status = case when exists (
          select 1 from public.ap_invoice_approvals a
          where a.vendor_invoice_id = v_invoice.id
            and a.status = 'pending'
            and a.deleted_at is null
        ) then 'approval_pending' else hold_status end,
      updated_at = now()
  where id = v_invoice.id;

  return v_inserted;
end;
$$;

revoke execute on function public.route_ap_invoice_for_approval(uuid) from public;
grant execute on function public.route_ap_invoice_for_approval(uuid) to authenticated;
grant execute on function public.route_ap_invoice_for_approval(uuid) to service_role;

create or replace function public.ap_payments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.vendor_invoices;
begin
  select *
    into v_invoice
  from public.vendor_invoices vi
  where vi.id = new.vendor_invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'vendor invoice % not found', new.vendor_invoice_id;
  end if;

  if new.workspace_id is distinct from v_invoice.workspace_id then
    raise exception 'AP payment workspace does not match vendor invoice workspace';
  end if;

  if v_invoice.status in ('paid', 'void') then
    raise exception 'vendor invoice % is not payable in status %', v_invoice.id, v_invoice.status;
  end if;

  if exists (
    select 1
    from public.ap_invoice_approvals a
    where a.vendor_invoice_id = v_invoice.id
      and a.status = 'pending'
      and a.deleted_at is null
  ) then
    raise exception 'vendor invoice % has pending approvals', v_invoice.id;
  end if;

  if new.amount > v_invoice.balance_due then
    raise exception 'AP payment amount exceeds invoice balance';
  end if;

  if new.external_payment_id is not null and exists (
    select 1
    from public.ap_payments p
    where p.workspace_id = new.workspace_id
      and p.source_system = new.source_system
      and p.external_payment_id = new.external_payment_id
      and p.deleted_at is null
  ) then
    raise exception 'duplicate AP external payment id % for %', new.external_payment_id, new.source_system;
  end if;

  if new.check_number is not null and exists (
    select 1
    from public.ap_payments p
    where p.workspace_id = new.workspace_id
      and p.check_number = new.check_number
      and p.deleted_at is null
  ) then
    raise exception 'duplicate AP check number %', new.check_number;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ap_payments_guard on public.ap_payments;
create trigger trg_ap_payments_guard
  before insert on public.ap_payments
  for each row execute function public.ap_payments_guard();

create or replace function public.record_ap_payment(
  p_vendor_invoice_id uuid,
  p_amount numeric,
  p_source_system text,
  p_external_payment_id text default null,
  p_check_number text default null,
  p_paid_at timestamptz default now()
)
returns public.vendor_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.vendor_invoices;
  v_new_paid numeric;
begin
  if (select auth.role()) is distinct from 'service_role' and not public.qep_finance_can_mutate() then
    raise exception 'AP payment recording requires finance/admin privileges';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'AP payment amount must be positive';
  end if;

  if p_source_system not in ('qep_os', 'quickbooks', 'check') then
    raise exception 'invalid AP payment source_system %', p_source_system;
  end if;

  select *
    into v_invoice
  from public.vendor_invoices vi
  where vi.id = p_vendor_invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'vendor invoice % not found', p_vendor_invoice_id;
  end if;

  insert into public.ap_payments (
    workspace_id,
    vendor_invoice_id,
    source_system,
    external_payment_id,
    check_number,
    amount,
    paid_at,
    recorded_by
  )
  values (
    v_invoice.workspace_id,
    v_invoice.id,
    p_source_system,
    nullif(trim(p_external_payment_id), ''),
    nullif(trim(p_check_number), ''),
    p_amount,
    coalesce(p_paid_at, now()),
    auth.uid()
  );

  v_new_paid := coalesce(v_invoice.amount_paid, 0) + p_amount;

  update public.vendor_invoices vi
  set amount_paid = v_new_paid,
      status = case
        when v_new_paid >= vi.amount then 'paid'
        when v_new_paid > 0 then 'partial'
        else vi.status
      end,
      updated_at = now()
  where vi.id = v_invoice.id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

comment on function public.record_ap_payment(uuid, numeric, text, text, text, timestamptz) is
  'Sanctioned AP payment path. Locks the vendor invoice, checks approvals and balance, enforces cross-system idempotency, inserts ap_payments, and advances invoice paid status.';

revoke execute on function public.record_ap_payment(uuid, numeric, text, text, text, timestamptz) from public;
grant execute on function public.record_ap_payment(uuid, numeric, text, text, text, timestamptz) to authenticated;
grant execute on function public.record_ap_payment(uuid, numeric, text, text, text, timestamptz) to service_role;
