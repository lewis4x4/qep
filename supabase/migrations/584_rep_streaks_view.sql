-- ============================================================================
-- Migration 584: Rep activity streaks view
--
-- Surfaces ambient momentum for the rep Today screen (Slice 2 of the rep
-- Today moonshot). One row per rep, exposing today's visits + quotes plus
-- consecutive-day streak math over the last 90 days.
--
-- The view is read-only and filtered transitively through the underlying
-- tables' RLS — crm_activities (qrm_activities), crm_deals, and quotes
-- already enforce per-rep visibility for reps and full visibility for
-- elevated roles. SECURITY INVOKER is implicit on a view without owner
-- privilege escalation; we mark it explicitly for advisor clarity.
--
-- Activity-type filter rationale: the crm_activity_type enum (migration 021)
-- does not include 'visit' as a discrete value yet. We compare on ::text so
-- the filter is forward-compatible if 'visit' is later added to the enum,
-- without breaking the current shipped schema.
--
-- Streak math uses the classic gap-and-island trick:
--   1. `daily` — for each rep+date in the last 90 days, count activity rows
--      and quote rows independently, then sum.
--   2. `active_days` — keep only the days where the rep did at least one
--      thing.
--   3. `streak_groups` — within each rep, label consecutive active days by
--      subtracting row_number()-over-ordered-by-date from the date itself.
--      Rows on the same run share a "group date".
--   4. `streak_runs` — count rows per (rep, group) and take the run anchored
--      on today as the current streak.
--   5. Final aggregation joins today's tallies + run stats per rep.
-- ============================================================================

drop view if exists public.v_rep_streaks;

create view public.v_rep_streaks
  with (security_barrier = true, security_invoker = true)
  as
with
  -- Today's visits per rep: a "visit-like" activity row is any meeting /
  -- visit / note / call authored by the rep with occurred_at in today UTC.
  visits_today as (
    select
      a.created_by as rep_id,
      count(*)::int as visits_today
    from public.crm_activities a
    where a.deleted_at is null
      and a.created_by is not null
      and a.activity_type::text in ('meeting', 'visit', 'note', 'call')
      and date_trunc('day', a.occurred_at) = date_trunc('day', now())
    group by a.created_by
  ),

  -- Today's quotes per rep: quotes created today on a deal assigned to the
  -- rep. We attribute via crm_deals.assigned_rep_id to match how the rest
  -- of the rep surfaces (v_rep_pipeline, useTodayFeed) attribute work.
  quotes_today as (
    select
      d.assigned_rep_id as rep_id,
      count(*)::int as quotes_today
    from public.quotes q
    join public.crm_deals d on d.id = q.crm_deal_id
    where q.deleted_at is null
      and d.deleted_at is null
      and d.assigned_rep_id is not null
      and date_trunc('day', q.created_at) = date_trunc('day', now())
    group by d.assigned_rep_id
  ),

  -- Daily activity per rep across the last 90 days. We union the two
  -- sources (activities + quotes) at row granularity, then group by day so
  -- a rep who logged 4 calls and sent 1 quote on the same day still counts
  -- as one active day.
  daily_events as (
    select
      a.created_by as rep_id,
      date_trunc('day', a.occurred_at)::date as activity_day
    from public.crm_activities a
    where a.deleted_at is null
      and a.created_by is not null
      and a.activity_type::text in ('meeting', 'visit', 'note', 'call')
      and a.occurred_at >= now() - interval '90 days'
    union all
    select
      d.assigned_rep_id as rep_id,
      date_trunc('day', q.created_at)::date as activity_day
    from public.quotes q
    join public.crm_deals d on d.id = q.crm_deal_id
    where q.deleted_at is null
      and d.deleted_at is null
      and d.assigned_rep_id is not null
      and q.created_at >= now() - interval '90 days'
  ),

  active_days as (
    select distinct rep_id, activity_day
    from daily_events
    where rep_id is not null
  ),

  -- Gap-and-island: for a strictly-decreasing date sequence per rep,
  -- (activity_day + row_number()) is constant across a consecutive run.
  -- We order ASC instead so subtracting row_number() yields the group anchor.
  streak_groups as (
    select
      rep_id,
      activity_day,
      activity_day - (row_number() over (
        partition by rep_id order by activity_day
      ))::int as group_anchor
    from active_days
  ),

  streak_runs as (
    select
      rep_id,
      group_anchor,
      count(*)::int as run_length,
      max(activity_day) as run_end_day
    from streak_groups
    group by rep_id, group_anchor
  ),

  -- Current streak = the run that ends on today. If no run ends today,
  -- current_streak is 0 (rep has not logged anything today).
  current_streak as (
    select
      rep_id,
      run_length as current_streak_days
    from streak_runs
    where run_end_day = current_date
  ),

  longest_streak as (
    select
      rep_id,
      max(run_length)::int as longest_streak_days
    from streak_runs
    group by rep_id
  ),

  -- Most recent event timestamp per rep (activity OR quote). Used for the
  -- "last_active_at" badge subtitle when the streak is broken.
  last_active as (
    select rep_id, max(event_at) as last_active_at
    from (
      select a.created_by as rep_id, a.occurred_at as event_at
      from public.crm_activities a
      where a.deleted_at is null
        and a.created_by is not null
        and a.activity_type::text in ('meeting', 'visit', 'note', 'call')
        and a.occurred_at >= now() - interval '90 days'
      union all
      select d.assigned_rep_id as rep_id, q.created_at as event_at
      from public.quotes q
      join public.crm_deals d on d.id = q.crm_deal_id
      where q.deleted_at is null
        and d.deleted_at is null
        and d.assigned_rep_id is not null
        and q.created_at >= now() - interval '90 days'
    ) e
    where rep_id is not null
    group by rep_id
  ),

  -- Universe of reps we want a row for: anyone with a visit today, a quote
  -- today, OR any active day in the 90-day window. Reps with zero history
  -- in the window simply do not appear; the frontend defaults to a
  -- no-streak chip when the view returns no row.
  rep_universe as (
    select rep_id from visits_today
    union
    select rep_id from quotes_today
    union
    select rep_id from last_active
  )

select
  r.rep_id,
  coalesce(v.visits_today, 0) as visits_today,
  coalesce(qt.quotes_today, 0) as quotes_today,
  coalesce(cs.current_streak_days, 0) as current_streak_days,
  coalesce(ls.longest_streak_days, 0) as longest_streak_days,
  la.last_active_at
from rep_universe r
left join visits_today v on v.rep_id = r.rep_id
left join quotes_today qt on qt.rep_id = r.rep_id
left join current_streak cs on cs.rep_id = r.rep_id
left join longest_streak ls on ls.rep_id = r.rep_id
left join last_active la on la.rep_id = r.rep_id;

comment on view public.v_rep_streaks is
  'Per-rep ambient momentum: visits today, quotes today, current and longest 90-day streaks, and last active timestamp. SECURITY INVOKER so the caller''s RLS on crm_activities / crm_deals / quotes applies.';

grant select on public.v_rep_streaks to authenticated;
