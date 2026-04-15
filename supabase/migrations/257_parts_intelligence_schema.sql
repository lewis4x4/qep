-- ============================================================================
-- Migration 257: Parts Intelligence Engine — Schema Foundation
--
-- Extends parts_catalog with full CDK PARTMAST fidelity (multi-branch keyed),
-- adds 24-month history table, vendor price cross-reference, vendor ordering
-- schedules, import run audit trail, and conflict reconciliation queue.
--
-- Pairs with:
--   - edge function: parts-bulk-import (file ingestion)
--   - edge function: parts-import-commit (commit + conflict resolution)
--   - frontend: apps/web/src/features/parts-companion/pages/ImportPage.tsx
--   - frontend: apps/web/src/features/parts-companion/pages/ImportConflictsPage.tsx
--
-- Design principles:
--   * Multi-branch from day 1 — (workspace_id, co_code, div_code, branch_code, part_number)
--   * Nothing silently overwrites manual operator edits — conflict queue
--   * Full audit on every import run, rollbackable
--   * 24-month history preserved verbatim from DMS export for forecast seeding
--   * raw_dms_row jsonb holds the entire CDK record for replay / audit
-- ============================================================================

-- ── Extend parts_catalog with CDK-native fields ─────────────────────────────

alter table public.parts_catalog
  add column if not exists co_code text,
  add column if not exists div_code text,
  add column if not exists branch_code text,
  add column if not exists dms_status char(1),
  add column if not exists machine_code text,
  add column if not exists model_code text,
  add column if not exists stocking_code text,
  add column if not exists source_of_supply text,
  add column if not exists vendor_code text,
  add column if not exists pkg_qty integer,
  add column if not exists parts_per_package integer,
  add column if not exists lead_time_days integer,
  add column if not exists safety_stock_qty numeric(12, 2),
  add column if not exists reorder_point numeric(12, 2),
  add column if not exists eoq numeric(12, 2),
  add column if not exists on_hand numeric(14, 2),
  add column if not exists on_order numeric(14, 2),
  add column if not exists back_ordered numeric(14, 2),
  add column if not exists quantity_allocated numeric(14, 2),
  add column if not exists quantity_reserved numeric(14, 2),
  add column if not exists bin_location text,
  add column if not exists previous_bin_location text,
  add column if not exists class_code text,
  add column if not exists category_code text,
  add column if not exists movement_code text,
  add column if not exists activity_code text,
  add column if not exists asl_category text,
  add column if not exists weight_lbs numeric(10, 4),
  add column if not exists avatax_product_code text,
  add column if not exists avatax_use_exemption text,
  add column if not exists pricing_level_1 numeric(14, 4),
  add column if not exists pricing_level_2 numeric(14, 4),
  add column if not exists pricing_level_3 numeric(14, 4),
  add column if not exists pricing_level_4 numeric(14, 4),
  add column if not exists average_cost numeric(14, 4),
  add column if not exists average_inventory numeric(14, 2),
  add column if not exists last_po_number text,
  add column if not exists last_count_date date,
  add column if not exists last_sale_date date,
  add column if not exists dms_last_modified timestamptz,
  add column if not exists dms_last_ordered timestamptz,
  add column if not exists dms_last_stock_ordered timestamptz,
  add column if not exists dms_date_added date,
  add column if not exists ytd_sales_dollars numeric(14, 2),
  add column if not exists last_year_sales_dollars numeric(14, 2),
  add column if not exists last_year_sales_qty numeric(14, 2),
  add column if not exists last_12mo_sales numeric(14, 2),
  add column if not exists region_last_12mo_sales numeric(14, 2),
  add column if not exists last_import_run_id uuid,
  add column if not exists raw_dms_row jsonb;

comment on column public.parts_catalog.raw_dms_row is
  'Full CDK PARTMAST record snapshot (all 187 cols) from most recent import. Audit + replay.';
comment on column public.parts_catalog.branch_code is
  'CDK branch identifier. A part may exist in multiple branches with independent inventory.';
comment on column public.parts_catalog.vendor_code is
  'CDK vendor short code (e.g. YAN, BAND). Resolved to vendor_profiles via mapping on import.';

