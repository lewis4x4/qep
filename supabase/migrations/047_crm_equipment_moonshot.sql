-- Moonshot equipment data model: from 3-field stub to the center of gravity
-- for equipment/parts sales and rental operations.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.crm_equipment_category as enum (
  'excavator', 'loader', 'backhoe', 'dozer', 'skid_steer',
  'crane', 'forklift', 'telehandler',
  'truck', 'trailer', 'dump_truck',
  'aerial_lift', 'boom_lift', 'scissor_lift',
  'compactor', 'roller',
  'generator', 'compressor', 'pump', 'welder',
  'attachment', 'bucket', 'breaker',
  'concrete', 'paving',
  'drill', 'boring',
  'other'
);

create type public.crm_equipment_condition as enum (
  'new', 'excellent', 'good', 'fair', 'poor', 'salvage'
);

create type public.crm_equipment_availability as enum (
  'available', 'rented', 'sold', 'in_service', 'in_transit', 'reserved', 'decommissioned'
);

create type public.crm_equipment_ownership as enum (
  'owned', 'leased', 'customer_owned', 'rental_fleet', 'consignment'
);

create type public.crm_deal_equipment_role as enum (
  'subject', 'trade_in', 'rental', 'part_exchange'
);

-- ── Enrich crm_equipment with real columns ──────────────────────────────────
alter table public.crm_equipment
  add column if not exists make text,
  add column if not exists model text,
  add column if not exists year integer,
  add column if not exists category public.crm_equipment_category,
  add column if not exists vin_pin text,
  add column if not exists condition public.crm_equipment_condition,
  add column if not exists availability public.crm_equipment_availability not null default 'available',
  add column if not exists ownership public.crm_equipment_ownership not null default 'customer_owned',
  add column if not exists engine_hours numeric(12,1),
  add column if not exists mileage numeric(12,1),
  add column if not exists fuel_type text,
  add column if not exists weight_class text,
  add column if not exists operating_capacity text,
  add column if not exists location_description text,
  add column if not exists latitude numeric(10,7),
  add column if not exists longitude numeric(11,7),
  add column if not exists purchase_price numeric(14,2),
  add column if not exists current_market_value numeric(14,2),
  add column if not exists replacement_cost numeric(14,2),
  add column if not exists daily_rental_rate numeric(10,2),
  add column if not exists weekly_rental_rate numeric(10,2),
  add column if not exists monthly_rental_rate numeric(10,2),
  add column if not exists warranty_expires_on date,
  add column if not exists last_inspection_at timestamptz,
  add column if not exists next_service_due_at timestamptz,
  add column if not exists notes text,
  add column if not exists photo_urls jsonb not null default '[]'::jsonb;

-- Year sanity check
alter table public.crm_equipment
  add constraint crm_equipment_year_range
  check (year is null or (year >= 1900 and year <= 2100));

-- VIN/PIN uniqueness per workspace
create unique index if not exists uq_crm_equipment_workspace_vin_pin
  on public.crm_equipment(workspace_id, lower(vin_pin))
  where vin_pin is not null and deleted_at is null;

-- Availability index for fleet dashboards
create index if not exists idx_crm_equipment_workspace_availability
  on public.crm_equipment(workspace_id, availability)
  where deleted_at is null;

-- Category index for filtering
create index if not exists idx_crm_equipment_workspace_category
  on public.crm_equipment(workspace_id, category)
  where deleted_at is null;

-- Service-due index for maintenance alerts
create index if not exists idx_crm_equipment_next_service_due
  on public.crm_equipment(next_service_due_at asc)
  where next_service_due_at is not null and deleted_at is null;

-- ── Deal-equipment linking ──────────────────────────────────────────────────
create table if not exists public.crm_deal_equipment (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  equipment_id uuid not null references public.crm_equipment(id) on delete cascade,
  role public.crm_deal_equipment_role not null default 'subject',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, equipment_id)
);

alter table public.crm_deal_equipment enable row level security;

create policy "crm_deal_equipment_service_all"
  on public.crm_deal_equipment for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "crm_deal_equipment_elevated_all"
  on public.crm_deal_equipment for all
  using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_deal_equipment_rep_select"
  on public.crm_deal_equipment for select
  using (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(deal_id));

create policy "crm_deal_equipment_rep_insert"
  on public.crm_deal_equipment for insert
  with check (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_deal(deal_id)
    and public.crm_rep_can_access_equipment(equipment_id)
  );

create policy "crm_deal_equipment_rep_delete"
  on public.crm_deal_equipment for delete
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_deal(deal_id)
  );

create index if not exists idx_crm_deal_equipment_deal
  on public.crm_deal_equipment(deal_id);

create index if not exists idx_crm_deal_equipment_equipment
  on public.crm_deal_equipment(equipment_id);

create trigger set_crm_deal_equipment_updated_at
  before update on public.crm_deal_equipment
  for each row execute function public.set_updated_at();

comment on table public.crm_deal_equipment is
  'Links equipment assets to deals with a role (subject of sale, trade-in, rental unit, etc.).';
comment on column public.crm_equipment.engine_hours is 'Current engine/hour meter reading.';
comment on column public.crm_equipment.photo_urls is 'JSON array of image URLs for the asset.';
comment on column public.crm_equipment.vin_pin is 'Vehicle identification number or product identification number.';
