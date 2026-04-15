-- ============================================================================
-- Migration 259: Parts Intelligence Engine — Import Drift View
--
-- Surfaces "big moves" from the most recent PARTMAST import vs. the one before.
-- Operators use this post-commit to sanity-check that a bulk import didn't
-- accidentally wipe out bin locations, swing inventory wildly, or drop parts.
--
-- Pairs with:
--   - preview time: parts_import_runs.preview_diff already shows per-run deltas
--   - post-commit: this view compares point-in-time state (now) against last
--     committed raw_dms_row snapshot to detect silent drift across imports.
-- ============================================================================

create or replace view public.v_parts_import_drift as
with ranked as (
  select
    r.id                        as run_id,
    r.workspace_id,
    r.file_type,
    r.status,
    r.completed_at,
    row_number() over (
      partition by r.workspace_id, r.file_type
      order by r.completed_at desc nulls last
    )                           as rn
  from public.parts_import_runs r
  where r.status = 'committed'
),
current_run as (
  select * from ranked where rn = 1
),
prev_run as (
  select * from ranked where rn = 2
)
select
  pc.workspace_id,
  pc.id                          as part_id,
  pc.part_number,
  pc.co_code,
  pc.div_code,
  pc.branch_code,
  pc.description,
  pc.on_hand                     as current_on_hand,
  (pc.raw_dms_row->>'Inventory')::numeric  as previous_on_hand_approx,
  pc.bin_location                as current_bin_location,
  pc.previous_bin_location,
  pc.list_price                  as current_list_price,
  pc.cost_price                  as current_cost_price,
  cr.run_id                      as last_import_run_id,
  cr.completed_at                as last_imported_at,
  -- Drift heuristics
  case
    when pc.bin_location is distinct from pc.previous_bin_location
      and pc.previous_bin_location is not null
      then true else false
  end                            as bin_location_moved,
  case
    when (pc.raw_dms_row->>'Inventory')::numeric > 0
      and pc.on_hand is not null
      and abs(pc.on_hand - (pc.raw_dms_row->>'Inventory')::numeric)
          / nullif((pc.raw_dms_row->>'Inventory')::numeric, 0) > 0.5
      then true else false
  end                            as inventory_swing_over_50pct
from public.parts_catalog pc
cross join current_run cr
where pc.workspace_id = cr.workspace_id
  and pc.deleted_at is null
  and pc.last_import_run_id = cr.run_id;

comment on view public.v_parts_import_drift is
  'Post-commit drift detection: flags bin moves and >50% inventory swings on the most recent PARTMAST import. '
  'Operators review after a large import to spot accidental sweeps before they bite in the field.';

-- ── RPC: recent drift summary for dashboard ────────────────────────────────

create or replace function public.parts_import_drift_summary(p_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  target_run uuid;
  result jsonb;
begin
  ws := public.get_my_workspace();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;

  if p_run_id is null then
    select id into target_run
    from public.parts_import_runs
    where workspace_id = ws and file_type = 'partmast' and status = 'committed'
    order by completed_at desc nulls last limit 1;
  else
    target_run := p_run_id;
  end if;

  if target_run is null then
    return jsonb_build_object('run_id', null, 'total_parts', 0, 'moved_bins', 0, 'inventory_swings', 0);
  end if;

  select jsonb_build_object(
    'run_id', target_run,
    'total_parts', count(*)::int,
    'moved_bins', count(*) filter (where bin_location_moved)::int,
    'inventory_swings', count(*) filter (where inventory_swing_over_50pct)::int,
    'sample_moves', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'part_number', part_number,
        'from_bin', previous_bin_location,
        'to_bin', current_bin_location,
        'on_hand', current_on_hand
      )), '[]'::jsonb)
      from (
        select * from public.v_parts_import_drift
        where last_import_run_id = target_run
          and bin_location_moved
        limit 20
      ) s
    ),
    'sample_swings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'part_number', part_number,
        'previous_approx', previous_on_hand_approx,
        'current', current_on_hand
      )), '[]'::jsonb)
      from (
        select * from public.v_parts_import_drift
        where last_import_run_id = target_run
          and inventory_swing_over_50pct
        limit 20
      ) s
    )
  ) into result
  from public.v_parts_import_drift
  where last_import_run_id = target_run;

  return result;
end;
$$;

grant execute on function public.parts_import_drift_summary(uuid) to authenticated;

-- ============================================================================
-- Migration 259 complete.
-- ============================================================================
