-- ============================================================
-- Migration 300: deal economics tables + has_inbound_freight_key
-- ============================================================
-- 1. qb_service_credit_config  — service credit defaults per equipment category
-- 2. qb_internal_freight_rules — internal delivery rate card
-- 3. qb_brands                 — add has_inbound_freight_key column
-- ============================================================

-- ── 1. Service credit config ────────────────────────────────────────────────

create table public.qb_service_credit_config (
  workspace_id         text        not null default 'default',
  category             text        not null check (category in ('compact', 'large', 'forestry')),
  credit_cents         int         not null,
  travel_budget_cents  int         not null,
  updated_at           timestamptz not null default now(),
  primary key (workspace_id, category)
);

alter table public.qb_service_credit_config enable row level security;

-- Service role bypass (matches pattern in 289_qb_rls.sql:41-58)
create policy "qb_service_credit_config_service" on public.qb_service_credit_config
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Authenticated read (matches qb_brands_select pattern at 289_qb_rls.sql:63-64)
create policy "qb_service_credit_config_select" on public.qb_service_credit_config
  for select
  using (workspace_id = public.get_my_workspace() and auth.uid() is not null);

-- Elevated write (matches qb_brands_write pattern at 289_qb_rls.sql:65-67)
create policy "qb_service_credit_config_write" on public.qb_service_credit_config
  for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

-- Seed defaults (idempotent)
insert into public.qb_service_credit_config (workspace_id, category, credit_cents, travel_budget_cents)
values
  ('default', 'compact',  150000, 20000),
  ('default', 'large',    250000, 20000),
  ('default', 'forestry', 350000, 20000)
on conflict do nothing;

-- ── 2. Internal freight rules ───────────────────────────────────────────────

create table public.qb_internal_freight_rules (
  id                  uuid        primary key default gen_random_uuid(),
  workspace_id        text        not null default 'default',
  weight_from_lbs     int,
  weight_to_lbs       int,
  distance_from_miles int,
  distance_to_miles   int,
  rate_type           text        not null check (rate_type in ('flat', 'per_mile', 'per_cwt')),
  rate_amount_cents   int         not null,
  priority            int         not null default 100,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.qb_internal_freight_rules enable row level security;

-- Index for ordered workspace lookup
create index qb_internal_freight_rules_workspace_priority_idx
  on public.qb_internal_freight_rules using btree (workspace_id, priority);

-- Service role bypass
create policy "qb_internal_freight_rules_service" on public.qb_internal_freight_rules
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Authenticated read
create policy "qb_internal_freight_rules_select" on public.qb_internal_freight_rules
  for select
  using (workspace_id = public.get_my_workspace() and auth.uid() is not null);

-- Elevated write
create policy "qb_internal_freight_rules_write" on public.qb_internal_freight_rules
  for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

-- ── 3. qb_brands: add has_inbound_freight_key ───────────────────────────────

alter table public.qb_brands
  add column if not exists has_inbound_freight_key boolean not null default false;

-- Backfill confirmed carriers (owner-verified; others stay false until confirmed)
update public.qb_brands
  set has_inbound_freight_key = true
  where code in ('ASV', 'YANMAR');
