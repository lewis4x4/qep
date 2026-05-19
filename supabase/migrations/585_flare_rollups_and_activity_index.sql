-- ============================================================================
-- Migration 585: P2 post-build audit fixes
--
-- Two unrelated but small changes bundled into one migration:
--
-- 1) public.flare_board_rollups() RPC — single round-trip aggregate for the
--    Quality Center board header strip. The page used to fetch up to 2000
--    flare_status_history rows per mount + every 60s refetch and compute
--    rollups client-side; that scales poorly past 6 months of dense triage.
--    The RPC is workspace-scoped (security invoker), so RLS on the
--    underlying tables governs visibility.
--
-- 2) idx_qrm_activities_creator_occurred — index supporting the
--    v_rep_streaks view (mig 584). Without it the streak view does a seq
--    scan over qrm_activities on every dashboard load.
-- ============================================================================

-- ── 1. RPC: flare_board_rollups ─────────────────────────────────────────────
drop function if exists public.flare_board_rollups();

create or replace function public.flare_board_rollups()
returns table (
  reported_this_week integer,
  shipped_this_week  integer,
  avg_fix_hours      numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with my_ws as (
    select public.get_my_workspace() as workspace_id
  ),
  reported as (
    select count(*)::int as cnt
    from public.flare_reports r, my_ws
    where r.workspace_id = my_ws.workspace_id
      and r.created_at >= now() - interval '7 days'
  ),
  shipped as (
    select count(distinct h.flare_id)::int as cnt
    from public.flare_status_history h, my_ws
    where h.workspace_id = my_ws.workspace_id
      and h.to_status in ('shipped', 'verified')
      and h.created_at >= now() - interval '7 days'
  ),
  first_ship as (
    select h.flare_id, min(h.created_at) as shipped_at
    from public.flare_status_history h, my_ws
    where h.workspace_id = my_ws.workspace_id
      and h.to_status in ('shipped', 'verified')
      and h.created_at >= now() - interval '90 days'
    group by h.flare_id
  ),
  durations as (
    select extract(epoch from (fs.shipped_at - r.created_at)) / 3600.0 as hours
    from first_ship fs
    join public.flare_reports r on r.id = fs.flare_id
    join my_ws on my_ws.workspace_id = r.workspace_id
  )
  select
    coalesce((select cnt from reported), 0),
    coalesce((select cnt from shipped), 0),
    (select avg(hours)::numeric(10,2) from durations);
$$;

comment on function public.flare_board_rollups() is
  'Quality Center board header rollup. Returns reported_this_week, shipped_this_week, avg_fix_hours scoped to the caller''s workspace. Single round-trip replacement for client-side aggregation over flare_status_history.';

grant execute on function public.flare_board_rollups() to authenticated;

-- ── 2. Index for v_rep_streaks performance ──────────────────────────────────
create index if not exists idx_qrm_activities_creator_occurred
  on public.qrm_activities (created_by, occurred_at desc)
  where deleted_at is null;

comment on index public.idx_qrm_activities_creator_occurred is
  'Supports v_rep_streaks (mig 584): per-rep streak math filters on qrm_activities(created_by, occurred_at) and on the partial deleted_at is null predicate. The crm_activities compatibility view plans against this base-table index.';
