-- ============================================================================
-- Migration 132: Standalone Parts module — catalog, internal orders, line items
-- ============================================================================

-- ── parts_catalog (master part reference per workspace) ─────────────────────

create table public.parts_catalog (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  part_number text not null,
  description text,
  category text,
  manufacturer text,
  list_price numeric(14, 4),
  cost_price numeric(14, 4),
  weight_lb numeric(12, 4),
  uom text default 'EA',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, part_number)
);

comment on table public.parts_catalog is
  'Workspace-scoped parts master catalog (counter sales, portal lines, inventory linkage).';

create index idx_parts_catalog_ws_active
  on public.parts_catalog(workspace_id)
  where deleted_at is null and is_active = true;

create index idx_parts_catalog_ws_part
  on public.parts_catalog(workspace_id, part_number)
  where deleted_at is null;

alter table public.parts_catalog enable row level security;

create policy "parts_catalog_select"
  on public.parts_catalog for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

create policy "parts_catalog_mutate"
  on public.parts_catalog for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_catalog_service_all"
  on public.parts_catalog for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_catalog_updated_at
  before update on public.parts_catalog
  for each row execute function public.set_updated_at();

-- ── parts_inventory: optional link to catalog ────────────────────────────────

alter table public.parts_inventory
  add column if not exists catalog_id uuid references public.parts_catalog(id) on delete set null;

create index idx_parts_inventory_catalog
  on public.parts_inventory(catalog_id)
  where catalog_id is not null and deleted_at is null;

-- ── parts_orders: internal / CRM counter sales ─────────────────────────────

alter table public.parts_orders
  alter column portal_customer_id drop not null;

alter table public.parts_orders
  add column if not exists crm_company_id uuid references public.crm_companies(id) on delete set null;

alter table public.parts_orders
  add column if not exists order_source text not null default 'portal'
    check (order_source in ('portal', 'counter', 'phone', 'online', 'transfer'));

alter table public.parts_orders
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.parts_orders
  add column if not exists notes text;

alter table public.parts_orders
  add constraint parts_orders_customer_required check (
    portal_customer_id is not null or crm_company_id is not null
  );

comment on column public.parts_orders.order_source is
  'portal: customer portal; counter/phone/online/transfer: staff-originated parts sales.';

create index idx_parts_orders_crm_company
  on public.parts_orders(crm_company_id)
  where crm_company_id is not null;

create index idx_parts_orders_order_source
  on public.parts_orders(workspace_id, order_source);

create or replace function public.parts_orders_enforce_customer_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.crm_company_id is not null then
    if not exists (
      select 1 from public.crm_companies c
      where c.id = new.crm_company_id
        and c.workspace_id = new.workspace_id
        and c.deleted_at is null
    ) then
      raise exception 'crm_company_id must reference a company in the same workspace';
    end if;
  end if;
  if new.portal_customer_id is not null then
    if not exists (
      select 1 from public.portal_customers pc
      where pc.id = new.portal_customer_id
        and pc.workspace_id = new.workspace_id
    ) then
      raise exception 'portal_customer_id must reference a portal customer in the same workspace';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists parts_orders_enforce_customer_workspace_trg on public.parts_orders;
create trigger parts_orders_enforce_customer_workspace_trg
  before insert or update of crm_company_id, portal_customer_id, workspace_id
  on public.parts_orders
  for each row
  execute function public.parts_orders_enforce_customer_workspace();

-- ── parts_order_lines (relational lines; portal may still use line_items jsonb) ─

create table public.parts_order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  parts_order_id uuid not null references public.parts_orders(id) on delete cascade,
  catalog_item_id uuid references public.parts_catalog(id) on delete set null,
  part_number text not null,
  description text,
  quantity numeric(14, 4) not null default 1 check (quantity > 0),
  unit_price numeric(14, 4),
  line_total numeric(14, 4),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_order_lines is
  'Optional structured line items for parts orders (counter sales, margin tracking).';

create index idx_parts_order_lines_order
  on public.parts_order_lines(parts_order_id);

alter table public.parts_order_lines enable row level security;

create policy "parts_order_lines_staff"
  on public.parts_order_lines for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_order_lines_service_all"
  on public.parts_order_lines for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_order_lines_updated_at
  before update on public.parts_order_lines
  for each row execute function public.set_updated_at();

create or replace function public.parts_order_lines_sync_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
begin
  select o.workspace_id into ws from public.parts_orders o where o.id = new.parts_order_id;
  if ws is null then
    raise exception 'parts_order not found for parts_order_lines';
  end if;
  new.workspace_id := ws;
  return new;
end;
$$;

create trigger parts_order_lines_sync_workspace_trg
  before insert or update of parts_order_id on public.parts_order_lines
  for each row
  execute function public.parts_order_lines_sync_workspace();

-- ── Fulfillment runs / events: allow rep to create runs and audit events ─────
-- Idempotent: remote may already have these policies from a prior partial apply.

drop policy if exists "parts_fulfillment_runs_insert_staff" on public.parts_fulfillment_runs;
create policy "parts_fulfillment_runs_insert_staff"
  on public.parts_fulfillment_runs for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

drop policy if exists "parts_fulfillment_events_insert_staff" on public.parts_fulfillment_events;
create policy "parts_fulfillment_events_insert_staff"
  on public.parts_fulfillment_events for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );
