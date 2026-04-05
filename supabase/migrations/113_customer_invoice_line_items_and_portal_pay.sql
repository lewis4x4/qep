-- ============================================================================
-- Migration 113: Customer invoice line items + portal payment RPC
-- ============================================================================

create table if not exists public.customer_invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  invoice_id uuid not null references public.customer_invoices(id) on delete cascade,
  line_number integer not null default 1,
  description text not null,
  quantity numeric(12, 4) not null default 1 check (quantity >= 0),
  unit_price numeric(12, 2) not null default 0,
  line_total numeric(12, 2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_invoice_line_items is
  'Portal-facing invoice lines (mirrored from service quotes or manual entry).';

create index if not exists idx_customer_invoice_line_items_invoice
  on public.customer_invoice_line_items(invoice_id);

alter table public.customer_invoice_line_items enable row level security;

create policy "cili_select" on public.customer_invoice_line_items for select
  using (workspace_id = public.get_my_workspace());

create policy "cili_insert" on public.customer_invoice_line_items for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "cili_update" on public.customer_invoice_line_items for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "cili_delete" on public.customer_invoice_line_items for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "cili_portal_select" on public.customer_invoice_line_items for select
  using (
    exists (
      select 1 from public.customer_invoices ci
      where ci.id = customer_invoice_line_items.invoice_id
        and ci.portal_customer_id = public.get_portal_customer_id()
    )
  );

create policy "cili_service_all" on public.customer_invoice_line_items for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create trigger set_customer_invoice_line_items_updated_at
  before update on public.customer_invoice_line_items for each row
  execute function public.set_updated_at();

-- Portal customers record payments (amount capped to balance) — security definer
create or replace function public.portal_record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text default null,
  p_payment_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc uuid;
  v_inv public.customer_invoices%rowtype;
  v_new_paid numeric;
begin
  v_pc := public.get_portal_customer_id();
  if v_pc is null then
    return jsonb_build_object('ok', false, 'error', 'not_portal_user');
  end if;

  select * into v_inv from public.customer_invoices
  where id = p_invoice_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_inv.portal_customer_id is distinct from v_pc then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_amount > v_inv.balance_due then
    return jsonb_build_object('ok', false, 'error', 'amount_exceeds_balance');
  end if;

  v_new_paid := coalesce(v_inv.amount_paid, 0) + p_amount;

  update public.customer_invoices
  set
    amount_paid = v_new_paid,
    payment_method = coalesce(nullif(trim(p_payment_method), ''), payment_method),
    payment_reference = coalesce(nullif(trim(p_payment_reference), ''), payment_reference),
    paid_at = case when v_new_paid >= total then coalesce(paid_at, now()) else paid_at end,
    status = case
      when v_new_paid >= total then 'paid'
      when v_new_paid > 0 then 'partial'
      else status
    end,
    updated_at = now()
  where id = p_invoice_id;

  return jsonb_build_object('ok', true, 'amount_paid', v_new_paid);
end;
$$;

comment on function public.portal_record_invoice_payment is
  'Portal customer: apply a payment toward balance_due; validated amounts only.';

revoke all on function public.portal_record_invoice_payment(uuid, numeric, text, text) from public;
grant execute on function public.portal_record_invoice_payment(uuid, numeric, text, text) to authenticated;
grant execute on function public.portal_record_invoice_payment(uuid, numeric, text, text) to service_role;
