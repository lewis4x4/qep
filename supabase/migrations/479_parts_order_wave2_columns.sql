-- 479_parts_order_wave2_columns.sql
-- Wave 2 column extensions for parts_orders from Phase-3 and Phase-9.

alter table public.parts_orders
  add column if not exists po_type text,
  add column if not exists freight_charge_cents bigint not null default 0,
  add column if not exists po_total_cents bigint not null default 0,
  add column if not exists customer_id uuid references public.qrm_companies(id) on delete set null;

comment on column public.parts_orders.po_type is 'IntelliDealer purchase-order type discriminator.';
comment on column public.parts_orders.customer_id is 'Customer the PO/order was placed for; portal open-parts-on-order tile uses this when present.';

create index if not exists idx_parts_orders_customer
  on public.parts_orders (workspace_id, customer_id, created_at desc)
  where customer_id is not null;
comment on index public.idx_parts_orders_customer is 'Purpose: Account 360 open parts-on-order tile.';
