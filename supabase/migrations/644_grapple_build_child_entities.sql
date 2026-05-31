-- ============================================================================
-- Migration 644: Stream I grapple-truck build child entities
--
-- I2.1 + I3.1 + I4.1 only. Adds GTB inspection forms, accessory install
-- steps (tanks/coolers/extensions), and build parts sheets as CHILDREN of the
-- standalone grapple_builds production module shipped in migration 643.
--
-- This intentionally does NOT alter the slice-1 grapple_builds core lifecycle
-- and does NOT add I5 build-progress sheets, I6 final QC/Lead sign-off, or I7
-- build-timeline tracking.
-- ============================================================================

-- ── Shared child-table workspace sync ----------------------------------------

create or replace function public.grapple_build_child_sync_build_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text;
begin
  select gb.workspace_id
    into v_workspace_id
  from public.grapple_builds gb
  where gb.id = new.build_id
    and gb.deleted_at is null;

  if v_workspace_id is null then
    raise exception 'grapple build % not found for child row', new.build_id using errcode = '23503';
  end if;

  new.workspace_id := v_workspace_id;
  return new;
end;
$$;

comment on function public.grapple_build_child_sync_build_workspace() is
  'Stream I child-entity guard: child workspace_id is derived from the parent grapple_builds row.';

-- ── I2.1 GTB inspection form --------------------------------------------------

create table if not exists public.grapple_build_gtb_inspections (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete cascade,
  inspection_number integer not null default 1,
  status text not null default 'draft',
  overall_result text,
  inspected_by uuid references public.profiles(id) on delete set null default auth.uid(),
  inspected_at timestamptz,
  signed_by uuid references public.profiles(id) on delete set null,
  signed_at timestamptz,
  signature_name text,
  signature_statement text,
  notes text,
  item_count integer not null default 0,
  failed_item_count integer not null default 0,
  rework_required_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (inspection_number > 0),
  check (status in ('draft', 'in_progress', 'submitted', 'signed', 'void')),
  check (overall_result is null or overall_result in ('pass', 'fail', 'needs_rework', 'not_applicable')),
  check (item_count >= 0 and failed_item_count >= 0 and rework_required_count >= 0),
  check (failed_item_count <= item_count and rework_required_count <= item_count),
  check (status <> 'signed' or (signed_by is not null and signed_at is not null and nullif(trim(signature_name), '') is not null)),
  check (signed_at is null or inspected_at is null or signed_at >= inspected_at)
);

comment on table public.grapple_build_gtb_inspections is
  'I2.1 GTB inspection form header attached to a standalone grapple_build. This is separate from service inspection checklists and service work orders.';
comment on column public.grapple_build_gtb_inspections.signature_statement is
  'Human-readable inspection sign/attestation text. This is inspection sign-off only, not I6 final QC Lead sign-off.';

create table if not exists public.grapple_build_gtb_inspection_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete cascade,
  inspection_id uuid not null references public.grapple_build_gtb_inspections(id) on delete cascade,
  section_key text not null default 'general',
  item_key text not null,
  display_order integer not null default 0,
  prompt text not null,
  result text not null default 'not_checked',
  measured_value text,
  notes text,
  defect_severity text,
  rework_required boolean not null default false,
  checked_by uuid references public.profiles(id) on delete set null,
  checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (inspection_id, item_key),
  check (display_order >= 0),
  check (result in ('not_checked', 'pass', 'fail', 'not_applicable')),
  check (defect_severity is null or defect_severity in ('minor', 'major', 'critical')),
  check (result <> 'fail' or defect_severity is not null or rework_required = true)
);

comment on table public.grapple_build_gtb_inspection_items is
  'I2.1 GTB inspection line results for build-specific inspection prompts, measurements, failures, and rework flags.';

create unique index if not exists idx_grapple_build_gtb_inspections_build_number_live
  on public.grapple_build_gtb_inspections(build_id, inspection_number)
  where deleted_at is null;
create index if not exists idx_grapple_build_gtb_inspections_build
  on public.grapple_build_gtb_inspections(build_id, inspection_number)
  where deleted_at is null;
create index if not exists idx_grapple_build_gtb_inspections_workspace_status
  on public.grapple_build_gtb_inspections(workspace_id, status, updated_at desc)
  where deleted_at is null;
create index if not exists idx_grapple_build_gtb_inspection_items_inspection
  on public.grapple_build_gtb_inspection_items(inspection_id, display_order, item_key)
  where deleted_at is null;
create index if not exists idx_grapple_build_gtb_inspection_items_build_result
  on public.grapple_build_gtb_inspection_items(build_id, result)
  where deleted_at is null;

create or replace function public.grapple_build_gtb_inspection_item_sync_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text;
  v_build_id uuid;
