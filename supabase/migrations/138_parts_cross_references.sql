-- ============================================================================
-- Migration 138: Parts Cross-Reference / Interchangeability Graph
--
-- Captures institutional knowledge about part substitutions, supersessions,
-- and equivalences. Enables the system to suggest alternatives when a part
-- is out of stock or backordered — knowledge that traditionally lives only
-- in the heads of senior parts counter staff.
-- ============================================================================

-- ── Relationship type enum ──────────────────────────────────────────────────

create type public.parts_xref_relationship as enum (
  'interchangeable',
  'supersedes',
  'superseded_by',
  'aftermarket_equivalent',
  'oem_equivalent',
  'kit_component',
  'kit_parent'
);

-- ── parts_cross_references ──────────────────────────────────────────────────

create table public.parts_cross_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  part_number_a text not null,
  part_number_b text not null,
  relationship public.parts_xref_relationship not null,

  -- Confidence in the substitution (0.0–1.0)
  confidence numeric(3, 2) not null default 0.90 check (confidence >= 0 and confidence <= 1),

  -- Where this cross-reference came from
  source text not null default 'manual' check (
    source in ('manual', 'vendor_catalog', 'ai_extracted', 'oem_bulletin', 'field_verified')
  ),

  -- Fitment and compatibility notes
  fitment_notes text,
  price_delta numeric(14, 4),      -- B price minus A price (positive = B is more expensive)
  lead_time_delta_days numeric(8, 2), -- B lead time minus A lead time

  is_active boolean not null default true,

  created_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint parts_xref_no_self_ref check (lower(part_number_a) != lower(part_number_b)),
  unique (workspace_id, part_number_a, part_number_b, relationship)
);

comment on table public.parts_cross_references is
  'Directed graph of part substitutions, supersessions, and equivalences. Edges are (A → B, relationship). Query both directions for full interchangeability.';

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_xref_ws_part_a
  on public.parts_cross_references(workspace_id, lower(part_number_a))
  where deleted_at is null and is_active = true;

create index idx_xref_ws_part_b
  on public.parts_cross_references(workspace_id, lower(part_number_b))
  where deleted_at is null and is_active = true;

create index idx_xref_ws_relationship
  on public.parts_cross_references(workspace_id, relationship)
  where deleted_at is null and is_active = true;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.parts_cross_references enable row level security;

create policy "xref_select"
  on public.parts_cross_references for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

create policy "xref_mutate_staff"
  on public.parts_cross_references for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "xref_service_all"
  on public.parts_cross_references for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Trigger ─────────────────────────────────────────────────────────────────

create trigger set_parts_cross_references_updated_at
  before update on public.parts_cross_references
  for each row execute function public.set_updated_at();

-- ── RPC: Find substitutes for a part with stock availability ────────────────

create or replace function public.find_part_substitutes(
  p_workspace_id text,
  p_part_number text,
  p_branch_id text default null
)
returns table (
  xref_id uuid,
  substitute_part_number text,
  relationship text,
  confidence numeric,
  source text,
  fitment_notes text,
  price_delta numeric,
  lead_time_delta_days numeric,
  qty_available integer,
  available_branch text,
  catalog_description text
)
language sql stable
security definer
as $$
  with xrefs as (
    -- Outbound: A → B
    select
      x.id as xref_id,
      x.part_number_b as substitute_part_number,
      x.relationship::text,
      x.confidence,
      x.source,
      x.fitment_notes,
      x.price_delta,
      x.lead_time_delta_days
    from public.parts_cross_references x
    where x.workspace_id = p_workspace_id
      and lower(x.part_number_a) = lower(p_part_number)
      and x.is_active = true
      and x.deleted_at is null

    union all

    -- Inbound: B → A (reverse direction for symmetric relationships)
    select
      x.id as xref_id,
      x.part_number_a as substitute_part_number,
      case x.relationship
        when 'supersedes' then 'superseded_by'
        when 'superseded_by' then 'supersedes'
        when 'kit_component' then 'kit_parent'
        when 'kit_parent' then 'kit_component'
        else x.relationship::text
      end as relationship,
      x.confidence,
      x.source,
      x.fitment_notes,
      -x.price_delta as price_delta,
      -x.lead_time_delta_days as lead_time_delta_days
    from public.parts_cross_references x
    where x.workspace_id = p_workspace_id
      and lower(x.part_number_b) = lower(p_part_number)
      and x.is_active = true
      and x.deleted_at is null
  )
  select
    xr.xref_id,
    xr.substitute_part_number,
    xr.relationship,
    xr.confidence,
    xr.source,
    xr.fitment_notes,
    xr.price_delta,
    xr.lead_time_delta_days,
    coalesce(pi.qty_on_hand, 0)::integer as qty_available,
    pi.branch_id as available_branch,
    pc.description as catalog_description
  from xrefs xr
  left join public.parts_inventory pi
    on pi.workspace_id = p_workspace_id
    and lower(pi.part_number) = lower(xr.substitute_part_number)
    and pi.deleted_at is null
    and (p_branch_id is null or pi.branch_id = p_branch_id)
  left join public.parts_catalog pc
    on pc.workspace_id = p_workspace_id
    and lower(pc.part_number) = lower(xr.substitute_part_number)
    and pc.deleted_at is null
  order by xr.confidence desc, coalesce(pi.qty_on_hand, 0) desc;
$$;

comment on function public.find_part_substitutes is
  'Find all known substitutes/equivalents for a part, with stock availability per branch and catalog description.';