-- Per-field manual_override flags — protect operator edits during re-imports
alter table public.parts_catalog
  add column if not exists bin_location_manual_override boolean not null default false,
  add column if not exists reorder_point_manual_override boolean not null default false,
  add column if not exists eoq_manual_override boolean not null default false,
  add column if not exists safety_stock_manual_override boolean not null default false,
  add column if not exists list_price_manual_override boolean not null default false,
  add column if not exists pricing_level_1_manual_override boolean not null default false,
  add column if not exists pricing_level_2_manual_override boolean not null default false,
  add column if not exists pricing_level_3_manual_override boolean not null default false,
  add column if not exists pricing_level_4_manual_override boolean not null default false,
  add column if not exists description_manual_override boolean not null default false,
  add column if not exists category_manual_override boolean not null default false,
  add column if not exists class_code_manual_override boolean not null default false,
  add column if not exists manual_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists manual_updated_at timestamptz;

comment on column public.parts_catalog.bin_location_manual_override is
  'True when an operator hand-edited this field via the UI. Next CDK import will queue a conflict if values differ.';

-- Drop the old (workspace_id, part_number) unique constraint if present and
-- replace with multi-branch composite key. Parts exist independently per branch.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'parts_catalog_workspace_id_part_number_key'
      and conrelid = 'public.parts_catalog'::regclass
  ) then
    alter table public.parts_catalog drop constraint parts_catalog_workspace_id_part_number_key;
  end if;
end $$;

-- Multi-branch composite unique key. NULLS are normalized to empty string for legacy rows.
update public.parts_catalog
  set co_code = coalesce(co_code, ''),
      div_code = coalesce(div_code, ''),
      branch_code = coalesce(branch_code, '')
  where co_code is null or div_code is null or branch_code is null;

alter table public.parts_catalog
  alter column co_code set not null,
  alter column div_code set not null,
  alter column branch_code set not null,
  alter column co_code set default '',
  alter column div_code set default '',
  alter column branch_code set default '';

create unique index if not exists parts_catalog_multi_branch_uk
  on public.parts_catalog (workspace_id, co_code, div_code, branch_code, part_number)
  where deleted_at is null;

-- Useful lookup indexes
create index if not exists idx_parts_catalog_vendor_code
  on public.parts_catalog(workspace_id, vendor_code)
  where vendor_code is not null and deleted_at is null;

create index if not exists idx_parts_catalog_machine
  on public.parts_catalog(workspace_id, machine_code)
  where machine_code is not null and deleted_at is null;

create index if not exists idx_parts_catalog_bin
  on public.parts_catalog(workspace_id, branch_code, bin_location)
  where bin_location is not null and deleted_at is null;

create index if not exists idx_parts_catalog_class
  on public.parts_catalog(workspace_id, class_code)
  where class_code is not null and deleted_at is null;

-- Full-text search support (Phase 2 / 3 NL lookup uses this)
create index if not exists idx_parts_catalog_fts
  on public.parts_catalog using gin (
    to_tsvector('english',
      coalesce(part_number, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(manufacturer, '') || ' ' ||
      coalesce(machine_code, '') || ' ' ||
      coalesce(model_code, ''))
  );

-- ── parts_history_monthly: 24 months of sales / bin trips / demands per part ─

create table if not exists public.parts_history_monthly (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  part_id uuid not null references public.parts_catalog(id) on delete cascade,
  month_offset integer not null check (month_offset between 1 and 24),
  period_end date,
  sales_qty numeric(14, 2) not null default 0,
  bin_trips integer not null default 0,
  demands integer not null default 0,
  source_import_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (part_id, month_offset)
);

comment on table public.parts_history_monthly is
  '24-month rolling history per part: sales qty, bin trips, demands. Seeds demand forecast engine. '
  'month_offset=1 is last month, 24 is 24 months ago.';

create index idx_parts_history_part
  on public.parts_history_monthly(part_id, month_offset);

create index idx_parts_history_ws_period
  on public.parts_history_monthly(workspace_id, period_end)
  where period_end is not null;

alter table public.parts_history_monthly enable row level security;

create policy "parts_history_monthly_select"
  on public.parts_history_monthly for select
  using (workspace_id = public.get_my_workspace());

create policy "parts_history_monthly_mutate"
  on public.parts_history_monthly for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "parts_history_monthly_service_all"
  on public.parts_history_monthly for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_history_monthly_updated_at
  before update on public.parts_history_monthly
  for each row execute function public.set_updated_at();

-- ── parts_vendor_prices: supplier catalog cross-reference ───────────────────

create table if not exists public.parts_vendor_prices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  vendor_code text,
  part_number text not null,
  description text,
  description_fr text,
  list_price numeric(14, 4),
  product_code text,
  currency text not null default 'USD',
  effective_date date not null default current_date,
  source_file text,
  source_import_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_id, part_number, effective_date)
);