begin
  select i.workspace_id, i.build_id
    into v_workspace_id, v_build_id
  from public.grapple_build_gtb_inspections i
  where i.id = new.inspection_id
    and i.deleted_at is null;

  if v_build_id is null then
    raise exception 'GTB inspection % not found for item row', new.inspection_id using errcode = '23503';
  end if;

  if new.build_id is not null and new.build_id is distinct from v_build_id then
    raise exception 'GTB inspection item build_id must match inspection parent' using errcode = '23514';
  end if;

  new.workspace_id := v_workspace_id;
  new.build_id := v_build_id;
  return new;
end;
$$;

comment on function public.grapple_build_gtb_inspection_item_sync_parent() is
  'I2.1 workspace/build sync guard for GTB inspection item rows.';

create or replace function public.grapple_build_gtb_inspection_recalculate(p_inspection_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.grapple_build_gtb_inspections i
  set item_count = s.item_count,
      failed_item_count = s.failed_item_count,
      rework_required_count = s.rework_required_count,
      overall_result = case
        when i.status = 'void' then i.overall_result
        when s.item_count = 0 then null
        when s.failed_item_count > 0 then 'fail'
        when s.rework_required_count > 0 then 'needs_rework'
        when s.not_checked_count > 0 then i.overall_result
        else 'pass'
      end,
      updated_at = now()
  from (
    select
      count(*)::integer as item_count,
      count(*) filter (where result = 'fail')::integer as failed_item_count,
      count(*) filter (where rework_required)::integer as rework_required_count,
      count(*) filter (where result = 'not_checked')::integer as not_checked_count
    from public.grapple_build_gtb_inspection_items
    where inspection_id = p_inspection_id
      and deleted_at is null
  ) s
  where i.id = p_inspection_id;
end;
$$;

comment on function public.grapple_build_gtb_inspection_recalculate(uuid) is
  'I2.1 rollup helper for GTB inspection header item/failure/rework counts.';

create or replace function public.grapple_build_gtb_inspection_items_after_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.grapple_build_gtb_inspection_recalculate(old.inspection_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.inspection_id is distinct from old.inspection_id) then
    perform public.grapple_build_gtb_inspection_recalculate(new.inspection_id);
  end if;

  return null;
end;
$$;

comment on function public.grapple_build_gtb_inspection_items_after_change() is
  'I2.1 trigger wrapper that keeps GTB inspection header counts synchronized with item rows.';

-- ── I3.1 Accessory installs ---------------------------------------------------

create table if not exists public.grapple_build_accessory_installs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete cascade,
  accessory_type text not null,
  accessory_label text not null default 'standard',
  status text not null default 'not_started',
  installer_id uuid references public.profiles(id) on delete set null,
  installed_at timestamptz,
  started_at timestamptz,
  blocked_reason text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (accessory_type in ('tank', 'cooler', 'extension')),
  check (status in ('not_started', 'in_progress', 'blocked', 'completed', 'waived')),
  check (status <> 'completed' or (installer_id is not null and installed_at is not null)),
  check (status <> 'blocked' or nullif(trim(blocked_reason), '') is not null),
  check (verified_at is null or installed_at is null or verified_at >= installed_at)
);

comment on table public.grapple_build_accessory_installs is
  'I3.1 tracked grapple-build accessory install steps for tanks, coolers, and extensions, with installer and completion timestamp.';
comment on column public.grapple_build_accessory_installs.verified_by is
  'Install-level verification only; this is not I6 final QC / Lead sign-off.';

create unique index if not exists idx_grapple_build_accessory_installs_unique_live
  on public.grapple_build_accessory_installs(build_id, accessory_type, lower(accessory_label))
  where deleted_at is null;
create index if not exists idx_grapple_build_accessory_installs_build_status
  on public.grapple_build_accessory_installs(build_id, status, accessory_type)
  where deleted_at is null;
create index if not exists idx_grapple_build_accessory_installs_workspace_status
  on public.grapple_build_accessory_installs(workspace_id, status, updated_at desc)
  where deleted_at is null;

