-- ============================================================================
-- Migration 225: Ownership Intelligence Dashboard (Track 3 Slice 3.7)
--
-- Adds the read surfaces for the Iron Manager ownership-intelligence panel:
--   1. margin_analytics_view  — margin rollups by rep / equipment category / month
--   2. pipeline_velocity_rpc  — stage-level weighted pipeline + avg days in stage
--
-- Both surfaces are elevated-role only (admin / manager / owner) and scoped to
-- the caller's active workspace via get_my_workspace().
-- ============================================================================

-- ── 1. Margin analytics view ────────────────────────────────────────────────

drop view if exists public.margin_analytics_view;

create view public.margin_analytics_view with (security_barrier = true) as
with open_deals as (
  select
    d.workspace_id,
    d.id as deal_id,
    d.assigned_rep_id as rep_id,
    coalesce(nullif(p.full_name, ''), nullif(p.email, ''), 'Unassigned') as rep_name,
    coalesce(eq_meta.equipment_category, 'unassigned') as equipment_category,
    date_trunc('month', coalesce(d.expected_close_on::timestamp, d.created_at))::date as month_bucket,
    coalesce(d.amount, 0)::numeric(14,2) as amount,
    d.margin_pct,
    d.margin_check_status
  from public.crm_deals d
  left join public.profiles p on p.id = d.assigned_rep_id
  left join lateral (
    select
      coalesce(eq.category::text, 'unassigned') as equipment_category
    from public.crm_deal_equipment de
    join public.crm_equipment eq on eq.id = de.equipment_id
    where de.deal_id = d.id
    order by
      case when de.role = 'subject' then 0 else 1 end,
      de.created_at asc
    limit 1
  ) eq_meta on true
  where d.workspace_id = public.get_my_workspace()
    and d.deleted_at is null
    and d.closed_at is null
    and public.get_my_role() in ('admin', 'manager', 'owner')
)
select
  workspace_id,
  rep_id,
  rep_name,
  equipment_category,
  month_bucket,
  count(*)::integer as deal_count,
  sum(amount)::numeric(14,2) as total_pipeline,
  round(avg(margin_pct)::numeric, 2) as avg_margin_pct,
  count(*) filter (where margin_check_status = 'flagged')::integer as flagged_deal_count
from open_deals
group by workspace_id, rep_id, rep_name, equipment_category, month_bucket;

comment on view public.margin_analytics_view is
  'Track 3 Slice 3.7: open-deal margin rollup by rep, equipment category, and month for elevated roles only.';

grant select on public.margin_analytics_view to authenticated;

-- ── 2. Pipeline velocity RPC ────────────────────────────────────────────────

drop function if exists public.pipeline_velocity_rpc(integer);

create or replace function public.pipeline_velocity_rpc(
  p_threshold_days integer default 14
)
returns table(
  stage_id uuid,
  stage_name text,
  sort_order integer,
  open_deal_count integer,
  raw_pipeline numeric,
  weighted_pipeline numeric,
  avg_days_in_stage numeric,
  max_days_in_stage integer,
  threshold_days integer,
  is_bottleneck boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with threshold_config as (
    select greatest(coalesce(p_threshold_days, 14), 1) as default_threshold_days
  )
  select
    s.id as stage_id,
    s.name as stage_name,
    s.sort_order,
    count(d.id)::integer as open_deal_count,
    coalesce(sum(d.amount), 0)::numeric(14,2) as raw_pipeline,
    coalesce(
      sum(coalesce(d.amount, 0)::numeric * (coalesce(s.probability, 0)::numeric / 100.0)),
      0
    )::numeric(14,2) as weighted_pipeline,
    coalesce(
      round(
        avg(
          case
            when d.id is not null then public.qrm_stage_age(d.id)
            else null
          end
        )::numeric,
        1
      ),
      0
    )::numeric(10,1) as avg_days_in_stage,
    coalesce(
      max(
        case
          when d.id is not null then public.qrm_stage_age(d.id)
          else null
        end
      ),
      0
    )::integer as max_days_in_stage,
    coalesce(
      nullif(ceil(coalesce(s.sla_minutes, 0)::numeric / 1440.0), 0)::integer,
      tc.default_threshold_days
    ) as threshold_days,
    coalesce(
      round(
        avg(
          case
            when d.id is not null then public.qrm_stage_age(d.id)
            else null
          end
        )::numeric,
        1
      ),
      0
    ) > coalesce(
      nullif(ceil(coalesce(s.sla_minutes, 0)::numeric / 1440.0), 0)::integer,
      tc.default_threshold_days
    ) as is_bottleneck
  from public.crm_deal_stages s
  cross join threshold_config tc
  left join public.crm_deals d
    on d.stage_id = s.id
   and d.workspace_id = public.get_my_workspace()
   and d.deleted_at is null
   and d.closed_at is null
  where public.get_my_role() in ('admin', 'manager', 'owner')
    and coalesce(s.is_closed_won, false) = false
    and coalesce(s.is_closed_lost, false) = false
  group by s.id, s.name, s.sort_order, s.probability, s.sla_minutes, tc.default_threshold_days
  order by s.sort_order nulls last, s.name;
$$;

comment on function public.pipeline_velocity_rpc(integer) is
  'Track 3 Slice 3.7: stage-level pipeline velocity for the active workspace with weighted pipeline, avg stage age, and bottleneck flags.';

revoke all on function public.pipeline_velocity_rpc(integer) from public;
grant execute on function public.pipeline_velocity_rpc(integer) to authenticated, service_role;