comment on table public.parts_vendor_prices is
  'Supplier price catalogs (e.g. Yanmar 2026 Parts Price File). Cross-referenced to parts_catalog by part_number for margin/arbitrage intelligence.';

create index idx_parts_vendor_prices_pn
  on public.parts_vendor_prices(workspace_id, part_number);

create index idx_parts_vendor_prices_vendor
  on public.parts_vendor_prices(vendor_id, effective_date desc);

alter table public.parts_vendor_prices enable row level security;

create policy "parts_vendor_prices_select"
  on public.parts_vendor_prices for select
  using (workspace_id = public.get_my_workspace());

create policy "parts_vendor_prices_mutate"
  on public.parts_vendor_prices for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "parts_vendor_prices_service_all"
  on public.parts_vendor_prices for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_vendor_prices_updated_at
  before update on public.parts_vendor_prices
  for each row execute function public.set_updated_at();

-- ── vendor_order_schedules: when to order from each vendor per branch ──────

create table if not exists public.vendor_order_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  vendor_code text,
  branch_code text not null default '',
  frequency text not null check (frequency in ('daily', 'weekly', 'biweekly', 'monthly', 'on_demand')),
  day_of_week text check (day_of_week in (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  )),
  cutoff_time time,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_id, branch_code, frequency, day_of_week)
);

comment on table public.vendor_order_schedules is
  'Recurring order cadence per vendor per branch. Drives auto-replenish cron (Phase 2).';

create index idx_vendor_order_schedules_vendor
  on public.vendor_order_schedules(vendor_id)
  where is_active = true;

alter table public.vendor_order_schedules enable row level security;

create policy "vendor_order_schedules_select"
  on public.vendor_order_schedules for select
  using (workspace_id = public.get_my_workspace());

create policy "vendor_order_schedules_mutate"
  on public.vendor_order_schedules for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vendor_order_schedules_service_all"
  on public.vendor_order_schedules for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_vendor_order_schedules_updated_at
  before update on public.vendor_order_schedules
  for each row execute function public.set_updated_at();

-- ── parts_import_runs: audit trail for every import ────────────────────────

create type public.parts_import_file_type as enum (
  'partmast',
  'vendor_price',
  'vendor_contacts',
  'unknown'
);

create type public.parts_import_status as enum (
  'pending',
  'parsing',
  'previewing',
  'awaiting_conflicts',
  'committing',
  'committed',
  'failed',
  'rolled_back',
  'cancelled'
);

create table if not exists public.parts_import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  uploaded_by uuid references public.profiles(id) on delete set null,
  source_file_name text not null,
  source_file_hash text not null,
  source_storage_path text,
  file_type public.parts_import_file_type not null default 'unknown',
  vendor_id uuid references public.vendor_profiles(id) on delete set null,
  vendor_code text,
  branch_scope text,
  row_count integer not null default 0,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  rows_skipped integer not null default 0,
  rows_errored integer not null default 0,
  rows_conflicted integer not null default 0,
  status public.parts_import_status not null default 'pending',
  preview_diff jsonb,
  error_log jsonb,
  options jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_import_runs is
  'Audit trail for every Parts Intelligence import. Preview-before-commit, rollbackable. '
  'Hash-dedup prevents accidental double-imports.';

create index idx_parts_import_runs_ws_status
  on public.parts_import_runs(workspace_id, status, started_at desc);

create index idx_parts_import_runs_hash
  on public.parts_import_runs(workspace_id, source_file_hash);

create index idx_parts_import_runs_file_type
  on public.parts_import_runs(workspace_id, file_type, started_at desc);

alter table public.parts_import_runs enable row level security;

create policy "parts_import_runs_select"
  on public.parts_import_runs for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "parts_import_runs_mutate"
  on public.parts_import_runs for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "parts_import_runs_service_all"
  on public.parts_import_runs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_import_runs_updated_at
  before update on public.parts_import_runs
  for each row execute function public.set_updated_at();

-- FK back from parts_catalog.last_import_run_id
alter table public.parts_catalog
  add constraint parts_catalog_last_import_run_fk
  foreign key (last_import_run_id)
  references public.parts_import_runs(id)
  on delete set null;

alter table public.parts_history_monthly
  add constraint parts_history_monthly_run_fk
  foreign key (source_import_run_id)
  references public.parts_import_runs(id)
  on delete set null;

alter table public.parts_vendor_prices
  add constraint parts_vendor_prices_run_fk
  foreign key (source_import_run_id)
  references public.parts_import_runs(id)
  on delete set null;

-- ── parts_import_conflicts: manual-override vs incoming CDK value queue ────

create type public.parts_import_conflict_resolution as enum (
  'keep_current',
  'take_incoming',
  'custom'
);

create type public.parts_import_conflict_priority as enum (
  'high',    -- price / bin / ROP / EOQ — physical world + money
  'normal',  -- descriptive / classification
  'low'      -- historical counters
);

create table if not exists public.parts_import_conflicts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  run_id uuid not null references public.parts_import_runs(id) on delete cascade,
  part_id uuid not null references public.parts_catalog(id) on delete cascade,
  part_number text not null,
  field_name text not null,
  field_label text,
  current_value jsonb,
  current_set_by uuid references public.profiles(id) on delete set null,
  current_set_at timestamptz,
  incoming_value jsonb,
  incoming_source text,
  priority public.parts_import_conflict_priority not null default 'normal',
  resolution public.parts_import_conflict_resolution,
  resolution_value jsonb,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_import_conflicts is
  'Review queue: when a CDK re-import would overwrite a manually-edited field, '
  'the conflict lands here. Operator chooses keep-mine / take-CDK / enter-new.';

create index idx_parts_import_conflicts_run
  on public.parts_import_conflicts(run_id, priority, created_at);

create index idx_parts_import_conflicts_unresolved
  on public.parts_import_conflicts(workspace_id, resolution, priority)
  where resolution is null;

create index idx_parts_import_conflicts_part
  on public.parts_import_conflicts(part_id, resolved_at);

alter table public.parts_import_conflicts enable row level security;

create policy "parts_import_conflicts_select"
  on public.parts_import_conflicts for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_import_conflicts_mutate"
  on public.parts_import_conflicts for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "parts_import_conflicts_service_all"
  on public.parts_import_conflicts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_import_conflicts_updated_at
  before update on public.parts_import_conflicts
  for each row execute function public.set_updated_at();

-- ── Helper: manual-edit tracker ─────────────────────────────────────────────
-- Flips {field}_manual_override true when a UI mutation changes a protected field.
-- Import paths should bypass this by calling `set local parts_catalog.suppress_override_tracking = 'on'`.

create or replace function public.parts_catalog_track_manual_edits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  suppress text;
  actor uuid;