create or replace function public.ensure_grapple_build_accessory_install_steps(p_build_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text;
  v_inserted integer := 0;
begin
  select gb.workspace_id
    into v_workspace_id
  from public.grapple_builds gb
  where gb.id = p_build_id
    and gb.deleted_at is null;

  if v_workspace_id is null then
    raise exception 'grapple build % not found', p_build_id using errcode = '23503';
  end if;

  if not public.grapple_build_child_can_manage(v_workspace_id, p_build_id) then
    raise exception 'insufficient privileges to manage grapple build % accessory steps', p_build_id using errcode = '42501';
  end if;

  insert into public.grapple_build_accessory_installs (
    workspace_id,
    build_id,
    accessory_type,
    accessory_label,
    metadata
  )
  select
    v_workspace_id,
    p_build_id,
    step.accessory_type,
    step.accessory_type,
    jsonb_build_object('source', 'ensure_grapple_build_accessory_install_steps')
  from (values ('tank'), ('cooler'), ('extension')) as step(accessory_type)
  where not exists (
    select 1
    from public.grapple_build_accessory_installs existing
    where existing.build_id = p_build_id
      and existing.accessory_type = step.accessory_type
      and lower(existing.accessory_label) = step.accessory_type
      and existing.deleted_at is null
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.ensure_grapple_build_accessory_install_steps(uuid) is
  'I3.1 idempotently creates the standard tank/cooler/extension install rows for a grapple build.';

-- Backfill standard install steps for builds already created by slice 1.
insert into public.grapple_build_accessory_installs (
  workspace_id,
  build_id,
  accessory_type,
  accessory_label,
  metadata
)
select
  gb.workspace_id,
  gb.id,
  step.accessory_type,
  step.accessory_type,
  jsonb_build_object('source', 'migration_644_backfill')
from public.grapple_builds gb
cross join (values ('tank'), ('cooler'), ('extension')) as step(accessory_type)
where gb.deleted_at is null
  and not exists (
    select 1
    from public.grapple_build_accessory_installs existing
    where existing.build_id = gb.id
      and existing.accessory_type = step.accessory_type
      and lower(existing.accessory_label) = step.accessory_type
      and existing.deleted_at is null
  )
  on conflict do nothing;

-- ── I4.1 Build parts sheet ----------------------------------------------------

create table if not exists public.grapple_build_parts_sheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete cascade,
  sheet_number integer not null default 1,
  status text not null default 'draft',
  title text not null default 'Build Parts Sheet',
  issued_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz,
  locked_by uuid references public.profiles(id) on delete set null,
  locked_at timestamptz,
  line_count integer not null default 0,
  total_quantity numeric(14, 4) not null default 0,
  total_cost numeric(14, 4) not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (sheet_number > 0),
  check (status in ('draft', 'issued', 'locked', 'void')),
  check (line_count >= 0 and total_quantity >= 0 and total_cost >= 0),
  check (status <> 'issued' or issued_at is not null),
  check (status <> 'locked' or (locked_by is not null and locked_at is not null))
);

comment on table public.grapple_build_parts_sheets is
  'I4.1 build parts sheet header: parts consumed by a standalone grapple_build, not by a service work order or counter sale.';

create table if not exists public.grapple_build_parts_sheet_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete cascade,
  parts_sheet_id uuid not null references public.grapple_build_parts_sheets(id) on delete cascade,
  catalog_item_id uuid references public.parts_catalog(id) on delete set null,
  part_number text not null,
  description text,
  quantity numeric(14, 4) not null default 1,
  uom text not null default 'EA',
  unit_cost numeric(14, 4) not null default 0,
  extended_cost numeric(14, 4) not null default 0,
  consumed_from_branch_id text,
  consumption_status text not null default 'consumed',
  consumed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  consumed_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (quantity > 0),
  check (unit_cost >= 0 and extended_cost >= 0),
  check (sort_order >= 0),
  check (consumption_status in ('planned', 'picked', 'consumed', 'returned', 'void')),
  check (consumption_status <> 'consumed' or consumed_at is not null)
);

comment on table public.grapple_build_parts_sheet_lines is
  'I4.1 build-consumed parts lines. catalog_item_id references parts_catalog when available; part_number/cost are captured on the build for historical costing.';
comment on column public.grapple_build_parts_sheet_lines.consumed_from_branch_id is
  'Optional branch/inventory source marker. This table records build consumption and does not create a service work order or counter sale.';

create unique index if not exists idx_grapple_build_parts_sheets_build_number_live
  on public.grapple_build_parts_sheets(build_id, sheet_number)
  where deleted_at is null;
create index if not exists idx_grapple_build_parts_sheets_build
  on public.grapple_build_parts_sheets(build_id, sheet_number)
  where deleted_at is null;
create index if not exists idx_grapple_build_parts_sheets_workspace_status
  on public.grapple_build_parts_sheets(workspace_id, status, updated_at desc)
  where deleted_at is null;
create index if not exists idx_grapple_build_parts_sheet_lines_sheet
  on public.grapple_build_parts_sheet_lines(parts_sheet_id, sort_order, created_at)
  where deleted_at is null;
create index if not exists idx_grapple_build_parts_sheet_lines_build_part
  on public.grapple_build_parts_sheet_lines(build_id, part_number)
  where deleted_at is null;
create index if not exists idx_grapple_build_parts_sheet_lines_catalog
  on public.grapple_build_parts_sheet_lines(catalog_item_id)
  where catalog_item_id is not null and deleted_at is null;

create or replace function public.grapple_build_parts_sheet_line_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text;
  v_build_id uuid;
  v_part_number text;
  v_description text;
  v_uom text;
  v_cost_price numeric(14, 4);
begin
  select s.workspace_id, s.build_id
    into v_workspace_id, v_build_id
  from public.grapple_build_parts_sheets s
  where s.id = new.parts_sheet_id
    and s.deleted_at is null;

  if v_build_id is null then
    raise exception 'build parts sheet % not found for line row', new.parts_sheet_id using errcode = '23503';
  end if;

  if new.build_id is not null and new.build_id is distinct from v_build_id then
    raise exception 'build parts sheet line build_id must match sheet parent' using errcode = '23514';
  end if;

  if new.catalog_item_id is not null then
    select pc.part_number, pc.description, pc.uom, pc.cost_price
      into v_part_number, v_description, v_uom, v_cost_price
    from public.parts_catalog pc
    where pc.id = new.catalog_item_id
      and pc.workspace_id = v_workspace_id
      and pc.deleted_at is null;

    if v_part_number is null then
      raise exception 'catalog_item_id must reference a parts_catalog row in the build workspace' using errcode = '23514';
    end if;
  end if;

  new.workspace_id := v_workspace_id;
  new.build_id := v_build_id;
  new.part_number := coalesce(nullif(trim(new.part_number), ''), v_part_number);
  new.description := coalesce(nullif(trim(new.description), ''), v_description);
  new.uom := coalesce(nullif(trim(new.uom), ''), nullif(trim(v_uom), ''), 'EA');
  new.unit_cost := case
    when new.catalog_item_id is not null and (new.unit_cost is null or (tg_op = 'INSERT' and new.unit_cost = 0)) then coalesce(v_cost_price, 0)
    else coalesce(new.unit_cost, 0)
  end;

  if nullif(trim(new.part_number), '') is null then
    raise exception 'part_number is required when catalog_item_id is not provided' using errcode = '23502';
  end if;

  if new.consumption_status = 'consumed' and new.consumed_at is null then
    new.consumed_at := now();
  end if;

  new.extended_cost := round(new.quantity * new.unit_cost, 4);
  return new;
end;
$$;

comment on function public.grapple_build_parts_sheet_line_prepare() is
  'I4.1 guard for build parts lines: derives workspace/build from sheet, validates parts_catalog workspace, and snapshots part/cost totals.';

