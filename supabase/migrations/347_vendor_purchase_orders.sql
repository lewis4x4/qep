-- ============================================================================
-- Migration 347: Vendor purchase orders
--
-- Rollback notes:
--   1. Drop triggers set_vendor_purchase_order_touchpoints_updated_at,
--      set_vendor_purchase_order_lines_updated_at,
--      set_vendor_purchase_orders_updated_at.
--   2. Drop indexes idx_vendor_purchase_order_touchpoints_po,
--      idx_vendor_purchase_order_lines_po,
--      idx_vendor_purchase_orders_workspace_status_created,
--      uq_vendor_purchase_orders_po_number.
--   3. Drop policies on vendor_purchase_order_touchpoints,
--      vendor_purchase_order_lines, and vendor_purchase_orders.
--   4. Drop tables vendor_purchase_order_touchpoints,
--      vendor_purchase_order_lines, and vendor_purchase_orders.
-- ============================================================================

create table public.vendor_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  po_number text not null,
  vendor_id uuid not null references public.vendor_profiles(id) on delete restrict,
  order_type text not null default 'miscellaneous' check (
    order_type in ('miscellaneous', 'equipment', 'fixed_asset', 'equipment_replenishment')
  ),
  status text not null default 'po_requested' check (
    status in (
      'po_requested',
      'waiting_authorization',
      'authorized',
      'on_order',
      'canceled',
      'back_order',
      'completed',
      'rejected'
    )
  ),
  location_code text,
  description text,
  crm_company_id uuid references public.qrm_companies(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  modified_by uuid references public.profiles(id) on delete set null,
  takeover_by uuid references public.profiles(id) on delete set null,
  authorized_by uuid references public.profiles(id) on delete set null,
  authorized_at timestamptz,
  ordered_at timestamptz,
  completed_at timestamptz,
  order_comments text,
  shipping_contact_name text,
  shipping_address_line_1 text,
  shipping_address_line_2 text,
  shipping_city text,
  shipping_state text,
  shipping_postal_code text,
  shipping_country text,
  shipping_method text,
  shipping_charge_cents bigint not null default 0,
  delivery_notes text,
  terms_and_conditions text,
  long_description text,
  print_parameters jsonb not null default '{}'::jsonb,
  multimedia_urls text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, po_number)
);

comment on table public.vendor_purchase_orders is
  'Dedicated vendor-facing purchase orders for equipment, fixed assets, replenishment, and miscellaneous non-parts buys.';

create index idx_vendor_purchase_orders_workspace_status_created
  on public.vendor_purchase_orders(workspace_id, status, created_at desc)
  where deleted_at is null;

create index uq_vendor_purchase_orders_po_number
  on public.vendor_purchase_orders(workspace_id, po_number)
  where deleted_at is null;

alter table public.vendor_purchase_orders enable row level security;

create policy "vpo_select"
  on public.vendor_purchase_orders for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vpo_mutate"
  on public.vendor_purchase_orders for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vpo_service_all"
  on public.vendor_purchase_orders for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_vendor_purchase_orders_updated_at
  before update on public.vendor_purchase_orders
  for each row execute function public.set_updated_at();

create table public.vendor_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  purchase_order_id uuid not null references public.vendor_purchase_orders(id) on delete cascade,
  line_number integer not null,
  line_type text not null check (line_type in ('miscellaneous', 'equipment_base', 'option')),
  item_code text,
  description text not null,
  quantity numeric(12, 2) not null default 1,
  unit_cost_cents bigint not null default 0,
  qb_equipment_model_id uuid references public.qb_equipment_models(id) on delete set null,
  qb_attachment_id uuid references public.qb_attachments(id) on delete set null,
  customer_company_id uuid references public.qrm_companies(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, line_number)
);

comment on table public.vendor_purchase_order_lines is
  'Line items for dedicated vendor purchase orders. Supports misc items, equipment bases, and selected option codes.';

create index idx_vendor_purchase_order_lines_po
  on public.vendor_purchase_order_lines(purchase_order_id, line_number);

alter table public.vendor_purchase_order_lines enable row level security;

create policy "vpol_select"
  on public.vendor_purchase_order_lines for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vpol_mutate"
  on public.vendor_purchase_order_lines for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vpol_service_all"
  on public.vendor_purchase_order_lines for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_vendor_purchase_order_lines_updated_at
  before update on public.vendor_purchase_order_lines
  for each row execute function public.set_updated_at();

create table public.vendor_purchase_order_touchpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  purchase_order_id uuid not null references public.vendor_purchase_orders(id) on delete cascade,
  contact_name text,
  note text not null,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_purchase_order_touchpoints is
  'Call-tracking and correspondence log for vendor purchase orders.';

create index idx_vendor_purchase_order_touchpoints_po
  on public.vendor_purchase_order_touchpoints(purchase_order_id, occurred_at desc);

alter table public.vendor_purchase_order_touchpoints enable row level security;

create policy "vpot_select"
  on public.vendor_purchase_order_touchpoints for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vpot_mutate"
  on public.vendor_purchase_order_touchpoints for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vpot_service_all"
  on public.vendor_purchase_order_touchpoints for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_vendor_purchase_order_touchpoints_updated_at
  before update on public.vendor_purchase_order_touchpoints
  for each row execute function public.set_updated_at();
