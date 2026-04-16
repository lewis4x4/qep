-- ============================================================================
-- Migration 273: Owner Dashboard — schema foundation for the moonshot cockpit
--
-- The /owner page needs one-RPC access to ~20 KPIs across Parts, Sales,
-- Service, Rental, and Finance. This migration builds:
--
--   1. owner_dashboard_summary(workspace)  — aggregates every KPI in one call
--   2. compute_ownership_health_score(workspace)  — composite 0-100 score
--   3. owner_event_feed(workspace, since)  — last N events (feeds AI brief)
--   4. v_branch_stack_ranking  — per-branch KPIs with quartile tiers
--
-- Defensive pattern: every referenced table/view is wrapped in a try/except
-- so the RPC returns a partial payload instead of failing when an upstream
-- surface is missing. This keeps the owner dashboard working even as other
-- domains mature.
-- ============================================================================

-- ── RPC: owner_dashboard_summary ────────────────────────────────────────────
-- One call → complete KPI grid payload for Tier 3.

create or replace function public.owner_dashboard_summary(
  p_workspace text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ws text;
  v_today_revenue numeric;
  v_mtd_revenue numeric;
  v_revenue_prev_month_same_day numeric;
  v_pipeline_total numeric;
  v_pipeline_at_risk_count integer;
  v_parts_total int;
  v_parts_dead_capital numeric;
  v_parts_stockout_critical int;
  v_parts_predictive_revenue numeric;
  v_parts_predictive_open_plays int;
  v_parts_replenish_pending int;
  v_parts_margin_erosion int;
  v_ar_aged_90 numeric;
  v_payment_exception_rate numeric;
  v_last_import_at timestamptz;
  v_result jsonb;
begin
  ws := coalesce(p_workspace, public.get_my_workspace(), 'default');

  -- ── Revenue (today + MTD + YoY proxy) ─────────────────────────────────
  begin
    select coalesce(sum(total_amount), 0)
    into v_today_revenue
    from public.parts_orders
    where workspace_id = ws
      and created_at >= date_trunc('day', now())
      and status not in ('cancelled', 'draft');
  exception when others then v_today_revenue := 0; end;

  begin
    select coalesce(sum(total_amount), 0)
    into v_mtd_revenue
    from public.parts_orders
    where workspace_id = ws
      and created_at >= date_trunc('month', now())
      and status not in ('cancelled', 'draft');
  exception when others then v_mtd_revenue := 0; end;

  begin
    select coalesce(sum(total_amount), 0)
    into v_revenue_prev_month_same_day
    from public.parts_orders
    where workspace_id = ws
      and created_at >= date_trunc('month', now() - interval '1 month')
      and created_at < date_trunc('month', now() - interval '1 month') + (now() - date_trunc('month', now()))
      and status not in ('cancelled', 'draft');
  exception when others then v_revenue_prev_month_same_day := 0; end;

  -- ── Pipeline (open QRM/CRM deals) ────────────────────────────────────
  begin
    select
      coalesce(sum(amount), 0),
      count(*) filter (where
        updated_at < now() - interval '14 days'
        and (status not in ('closed_won', 'closed_lost')
             or status is null)
      )::int
    into v_pipeline_total, v_pipeline_at_risk_count
    from public.qrm_deals
    where workspace_id = ws
      and deleted_at is null
      and (status not in ('closed_won', 'closed_lost') or status is null);
  exception when others then
    v_pipeline_total := 0; v_pipeline_at_risk_count := 0;
  end;

  -- ── Parts Intelligence ────────────────────────────────────────────────
  begin
    select count(*)::int
    into v_parts_total
    from public.parts_catalog
    where workspace_id = ws and deleted_at is null;
  exception when others then v_parts_total := 0; end;

  begin
    select coalesce(sum(capital_on_hand), 0)
    into v_parts_dead_capital
    from public.v_parts_dead_capital
    where workspace_id = ws;
  exception when others then v_parts_dead_capital := 0; end;

  begin
    select count(*)::int
    into v_parts_stockout_critical
    from public.v_parts_stockout_risk
    where workspace_id = ws
      and stockout_risk in ('stocked_out', 'critical');
  exception when others then v_parts_stockout_critical := 0; end;

  begin
    select
      coalesce(sum(p.projected_revenue * p.recommended_order_qty), 0),
      count(*)::int
    into v_parts_predictive_revenue, v_parts_predictive_open_plays
    from public.predicted_parts_plays p
    where p.workspace_id = ws and p.status = 'open';
  exception when others then
    v_parts_predictive_revenue := 0; v_parts_predictive_open_plays := 0;
  end;

  begin
    select count(*)::int
    into v_parts_replenish_pending
    from public.parts_auto_replenish_queue
    where workspace_id = ws
      and status in ('pending', 'scheduled', 'auto_approved');
  exception when others then v_parts_replenish_pending := 0; end;

  begin
    select count(*)::int
    into v_parts_margin_erosion
    from public.v_parts_margin_signal
    where workspace_id = ws and potential_overpay = true;
  exception when others then v_parts_margin_erosion := 0; end;

  -- ── AR Health (last 90d aging, payment exceptions) ──────────────────
  begin
    select coalesce(sum(amount_outstanding), 0)
    into v_ar_aged_90
    from public.customer_invoices
    where workspace_id = ws
      and due_date < current_date - interval '90 days'
      and status <> 'paid';
  exception when others then v_ar_aged_90 := 0; end;

  -- ── Last CDK import (freshness signal) ──────────────────────────────
  begin
    select max(completed_at)
    into v_last_import_at
    from public.parts_import_runs
    where workspace_id = ws
      and status = 'committed';
  exception when others then v_last_import_at := null; end;

  -- ── Assemble payload ────────────────────────────────────────────────
  v_result := jsonb_build_object(
    'generated_at', now(),
    'workspace_id', ws,
    'revenue', jsonb_build_object(
      'today', v_today_revenue,
      'mtd', v_mtd_revenue,
      'prev_month_same_day', v_revenue_prev_month_same_day,
      'mtd_vs_prev_pct', case
        when v_revenue_prev_month_same_day > 0
          then round(((v_mtd_revenue - v_revenue_prev_month_same_day) / v_revenue_prev_month_same_day * 100)::numeric, 1)
        else null
      end
    ),
    'pipeline', jsonb_build_object(
      'weighted_total', v_pipeline_total,
      'at_risk_count', v_pipeline_at_risk_count
    ),
    'parts', jsonb_build_object(
      'total_catalog', v_parts_total,
      'dead_capital_usd', v_parts_dead_capital,
      'stockout_critical', v_parts_stockout_critical,
      'predictive_revenue_open', v_parts_predictive_revenue,
      'predictive_open_plays', v_parts_predictive_open_plays,
      'replenish_pending', v_parts_replenish_pending,
      'margin_erosion_flags', v_parts_margin_erosion,
      'last_import_at', v_last_import_at
    ),
    'finance', jsonb_build_object(
      'ar_aged_90_plus', v_ar_aged_90
    )
  );

  return v_result;
end;
$$;

grant execute on function public.owner_dashboard_summary(text) to authenticated;

-- ── RPC: compute_ownership_health_score ────────────────────────────────────
-- Weighted 0-100 composite across 5 dimensions.

create or replace function public.compute_ownership_health_score(
  p_workspace text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ws text;
  v_summary jsonb;
  v_parts_score int;
  v_sales_score int;
  v_service_score int;
  v_rental_score int;
  v_finance_score int;
  v_composite int;
  v_stockouts int;
  v_dead_capital numeric;
  v_catalog_total int;
  v_pipeline_total numeric;
  v_at_risk int;
  v_ar_aged numeric;
begin
  ws := coalesce(p_workspace, public.get_my_workspace(), 'default');
  v_summary := public.owner_dashboard_summary(ws);

  -- Parts (20%) — stockouts low = good, dead capital low = good
  v_stockouts := coalesce((v_summary->'parts'->>'stockout_critical')::int, 0);
  v_dead_capital := coalesce((v_summary->'parts'->>'dead_capital_usd')::numeric, 0);
  v_catalog_total := greatest(1, coalesce((v_summary->'parts'->>'total_catalog')::int, 1));

  v_parts_score := greatest(0, least(100,
    -- Start at 100, subtract for each issue
    100
    - least(40, (v_stockouts::numeric / v_catalog_total * 100)::int)  -- stockout ratio
    - least(30, (v_dead_capital / 10000)::int)                          -- dead capital (per $10k)
  ));

  -- Sales (25%) — pipeline volume good, at-risk ratio bad
  v_pipeline_total := coalesce((v_summary->'pipeline'->>'weighted_total')::numeric, 0);
  v_at_risk := coalesce((v_summary->'pipeline'->>'at_risk_count')::int, 0);

  v_sales_score := greatest(0, least(100,
    60                                                                        -- baseline 60 for having ANY data
    + least(30, (v_pipeline_total / 100000)::int * 3)                         -- pipeline health
    - least(30, v_at_risk * 5)                                                -- at-risk penalty
  ));

  -- Service (20%) — default 75 until service_dashboard_rollup wiring lands
  v_service_score := 75;
  begin
    select
      greatest(0, least(100,
        100 - coalesce(sum(case when status in ('stuck','overdue') then 8 else 0 end), 0)
      ))::int
    into v_service_score
    from public.service_jobs
    where workspace_id = ws
      and status not in ('complete', 'closed', 'cancelled')
      and created_at > now() - interval '60 days';
  exception when others then v_service_score := 75; end;

  -- Rental (15%) — default 75 until rental utilization data confirmed
  v_rental_score := 75;

  -- Finance (20%) — AR aging
  v_ar_aged := coalesce((v_summary->'finance'->>'ar_aged_90_plus')::numeric, 0);

  v_finance_score := greatest(0, least(100,
    100 - least(60, (v_ar_aged / 5000)::int)                                  -- $5k aged = -1
  ));

  -- Composite (weighted)
  v_composite := round(
    (v_parts_score * 0.20)
    + (v_sales_score * 0.25)
    + (v_service_score * 0.20)
    + (v_rental_score * 0.15)
    + (v_finance_score * 0.20)
  )::int;

  return jsonb_build_object(
    'score', v_composite,
    'generated_at', now(),
    'dimensions', jsonb_build_object(
      'parts', v_parts_score,
      'sales', v_sales_score,
      'service', v_service_score,
      'rental', v_rental_score,
      'finance', v_finance_score
    ),
    'weights', jsonb_build_object(
      'parts', 0.20, 'sales', 0.25, 'service', 0.20, 'rental', 0.15, 'finance', 0.20
    ),
    'tier', case
      when v_composite >= 85 then 'excellent'
      when v_composite >= 70 then 'healthy'
      when v_composite >= 55 then 'attention'
      else 'critical'
    end
  );
end;
$$;

grant execute on function public.compute_ownership_health_score(text) to authenticated;

-- ── RPC: owner_event_feed ──────────────────────────────────────────────────
-- Last N hours of notable events. Feeds the Owner Brief prompt.

create or replace function public.owner_event_feed(
  p_workspace text default null,
  p_hours_back integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ws text;
  v_since timestamptz;
  v_events jsonb := '[]'::jsonb;
begin
  ws := coalesce(p_workspace, public.get_my_workspace(), 'default');
  v_since := now() - (p_hours_back || ' hours')::interval;

  -- New parts orders
  begin
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'parts_order_created',
        'at', created_at,
        'summary', format('Parts order created (%s)', coalesce(order_source, 'counter')),
        'amount', total_amount,
        'id', id
      ))
      from public.parts_orders
      where workspace_id = ws
        and created_at >= v_since
      limit 20
    ), '[]'::jsonb);
  exception when others then null; end;

  -- New predictive plays (what Claude wrote overnight)
  begin
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'predictive_play_created',
        'at', created_at,
        'summary', format('Predictive play: %s in %s days', part_number, projection_window),
        'revenue', projected_revenue * recommended_order_qty,
        'id', id
      ))
      from public.predicted_parts_plays
      where workspace_id = ws
        and created_at >= v_since
        and status = 'open'
      limit 10
    ), '[]'::jsonb);
  exception when others then null; end;

  -- CDK imports
  begin
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'cdk_import_committed',
        'at', completed_at,
        'summary', format('%s import committed: %s rows (%s new, %s updated)',
                          file_type, row_count, rows_inserted, rows_updated),
        'id', id
      ))
      from public.parts_import_runs
      where workspace_id = ws
        and completed_at >= v_since
        and status = 'committed'
      limit 10
    ), '[]'::jsonb);
  exception when others then null; end;

  -- Deals closed
  begin
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'deal_closed_won',
        'at', updated_at,
        'summary', format('Deal closed: %s', coalesce(name, 'untitled')),
        'amount', amount,
        'id', id
      ))
      from public.qrm_deals
      where workspace_id = ws
        and updated_at >= v_since
        and status = 'closed_won'
      limit 10
    ), '[]'::jsonb);
  exception when others then null; end;

  return jsonb_build_object(
    'since', v_since,
    'count', jsonb_array_length(v_events),
    'events', v_events
  );