create or replace function public.grapple_build_parts_sheet_recalculate(p_parts_sheet_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.grapple_build_parts_sheets s
  set line_count = totals.line_count,
      total_quantity = totals.total_quantity,
      total_cost = totals.total_cost,
      updated_at = now()
  from (
    select
      count(*)::integer as line_count,
      coalesce(sum(quantity) filter (where consumption_status <> 'void'), 0)::numeric(14, 4) as total_quantity,
      coalesce(sum(extended_cost) filter (where consumption_status <> 'void'), 0)::numeric(14, 4) as total_cost
    from public.grapple_build_parts_sheet_lines
    where parts_sheet_id = p_parts_sheet_id
      and deleted_at is null
  ) totals
  where s.id = p_parts_sheet_id;
end;
$$;

comment on function public.grapple_build_parts_sheet_recalculate(uuid) is
  'I4.1 rollup helper for build parts sheet line count, consumed quantity, and cost.';

create or replace function public.grapple_build_parts_sheet_lines_after_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.grapple_build_parts_sheet_recalculate(old.parts_sheet_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.parts_sheet_id is distinct from old.parts_sheet_id) then
    perform public.grapple_build_parts_sheet_recalculate(new.parts_sheet_id);
  end if;

  return null;
end;
$$;

comment on function public.grapple_build_parts_sheet_lines_after_change() is
  'I4.1 trigger wrapper that keeps build parts sheet totals synchronized with line rows.';

-- ── Triggers -----------------------------------------------------------------

drop trigger if exists trg_grapple_build_gtb_inspections_sync_workspace on public.grapple_build_gtb_inspections;
create trigger trg_grapple_build_gtb_inspections_sync_workspace
  before insert or update of build_id, workspace_id
  on public.grapple_build_gtb_inspections
  for each row execute function public.grapple_build_child_sync_build_workspace();

drop trigger if exists set_grapple_build_gtb_inspections_updated_at on public.grapple_build_gtb_inspections;
create trigger set_grapple_build_gtb_inspections_updated_at
  before update on public.grapple_build_gtb_inspections
  for each row execute function public.set_updated_at();

drop trigger if exists trg_grapple_build_gtb_inspection_items_sync_parent on public.grapple_build_gtb_inspection_items;
create trigger trg_grapple_build_gtb_inspection_items_sync_parent
  before insert or update of inspection_id, build_id, workspace_id
  on public.grapple_build_gtb_inspection_items
  for each row execute function public.grapple_build_gtb_inspection_item_sync_parent();

drop trigger if exists set_grapple_build_gtb_inspection_items_updated_at on public.grapple_build_gtb_inspection_items;
create trigger set_grapple_build_gtb_inspection_items_updated_at
  before update on public.grapple_build_gtb_inspection_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_grapple_build_gtb_inspection_items_after_change on public.grapple_build_gtb_inspection_items;
create trigger trg_grapple_build_gtb_inspection_items_after_change
  after insert or update or delete on public.grapple_build_gtb_inspection_items
  for each row execute function public.grapple_build_gtb_inspection_items_after_change();

drop trigger if exists trg_grapple_build_accessory_installs_sync_workspace on public.grapple_build_accessory_installs;
create trigger trg_grapple_build_accessory_installs_sync_workspace
  before insert or update of build_id, workspace_id
  on public.grapple_build_accessory_installs
  for each row execute function public.grapple_build_child_sync_build_workspace();

drop trigger if exists set_grapple_build_accessory_installs_updated_at on public.grapple_build_accessory_installs;
create trigger set_grapple_build_accessory_installs_updated_at
  before update on public.grapple_build_accessory_installs
  for each row execute function public.set_updated_at();

drop trigger if exists trg_grapple_build_parts_sheets_sync_workspace on public.grapple_build_parts_sheets;
create trigger trg_grapple_build_parts_sheets_sync_workspace
  before insert or update of build_id, workspace_id
  on public.grapple_build_parts_sheets
  for each row execute function public.grapple_build_child_sync_build_workspace();

drop trigger if exists set_grapple_build_parts_sheets_updated_at on public.grapple_build_parts_sheets;
create trigger set_grapple_build_parts_sheets_updated_at
  before update on public.grapple_build_parts_sheets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_grapple_build_parts_sheet_lines_prepare on public.grapple_build_parts_sheet_lines;
create trigger trg_grapple_build_parts_sheet_lines_prepare
  before insert or update of parts_sheet_id, build_id, workspace_id, catalog_item_id, part_number, description, quantity, uom, unit_cost, extended_cost, consumption_status, consumed_at
  on public.grapple_build_parts_sheet_lines
  for each row execute function public.grapple_build_parts_sheet_line_prepare();

drop trigger if exists set_grapple_build_parts_sheet_lines_updated_at on public.grapple_build_parts_sheet_lines;
create trigger set_grapple_build_parts_sheet_lines_updated_at
  before update on public.grapple_build_parts_sheet_lines
  for each row execute function public.set_updated_at();

drop trigger if exists trg_grapple_build_parts_sheet_lines_after_change on public.grapple_build_parts_sheet_lines;
create trigger trg_grapple_build_parts_sheet_lines_after_change
  after insert or update or delete on public.grapple_build_parts_sheet_lines
  for each row execute function public.grapple_build_parts_sheet_lines_after_change();

-- ── RLS ----------------------------------------------------------------------

create or replace function public.grapple_build_child_can_read(
  p_workspace_id text,
  p_build_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.grapple_builds gb
    where gb.id = p_build_id
      and gb.workspace_id = p_workspace_id
      and gb.deleted_at is null
      and public.grapple_build_can_read(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
  );
$$;

comment on function public.grapple_build_child_can_read(text, uuid) is
  'Stream I child-entity RLS helper: read follows the parent grapple_builds workspace/assignment/elevated-role rules.';

create or replace function public.grapple_build_child_can_manage(
  p_workspace_id text,
  p_build_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.grapple_builds gb
    where gb.id = p_build_id
      and gb.workspace_id = p_workspace_id
      and gb.deleted_at is null
      and public.grapple_build_can_manage(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
  );
$$;

comment on function public.grapple_build_child_can_manage(text, uuid) is
  'Stream I child-entity RLS helper: writes follow the parent grapple_builds workspace/assignment/elevated-role rules.';

alter table public.grapple_build_gtb_inspections enable row level security;
alter table public.grapple_build_gtb_inspection_items enable row level security;
alter table public.grapple_build_accessory_installs enable row level security;
alter table public.grapple_build_parts_sheets enable row level security;
alter table public.grapple_build_parts_sheet_lines enable row level security;

-- GTB inspection headers
drop policy if exists "grapple_build_gtb_inspections_service_all" on public.grapple_build_gtb_inspections;
create policy "grapple_build_gtb_inspections_service_all" on public.grapple_build_gtb_inspections for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_gtb_inspections_select_scoped" on public.grapple_build_gtb_inspections;
create policy "grapple_build_gtb_inspections_select_scoped" on public.grapple_build_gtb_inspections for select
  using (deleted_at is null and public.grapple_build_child_can_read(workspace_id, build_id));

drop policy if exists "grapple_build_gtb_inspections_write_assigned_or_manager" on public.grapple_build_gtb_inspections;
drop policy if exists "grapple_build_gtb_inspections_insert_assigned_or_manager" on public.grapple_build_gtb_inspections;
create policy "grapple_build_gtb_inspections_insert_assigned_or_manager" on public.grapple_build_gtb_inspections for insert
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_gtb_inspections_update_assigned_or_manager" on public.grapple_build_gtb_inspections;
create policy "grapple_build_gtb_inspections_update_assigned_or_manager" on public.grapple_build_gtb_inspections for update
  using (public.grapple_build_child_can_manage(workspace_id, build_id))
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_gtb_inspections_delete_assigned_or_manager" on public.grapple_build_gtb_inspections;
create policy "grapple_build_gtb_inspections_delete_assigned_or_manager" on public.grapple_build_gtb_inspections for delete
  using (public.grapple_build_child_can_manage(workspace_id, build_id));

-- GTB inspection items
drop policy if exists "grapple_build_gtb_inspection_items_service_all" on public.grapple_build_gtb_inspection_items;
create policy "grapple_build_gtb_inspection_items_service_all" on public.grapple_build_gtb_inspection_items for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_gtb_inspection_items_select_scoped" on public.grapple_build_gtb_inspection_items;
create policy "grapple_build_gtb_inspection_items_select_scoped" on public.grapple_build_gtb_inspection_items for select
  using (deleted_at is null and public.grapple_build_child_can_read(workspace_id, build_id));

drop policy if exists "grapple_build_gtb_inspection_items_write_assigned_or_manager" on public.grapple_build_gtb_inspection_items;
drop policy if exists "grapple_build_gtb_inspection_items_insert_assigned_or_manager" on public.grapple_build_gtb_inspection_items;
create policy "grapple_build_gtb_inspection_items_insert_assigned_or_manager" on public.grapple_build_gtb_inspection_items for insert
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_gtb_inspection_items_update_assigned_or_manager" on public.grapple_build_gtb_inspection_items;
create policy "grapple_build_gtb_inspection_items_update_assigned_or_manager" on public.grapple_build_gtb_inspection_items for update
  using (public.grapple_build_child_can_manage(workspace_id, build_id))
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_gtb_inspection_items_delete_assigned_or_manager" on public.grapple_build_gtb_inspection_items;
create policy "grapple_build_gtb_inspection_items_delete_assigned_or_manager" on public.grapple_build_gtb_inspection_items for delete
  using (public.grapple_build_child_can_manage(workspace_id, build_id));

-- Accessory installs
drop policy if exists "grapple_build_accessory_installs_service_all" on public.grapple_build_accessory_installs;
create policy "grapple_build_accessory_installs_service_all" on public.grapple_build_accessory_installs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_accessory_installs_select_scoped" on public.grapple_build_accessory_installs;
create policy "grapple_build_accessory_installs_select_scoped" on public.grapple_build_accessory_installs for select
  using (deleted_at is null and public.grapple_build_child_can_read(workspace_id, build_id));

drop policy if exists "grapple_build_accessory_installs_write_assigned_or_manager" on public.grapple_build_accessory_installs;
drop policy if exists "grapple_build_accessory_installs_insert_assigned_or_manager" on public.grapple_build_accessory_installs;
create policy "grapple_build_accessory_installs_insert_assigned_or_manager" on public.grapple_build_accessory_installs for insert
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_accessory_installs_update_assigned_or_manager" on public.grapple_build_accessory_installs;
create policy "grapple_build_accessory_installs_update_assigned_or_manager" on public.grapple_build_accessory_installs for update
  using (public.grapple_build_child_can_manage(workspace_id, build_id))
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_accessory_installs_delete_assigned_or_manager" on public.grapple_build_accessory_installs;
create policy "grapple_build_accessory_installs_delete_assigned_or_manager" on public.grapple_build_accessory_installs for delete
  using (public.grapple_build_child_can_manage(workspace_id, build_id));

-- Parts sheet headers
drop policy if exists "grapple_build_parts_sheets_service_all" on public.grapple_build_parts_sheets;
create policy "grapple_build_parts_sheets_service_all" on public.grapple_build_parts_sheets for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_parts_sheets_select_scoped" on public.grapple_build_parts_sheets;
create policy "grapple_build_parts_sheets_select_scoped" on public.grapple_build_parts_sheets for select
  using (deleted_at is null and public.grapple_build_child_can_read(workspace_id, build_id));

drop policy if exists "grapple_build_parts_sheets_write_assigned_or_manager" on public.grapple_build_parts_sheets;
drop policy if exists "grapple_build_parts_sheets_insert_assigned_or_manager" on public.grapple_build_parts_sheets;
create policy "grapple_build_parts_sheets_insert_assigned_or_manager" on public.grapple_build_parts_sheets for insert
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_parts_sheets_update_assigned_or_manager" on public.grapple_build_parts_sheets;
create policy "grapple_build_parts_sheets_update_assigned_or_manager" on public.grapple_build_parts_sheets for update
  using (public.grapple_build_child_can_manage(workspace_id, build_id))
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_parts_sheets_delete_assigned_or_manager" on public.grapple_build_parts_sheets;
create policy "grapple_build_parts_sheets_delete_assigned_or_manager" on public.grapple_build_parts_sheets for delete
  using (public.grapple_build_child_can_manage(workspace_id, build_id));

-- Parts sheet lines
drop policy if exists "grapple_build_parts_sheet_lines_service_all" on public.grapple_build_parts_sheet_lines;
create policy "grapple_build_parts_sheet_lines_service_all" on public.grapple_build_parts_sheet_lines for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_parts_sheet_lines_select_scoped" on public.grapple_build_parts_sheet_lines;
create policy "grapple_build_parts_sheet_lines_select_scoped" on public.grapple_build_parts_sheet_lines for select
  using (deleted_at is null and public.grapple_build_child_can_read(workspace_id, build_id));

drop policy if exists "grapple_build_parts_sheet_lines_write_assigned_or_manager" on public.grapple_build_parts_sheet_lines;
drop policy if exists "grapple_build_parts_sheet_lines_insert_assigned_or_manager" on public.grapple_build_parts_sheet_lines;
create policy "grapple_build_parts_sheet_lines_insert_assigned_or_manager" on public.grapple_build_parts_sheet_lines for insert
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_parts_sheet_lines_update_assigned_or_manager" on public.grapple_build_parts_sheet_lines;
create policy "grapple_build_parts_sheet_lines_update_assigned_or_manager" on public.grapple_build_parts_sheet_lines for update
  using (public.grapple_build_child_can_manage(workspace_id, build_id))
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_parts_sheet_lines_delete_assigned_or_manager" on public.grapple_build_parts_sheet_lines;
create policy "grapple_build_parts_sheet_lines_delete_assigned_or_manager" on public.grapple_build_parts_sheet_lines for delete
  using (public.grapple_build_child_can_manage(workspace_id, build_id));

-- ── API/read views ------------------------------------------------------------

create or replace view public.v_grapple_build_gtb_inspections
  with (security_invoker = true) as
select
  i.id,
  i.workspace_id,
  i.build_id,
  gb.build_number,
  i.inspection_number,
  i.status,
  i.overall_result,
  i.inspected_by,
  coalesce(nullif(inspector.full_name, ''), inspector.email) as inspected_by_name,
  i.inspected_at,
  i.signed_by,
  coalesce(nullif(signer.full_name, ''), signer.email) as signed_by_name,
  i.signed_at,
  i.signature_name,
  i.signature_statement,
  i.item_count,
  i.failed_item_count,
  i.rework_required_count,
  i.notes,
  i.metadata,
  i.created_at,
  i.updated_at
from public.grapple_build_gtb_inspections i
join public.grapple_builds gb
  on gb.id = i.build_id
 and gb.workspace_id = i.workspace_id
left join public.profiles inspector on inspector.id = i.inspected_by
left join public.profiles signer on signer.id = i.signed_by
where i.deleted_at is null
  and gb.deleted_at is null
  and public.grapple_build_can_read(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
  and ((select auth.role()) = 'service_role' or i.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_gtb_inspections is
  'I2.1 security_invoker view for GTB inspection form headers attached to grapple builds.';

create or replace view public.v_grapple_build_accessory_installs
  with (security_invoker = true) as
select
  a.id,
  a.workspace_id,
  a.build_id,
  gb.build_number,
  a.accessory_type,
  a.accessory_label,
  a.status,
  a.installer_id,
  coalesce(nullif(installer.full_name, ''), installer.email) as installer_name,
  a.started_at,
  a.installed_at,
  a.blocked_reason,
  a.verified_by,
  coalesce(nullif(verifier.full_name, ''), verifier.email) as verified_by_name,
  a.verified_at,
  a.notes,
  a.metadata,
  a.created_at,
  a.updated_at
from public.grapple_build_accessory_installs a
join public.grapple_builds gb
  on gb.id = a.build_id
 and gb.workspace_id = a.workspace_id
left join public.profiles installer on installer.id = a.installer_id
left join public.profiles verifier on verifier.id = a.verified_by
where a.deleted_at is null
  and gb.deleted_at is null
  and public.grapple_build_can_read(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
  and ((select auth.role()) = 'service_role' or a.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_accessory_installs is
  'I3.1 security_invoker view for tank/cooler/extension install state by grapple build.';

create or replace view public.v_grapple_build_parts_sheets
  with (security_invoker = true) as
select
  s.id,
  s.workspace_id,
  s.build_id,
  gb.build_number,
  s.sheet_number,
  s.status,
  s.title,
  s.issued_by,
  coalesce(nullif(issuer.full_name, ''), issuer.email) as issued_by_name,
  s.issued_at,
  s.locked_by,
  coalesce(nullif(locker.full_name, ''), locker.email) as locked_by_name,
  s.locked_at,
  s.line_count,
  s.total_quantity,
  s.total_cost,
  s.notes,
  s.metadata,
  s.created_at,
  s.updated_at
from public.grapple_build_parts_sheets s
join public.grapple_builds gb
  on gb.id = s.build_id
 and gb.workspace_id = s.workspace_id
left join public.profiles issuer on issuer.id = s.issued_by
left join public.profiles locker on locker.id = s.locked_by
where s.deleted_at is null
  and gb.deleted_at is null
  and public.grapple_build_can_read(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
  and ((select auth.role()) = 'service_role' or s.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_parts_sheets is
  'I4.1 security_invoker view for build parts sheet headers and rollup cost by grapple build.';

create or replace view public.v_grapple_build_parts_sheet_lines
  with (security_invoker = true) as
select
  l.id,
  l.workspace_id,
  l.build_id,
  gb.build_number,
  l.parts_sheet_id,
  s.sheet_number,
  l.catalog_item_id,
  pc.part_number as catalog_part_number,
  l.part_number,
  l.description,
  l.quantity,
  l.uom,
  l.unit_cost,
  l.extended_cost,
  l.consumed_from_branch_id,
  l.consumption_status,
  l.consumed_by,
  coalesce(nullif(consumer.full_name, ''), consumer.email) as consumed_by_name,
  l.consumed_at,
  l.notes,
  l.metadata,
  l.sort_order,
  l.created_at,
  l.updated_at
from public.grapple_build_parts_sheet_lines l
join public.grapple_build_parts_sheets s
  on s.id = l.parts_sheet_id
 and s.workspace_id = l.workspace_id
join public.grapple_builds gb
  on gb.id = l.build_id
 and gb.workspace_id = l.workspace_id
left join public.parts_catalog pc on pc.id = l.catalog_item_id
left join public.profiles consumer on consumer.id = l.consumed_by
where l.deleted_at is null
  and s.deleted_at is null
  and gb.deleted_at is null
  and public.grapple_build_can_read(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
  and ((select auth.role()) = 'service_role' or l.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_parts_sheet_lines is
  'I4.1 security_invoker view for build-consumed parts lines, including optional parts_catalog reference.';

-- ── Grants -------------------------------------------------------------------

grant select, insert, update, delete on public.grapple_build_gtb_inspections to authenticated, service_role;
grant select, insert, update, delete on public.grapple_build_gtb_inspection_items to authenticated, service_role;
grant select, insert, update, delete on public.grapple_build_accessory_installs to authenticated, service_role;
grant select, insert, update, delete on public.grapple_build_parts_sheets to authenticated, service_role;
grant select, insert, update, delete on public.grapple_build_parts_sheet_lines to authenticated, service_role;
-- Required for the security_invoker child views to join parent/catalog rows; RLS on those tables remains authoritative.
grant select on public.grapple_builds to authenticated, service_role;
grant select on public.parts_catalog to authenticated, service_role;

grant select on public.v_grapple_build_gtb_inspections to authenticated, service_role;
grant select on public.v_grapple_build_accessory_installs to authenticated, service_role;
grant select on public.v_grapple_build_parts_sheets to authenticated, service_role;
grant select on public.v_grapple_build_parts_sheet_lines to authenticated, service_role;

revoke execute on function public.ensure_grapple_build_accessory_install_steps(uuid) from public;
revoke execute on function public.grapple_build_child_can_read(text, uuid) from public;
revoke execute on function public.grapple_build_child_can_manage(text, uuid) from public;
grant execute on function public.ensure_grapple_build_accessory_install_steps(uuid) to authenticated, service_role;
grant execute on function public.grapple_build_child_can_read(text, uuid) to authenticated, service_role;
grant execute on function public.grapple_build_child_can_manage(text, uuid) to authenticated, service_role;
revoke execute on function public.grapple_build_child_sync_build_workspace() from public;
revoke execute on function public.grapple_build_gtb_inspection_item_sync_parent() from public;
revoke execute on function public.grapple_build_gtb_inspection_recalculate(uuid) from public;
revoke execute on function public.grapple_build_gtb_inspection_items_after_change() from public;
revoke execute on function public.grapple_build_parts_sheet_line_prepare() from public;
revoke execute on function public.grapple_build_parts_sheet_recalculate(uuid) from public;
revoke execute on function public.grapple_build_parts_sheet_lines_after_change() from public;