begin
  begin
    suppress := current_setting('parts_catalog.suppress_override_tracking', true);
  exception when others then
    suppress := 'off';
  end;

  if coalesce(suppress, 'off') = 'on' then
    return new;
  end if;

  begin
    actor := auth.uid();
  exception when others then
    actor := null;
  end;

  if tg_op = 'UPDATE' then
    if new.bin_location is distinct from old.bin_location then
      new.bin_location_manual_override := true;
    end if;
    if new.reorder_point is distinct from old.reorder_point then
      new.reorder_point_manual_override := true;
    end if;
    if new.eoq is distinct from old.eoq then
      new.eoq_manual_override := true;
    end if;
    if new.safety_stock_qty is distinct from old.safety_stock_qty then
      new.safety_stock_manual_override := true;
    end if;
    if new.list_price is distinct from old.list_price then
      new.list_price_manual_override := true;
    end if;
    if new.pricing_level_1 is distinct from old.pricing_level_1 then
      new.pricing_level_1_manual_override := true;
    end if;
    if new.pricing_level_2 is distinct from old.pricing_level_2 then
      new.pricing_level_2_manual_override := true;
    end if;
    if new.pricing_level_3 is distinct from old.pricing_level_3 then
      new.pricing_level_3_manual_override := true;
    end if;
    if new.pricing_level_4 is distinct from old.pricing_level_4 then
      new.pricing_level_4_manual_override := true;
    end if;
    if new.description is distinct from old.description then
      new.description_manual_override := true;
    end if;
    if new.category is distinct from old.category then
      new.category_manual_override := true;
    end if;
    if new.class_code is distinct from old.class_code then
      new.class_code_manual_override := true;
    end if;

    -- Stamp actor + timestamp on any protected-field change
    if (new.bin_location is distinct from old.bin_location)
       or (new.reorder_point is distinct from old.reorder_point)
       or (new.eoq is distinct from old.eoq)
       or (new.safety_stock_qty is distinct from old.safety_stock_qty)
       or (new.list_price is distinct from old.list_price)
       or (new.pricing_level_1 is distinct from old.pricing_level_1)
       or (new.pricing_level_2 is distinct from old.pricing_level_2)
       or (new.pricing_level_3 is distinct from old.pricing_level_3)
       or (new.pricing_level_4 is distinct from old.pricing_level_4)
       or (new.description is distinct from old.description)
       or (new.category is distinct from old.category)
       or (new.class_code is distinct from old.class_code) then
      new.manual_updated_at := now();
      if actor is not null then
        new.manual_updated_by := actor;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists parts_catalog_track_manual_edits_trg on public.parts_catalog;
create trigger parts_catalog_track_manual_edits_trg
  before update on public.parts_catalog
  for each row execute function public.parts_catalog_track_manual_edits();

-- ── Helper RPC: update parts_catalog row with override tracking suppressed ─