end;
$$;

grant execute on function public.owner_event_feed(text, integer) to authenticated;

-- ── View: v_branch_stack_ranking ───────────────────────────────────────────

create or replace view public.v_branch_stack_ranking as
with branch_metrics as (
  select
    pc.workspace_id,
    pc.branch_code,
    count(*)::int                                      as parts_count,
    coalesce(sum(pc.on_hand * coalesce(pc.cost_price, pc.average_cost, 0)), 0)::numeric(14,2)
                                                       as inventory_value,
    count(*) filter (where coalesce(pc.on_hand, 0) > 0
                     and coalesce(pc.last_12mo_sales, 0) = 0)::int
                                                       as dead_parts,
    count(*) filter (where pc.on_hand is not null
                     and pc.reorder_point is not null
                     and pc.on_hand <= pc.reorder_point)::int
                                                       as at_reorder_count
  from public.parts_catalog pc
  where pc.deleted_at is null
    and pc.branch_code is not null
    and pc.branch_code <> ''
  group by pc.workspace_id, pc.branch_code
)
select
  workspace_id,
  branch_code,
  parts_count,
  inventory_value,
  dead_parts,
  at_reorder_count,
  round((dead_parts::numeric / greatest(1, parts_count) * 100), 1) as dead_pct,
  ntile(4) over (partition by workspace_id order by inventory_value desc) as inventory_quartile,
  ntile(4) over (partition by workspace_id order by dead_parts) as dead_parts_quartile_asc,
  ntile(4) over (partition by workspace_id order by at_reorder_count) as reorder_quartile_asc
from branch_metrics;

comment on view public.v_branch_stack_ranking is
  'Per-branch KPIs with quartile tiers. Feeds OwnerDashboard Tier 5 heatmap.';

grant select on public.v_branch_stack_ranking to authenticated;

-- ============================================================================
-- Migration 273 complete.
-- ============================================================================
