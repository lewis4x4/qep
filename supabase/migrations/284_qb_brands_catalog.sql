-- ============================================================================
-- Migration 284: QB Brands and Catalog
--
-- qb_brands            — manufacturer configs (discount %, markup targets, tariffs)
-- qb_equipment_models  — machine catalog with list prices
-- qb_attachments       — attachment catalog
-- qb_freight_zones     — geography-based freight lookup
--
-- Conventions: UUID PKs, workspace_id text, monetary values as bigint cents,
-- percentages as numeric(5,4), updated_at via existing set_updated_at() fn.
-- ============================================================================

-- ── qb_brands ────────────────────────────────────────────────────────────────

create table public.qb_brands (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            text not null default 'default',
  code                    text not null,
  name                    text not null,
  category                text check (category in ('construction','forestry','other')),
  dealer_discount_pct     numeric(5,4) not null default 0.0000,
  default_markup_pct      numeric(5,4) not null,
  markup_floor_pct        numeric(5,4) not null default 0.1000,
  tariff_pct              numeric(5,4) not null default 0.0000,
  pdi_default_cents       bigint not null default 50000,
  good_faith_pct          numeric(5,4) not null default 0.0100,
  attachment_markup_pct   numeric(5,4) not null default 0.2000,
  discount_configured     boolean not null default true,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (workspace_id, code)
);

create index idx_qb_brands_workspace on public.qb_brands(workspace_id);

create trigger set_qb_brands_updated_at
  before update on public.qb_brands
  for each row execute function public.set_updated_at();

-- Seed confirmed brands.
-- Construction (3): dealer discount confirmed by Rylee, pricing engine ready.
-- Forestry (7) + Other (3): discount_configured = false, admin must set via UI.
insert into public.qb_brands
  (code, name, category, dealer_discount_pct, default_markup_pct, markup_floor_pct, tariff_pct, discount_configured)
values
  ('ASV',        'ASV',                         'construction', 0.3000, 0.1200, 0.1000, 0.0500, true),
  ('YANMAR',     'Yanmar Compact Equipment',    'construction', 0.3000, 0.1200, 0.1000, 0.0500, true),
  ('DEVELON',    'Develon (formerly Doosan)',   'construction', 0.2500, 0.1200, 0.1000, 0.0000, true),
  ('BARKO',      'Barko',                       'forestry',     0.0000, 0.1500, 0.1500, 0.0000, false),
  ('PRINOTH',    'Prinoth',                     'forestry',     0.0000, 0.1500, 0.1500, 0.0000, false),
  ('LAMTRAC',    'Lamtrac',                     'forestry',     0.0000, 0.1500, 0.1500, 0.0000, false),
  ('BANDIT',     'Bandit',                      'forestry',     0.0000, 0.1500, 0.1500, 0.0000, false),
  ('SHEAREX',    'Shearex',                     'forestry',     0.0000, 0.1500, 0.1500, 0.0000, false),
  ('DENIS_CIMAF','Denis Cimaf',                 'forestry',     0.0000, 0.1500, 0.1500, 0.0000, false),
  ('SUPERTRAK',  'Supertrak',                   'forestry',     0.0000, 0.1500, 0.1500, 0.0000, false),
  ('CMI',        'CMI',                         'other',        0.0000, 0.1200, 0.1000, 0.0000, false),
  ('SERCO',      'Serco',                       'other',        0.0000, 0.1200, 0.1000, 0.0000, false),
  ('DIAMOND_Z',  'Diamond Z',                   'other',        0.0000, 0.1200, 0.1000, 0.0000, false);

-- ── qb_equipment_models ──────────────────────────────────────────────────────

create table public.qb_equipment_models (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                text not null default 'default',
  brand_id                    uuid not null references public.qb_brands(id),
  model_code                  text not null,
  family                      text,
  series                      text,
  model_year                  int,
  name_display                text not null,
  standard_config             text,
  list_price_cents            bigint not null,
  weight_lbs                  int,
  horsepower                  int,
  specs                       jsonb,
  active                      boolean not null default true,
  aged_inventory_model_year   int,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  unique (workspace_id, brand_id, model_code)
);

create index idx_qb_equipment_models_workspace on public.qb_equipment_models(workspace_id);
create index idx_qb_equipment_models_brand      on public.qb_equipment_models(brand_id);
create index idx_qb_equipment_models_active     on public.qb_equipment_models(active) where active = true;
-- For Slice 05 natural language fuzzy matching via pg_trgm (extensions schema).
create index idx_qb_equipment_models_name_trgm
  on public.qb_equipment_models using gin(name_display extensions.gin_trgm_ops);

create trigger set_qb_equipment_models_updated_at
  before update on public.qb_equipment_models
  for each row execute function public.set_updated_at();

-- ── qb_attachments ───────────────────────────────────────────────────────────

create table public.qb_attachments (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'default',
  brand_id              uuid references public.qb_brands(id),
  part_number           text not null,
  name                  text not null,
  category              text,
  list_price_cents      bigint not null,
  compatible_model_ids  uuid[],
  universal             boolean not null default false,
  attachment_type       text,
  freight_cents         bigint,
  specs                 jsonb,
  active                boolean not null default true,
  acquired_at           date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (workspace_id, brand_id, part_number)
);

create index idx_qb_attachments_workspace on public.qb_attachments(workspace_id);
create index idx_qb_attachments_brand     on public.qb_attachments(brand_id);
create index idx_qb_attachments_category  on public.qb_attachments(category);

create trigger set_qb_attachments_updated_at
  before update on public.qb_attachments
  for each row execute function public.set_updated_at();

-- ── qb_freight_zones ─────────────────────────────────────────────────────────

create table public.qb_freight_zones (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'default',
  brand_id              uuid not null references public.qb_brands(id),
  zone_name             text not null,
  state_codes           text[] not null,
  freight_large_cents   bigint not null,
  freight_small_cents   bigint not null,
  effective_from        date,
  effective_to          date,
  created_at            timestamptz not null default now()
);

create index idx_qb_freight_zones_workspace    on public.qb_freight_zones(workspace_id);
create index idx_qb_freight_zones_brand        on public.qb_freight_zones(brand_id);
create index idx_qb_freight_zones_state_codes  on public.qb_freight_zones using gin(state_codes);

-- Seed: ASV freight for Florida (Q1 2026 price book).
-- Add more zones as price sheets are ingested in Slice 04.
insert into public.qb_freight_zones
  (brand_id, zone_name, state_codes, freight_large_cents, freight_small_cents, effective_from)
select id, 'FL', array['FL'], 194200, 77700, '2026-01-01'
from public.qb_brands
where code = 'ASV';