create or replace function public.exec_suppress_override_update(
  p_part_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
begin
  ws := public.get_my_workspace();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;

  perform set_config('parts_catalog.suppress_override_tracking', 'on', true);

  update public.parts_catalog pc
  set
    description           = coalesce((p_payload->>'description'), pc.description),
    cost_price            = coalesce((p_payload->>'cost_price')::numeric, pc.cost_price),
    average_cost          = coalesce((p_payload->>'average_cost')::numeric, pc.average_cost),
    list_price            = coalesce((p_payload->>'list_price')::numeric, pc.list_price),
    pkg_qty               = coalesce((p_payload->>'pkg_qty')::int, pc.pkg_qty),
    parts_per_package     = coalesce((p_payload->>'parts_per_package')::int, pc.parts_per_package),
    stocking_code         = coalesce((p_payload->>'stocking_code'), pc.stocking_code),
    on_hand               = coalesce((p_payload->>'on_hand')::numeric, pc.on_hand),
    on_order              = coalesce((p_payload->>'on_order')::numeric, pc.on_order),
    back_ordered          = coalesce((p_payload->>'back_ordered')::numeric, pc.back_ordered),
    last_sale_date        = coalesce((p_payload->>'last_sale_date')::date, pc.last_sale_date),
    dms_last_modified     = coalesce((p_payload->>'dms_last_modified')::timestamptz, pc.dms_last_modified),
    dms_last_ordered      = coalesce((p_payload->>'dms_last_ordered')::timestamptz, pc.dms_last_ordered),
    dms_last_stock_ordered = coalesce((p_payload->>'dms_last_stock_ordered')::timestamptz, pc.dms_last_stock_ordered),
    last_count_date       = coalesce((p_payload->>'last_count_date')::date, pc.last_count_date),
    machine_code          = coalesce((p_payload->>'machine_code'), pc.machine_code),
    model_code            = coalesce((p_payload->>'model_code'), pc.model_code),
    source_of_supply      = coalesce((p_payload->>'source_of_supply'), pc.source_of_supply),
    vendor_code           = coalesce((p_payload->>'vendor_code'), pc.vendor_code),
    lead_time_days        = coalesce((p_payload->>'lead_time_days')::int, pc.lead_time_days),
    safety_stock_qty      = coalesce((p_payload->>'safety_stock_qty')::numeric, pc.safety_stock_qty),
    eoq                   = coalesce((p_payload->>'eoq')::numeric, pc.eoq),
    reorder_point         = coalesce((p_payload->>'reorder_point')::numeric, pc.reorder_point),
    bin_location          = coalesce((p_payload->>'bin_location'), pc.bin_location),
    previous_bin_location = coalesce((p_payload->>'previous_bin_location'), pc.previous_bin_location),
    ytd_sales_dollars     = coalesce((p_payload->>'ytd_sales_dollars')::numeric, pc.ytd_sales_dollars),
    last_year_sales_dollars = coalesce((p_payload->>'last_year_sales_dollars')::numeric, pc.last_year_sales_dollars),
    last_year_sales_qty   = coalesce((p_payload->>'last_year_sales_qty')::numeric, pc.last_year_sales_qty),
    last_12mo_sales       = coalesce((p_payload->>'last_12mo_sales')::numeric, pc.last_12mo_sales),
    region_last_12mo_sales = coalesce((p_payload->>'region_last_12mo_sales')::numeric, pc.region_last_12mo_sales),
    class_code            = coalesce((p_payload->>'class_code'), pc.class_code),
    category_code         = coalesce((p_payload->>'category_code'), pc.category_code),
    movement_code         = coalesce((p_payload->>'movement_code'), pc.movement_code),
    activity_code         = coalesce((p_payload->>'activity_code'), pc.activity_code),
    asl_category          = coalesce((p_payload->>'asl_category'), pc.asl_category),
    weight_lbs            = coalesce((p_payload->>'weight_lbs')::numeric, pc.weight_lbs),
    pricing_level_1       = coalesce((p_payload->>'pricing_level_1')::numeric, pc.pricing_level_1),
    pricing_level_2       = coalesce((p_payload->>'pricing_level_2')::numeric, pc.pricing_level_2),
    pricing_level_3       = coalesce((p_payload->>'pricing_level_3')::numeric, pc.pricing_level_3),
    pricing_level_4       = coalesce((p_payload->>'pricing_level_4')::numeric, pc.pricing_level_4),
    last_po_number        = coalesce((p_payload->>'last_po_number'), pc.last_po_number),
    dms_status            = coalesce((p_payload->>'dms_status'), pc.dms_status),
    last_import_run_id    = coalesce((p_payload->>'last_import_run_id')::uuid, pc.last_import_run_id),
    raw_dms_row           = coalesce((p_payload->'raw_dms_row'), pc.raw_dms_row),
    updated_at            = now()
  where pc.id = p_part_id
    and pc.workspace_id = ws;

  return jsonb_build_object('ok', true, 'part_id', p_part_id);
end;
$$;

grant execute on function public.exec_suppress_override_update(uuid, jsonb) to authenticated;

-- ── Helper RPC: stats for /parts/import dashboard ───────────────────────────

create or replace function public.parts_import_dashboard_stats(p_workspace text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  result jsonb;
begin
  ws := coalesce(p_workspace, public.get_my_workspace());

  select jsonb_build_object(
    'total_parts', (
      select count(*)::int from public.parts_catalog
      where workspace_id = ws and deleted_at is null
    ),
    'total_vendor_prices', (
      select count(*)::int from public.parts_vendor_prices
      where workspace_id = ws
    ),
    'unresolved_conflicts', (
      select count(*)::int from public.parts_import_conflicts
      where workspace_id = ws and resolution is null
    ),
    'high_priority_conflicts', (
      select count(*)::int from public.parts_import_conflicts
      where workspace_id = ws and resolution is null and priority = 'high'
    ),
    'recent_runs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'file_name', source_file_name,
        'file_type', file_type,
        'status', status,
        'row_count', row_count,
        'rows_inserted', rows_inserted,
        'rows_updated', rows_updated,
        'rows_conflicted', rows_conflicted,
        'started_at', started_at,
        'completed_at', completed_at
      ) order by started_at desc), '[]'::jsonb)
      from (
        select * from public.parts_import_runs
        where workspace_id = ws
        order by started_at desc limit 10
      ) r
    ),
    'branches', (
      select coalesce(jsonb_agg(distinct branch_code), '[]'::jsonb)
      from public.parts_catalog
      where workspace_id = ws and deleted_at is null and branch_code is not null and branch_code <> ''
    ),
    'last_partmast_import', (
      select max(completed_at) from public.parts_import_runs
      where workspace_id = ws and file_type = 'partmast' and status = 'committed'
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.parts_import_dashboard_stats(text) to authenticated;

-- ── Helper: bulk conflict resolution ────────────────────────────────────────

create or replace function public.resolve_parts_import_conflicts_bulk(
  p_run_id uuid,
  p_field_names text[],
  p_resolution public.parts_import_conflict_resolution,
  p_notes text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
  resolved_count int;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();

  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role for bulk conflict resolution';
  end if;

  if not exists (
    select 1 from public.parts_import_runs
    where id = p_run_id and workspace_id = ws
  ) then
    raise exception 'import run not found in workspace';
  end if;

  update public.parts_import_conflicts
  set resolution = p_resolution,
      resolved_by = actor,
      resolved_at = now(),
      notes = coalesce(p_notes, notes),
      updated_at = now()
  where run_id = p_run_id
    and workspace_id = ws
    and resolution is null
    and (p_field_names is null or field_name = any(p_field_names));

  get diagnostics resolved_count = row_count;
  return resolved_count;
end;
$$;

grant execute on function public.resolve_parts_import_conflicts_bulk(uuid, text[], public.parts_import_conflict_resolution, text) to authenticated;

-- ── View: parts with margin + vendor arbitrage signals (Phase 2 preview) ────

create or replace view public.v_parts_margin_signal as
select
  pc.id                    as part_id,
  pc.workspace_id,
  pc.part_number,
  pc.description,
  pc.co_code,
  pc.div_code,
  pc.branch_code,
  pc.vendor_code,
  pc.list_price,
  pc.cost_price,
  pc.average_cost,
  pc.on_hand,
  pc.reorder_point,
  vp.list_price            as vendor_list_price,
  vp.effective_date        as vendor_price_date,
  case
    when pc.list_price > 0 and pc.cost_price > 0
      then round(((pc.list_price - pc.cost_price) / pc.list_price) * 100.0, 2)
    else null
  end                      as margin_pct_on_cost,
  case
    when pc.list_price > 0 and vp.list_price > 0
      then round(((pc.list_price - vp.list_price) / pc.list_price) * 100.0, 2)
    else null
  end                      as margin_pct_on_vendor_list,
  case
    when vp.list_price > 0 and pc.cost_price > 0 and pc.cost_price > vp.list_price * 1.05
      then true
    else false
  end                      as potential_overpay
from public.parts_catalog pc
left join lateral (
  select list_price, effective_date
  from public.parts_vendor_prices vpi
  where vpi.workspace_id = pc.workspace_id
    and vpi.part_number = pc.part_number
  order by effective_date desc limit 1
) vp on true
where pc.deleted_at is null;

comment on view public.v_parts_margin_signal is
  'Per-part margin signal: sell price vs internal cost vs latest vendor list. Powers Phase 2 arbitrage dashboard.';

-- ── Seed: Yanmar vendor profile (pre-seed decision from plan §10 #2) ───────

insert into public.vendor_profiles (workspace_id, name, supplier_type, category_support, notes)
select 'default', 'Yanmar', 'oem',
       '["engines", "filters", "hydraulics", "drivetrain"]'::jsonb,
       'Pre-seeded 2026-04-15 for Parts Intelligence Engine hydration.'
where not exists (
  select 1 from public.vendor_profiles
  where workspace_id = 'default' and lower(name) = 'yanmar'
);

-- ============================================================================
-- Migration 257 complete.
--
-- Next:
--   * Edge function: parts-bulk-import (parses xlsx, writes preview, queues conflicts)
--   * Edge function: parts-import-commit (applies approved preview, resolves conflicts)
--   * Frontend: apps/web/src/features/parts-companion/pages/ImportPage.tsx
--   * Frontend: apps/web/src/features/parts-companion/pages/ImportConflictsPage.tsx
--   * Hydration: run imports against delivered files in ~/Downloads/fwmixingequipmentwsecurity/
-- ============================================================================
