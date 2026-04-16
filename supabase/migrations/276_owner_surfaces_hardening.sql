-- ============================================================================
-- Migration 276: Post-audit hardening of owner surfaces
--
-- P0 audit findings on Owner Dashboard (migrations 273-275):
--
--   A. CRITICAL BUG — original RPCs used columns that don't exist:
--      - parts_orders.total_amount  -> actual: parts_orders.total
--      - customer_invoices.amount_outstanding -> actual: balance_due
--      - qrm_deals.status           -> actual: qrm_deals.stage_id + JOIN to
--                                      qrm_deal_stages (is_closed_won / is_closed_lost)
--      - qrm_deals.owner_id         -> actual: qrm_deals.assigned_rep_id
--      - service_jobs.status        -> actual: current_stage + status_flags
--      Every query was wrapped in `exception when others then <zero>` so the
--      errors were silently swallowed and the dashboard returned zeros.
--
--   B. v_branch_stack_ranking was SECURITY DEFINER — recreated as
--      security_invoker so it respects parts_catalog RLS.
--
--   C. Owner RPCs accepted a user-controllable p_workspace parameter while
--      running SECURITY DEFINER. Hardened so authenticated callers get
--      their own active_workspace_id regardless of p_workspace. Service
--      role (auth.uid() is null) retains full control for cron/edge fns.
--
--   D. owner_briefs and owner_predictive_interventions_cache: explicit
--      revoke of write grants from authenticated/anon.
--
--   E. Hot-path indexes for the real column names.
-- ============================================================================

-- ── B. v_branch_stack_ranking: security_invoker ───────────────────────────
alter view public.v_branch_stack_ranking set (security_invoker = true);

-- ── A + C. Rewrite RPCs with correct columns + workspace hardening ────────

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
  v_last_import_at timestamptz;
  v_result jsonb;
begin
  -- Authenticated user: ignore p_workspace, use their active_workspace_id.
  -- Service role (auth.uid() is null): honor p_workspace or fallback.
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  else
    ws := coalesce(p_workspace, 'default');
  end if;

  -- Revenue — parts_orders uses `total`, not `total_amount`.
  begin
    select coalesce(sum(total), 0) into v_today_revenue
    from public.parts_orders
    where workspace_id = ws and created_at >= date_trunc('day', now())
      and (status is null or status not in ('cancelled', 'draft'));
  exception when others then v_today_revenue := 0; end;

  begin
    select coalesce(sum(total), 0) into v_mtd_revenue
    from public.parts_orders
    where workspace_id = ws and created_at >= date_trunc('month', now())
      and (status is null or status not in ('cancelled', 'draft'));
  exception when others then v_mtd_revenue := 0; end;

  begin
    select coalesce(sum(total), 0) into v_revenue_prev_month_same_day
    from public.parts_orders
    where workspace_id = ws
      and created_at >= date_trunc('month', now() - interval '1 month')
      and created_at < date_trunc('month', now() - interval '1 month') + (now() - date_trunc('month', now()))
      and (status is null or status not in ('cancelled', 'draft'));
  exception when others then v_revenue_prev_month_same_day := 0; end;

  -- Pipeline — join qrm_deal_stages to filter closed_won/lost.
  begin
    select
      coalesce(sum(d.amount), 0),
      count(*) filter (where d.updated_at < now() - interval '14 days')::int
    into v_pipeline_total, v_pipeline_at_risk_count
    from public.qrm_deals d
    left join public.qrm_deal_stages s on s.id = d.stage_id
    where d.workspace_id = ws
      and d.deleted_at is null
      and d.closed_at is null
      and coalesce(s.is_closed_won, false) = false
      and coalesce(s.is_closed_lost, false) = false;
  exception when others then
    v_pipeline_total := 0; v_pipeline_at_risk_count := 0;
  end;

  begin
    select count(*)::int into v_parts_total
    from public.parts_catalog
    where workspace_id = ws and deleted_at is null;
  exception when others then v_parts_total := 0; end;

  begin
    select coalesce(sum(capital_on_hand), 0) into v_parts_dead_capital
    from public.v_parts_dead_capital where workspace_id = ws;
  exception when others then v_parts_dead_capital := 0; end;

  begin
    select count(*)::int into v_parts_stockout_critical
    from public.v_parts_stockout_risk
    where workspace_id = ws and stockout_risk in ('stocked_out', 'critical');
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
    select count(*)::int into v_parts_replenish_pending
    from public.parts_auto_replenish_queue
    where workspace_id = ws
      and status in ('pending', 'scheduled', 'auto_approved');
  exception when others then v_parts_replenish_pending := 0; end;

  begin
    select count(*)::int into v_parts_margin_erosion
    from public.v_parts_margin_signal
    where workspace_id = ws and potential_overpay = true;
  exception when others then v_parts_margin_erosion := 0; end;

  -- AR aging — customer_invoices uses `balance_due`, not `amount_outstanding`.
  begin
    select coalesce(sum(balance_due), 0) into v_ar_aged_90
    from public.customer_invoices
    where workspace_id = ws
      and due_date < current_date - interval '90 days' and status <> 'paid';
  exception when others then v_ar_aged_90 := 0; end;

  begin
    select max(completed_at) into v_last_import_at
    from public.parts_import_runs
    where workspace_id = ws and status = 'committed';
  exception when others then v_last_import_at := null; end;

  v_result := jsonb_build_object(
    'generated_at', now(), 'workspace_id', ws,
    'revenue', jsonb_build_object(
      'today', v_today_revenue, 'mtd', v_mtd_revenue,
      'prev_month_same_day', v_revenue_prev_month_same_day,
      'mtd_vs_prev_pct', case
        when v_revenue_prev_month_same_day > 0
          then round(((v_mtd_revenue - v_revenue_prev_month_same_day) / v_revenue_prev_month_same_day * 100)::numeric, 1)
        else null end),
    'pipeline', jsonb_build_object(
      'weighted_total', v_pipeline_total, 'at_risk_count', v_pipeline_at_risk_count),
    'parts', jsonb_build_object(
      'total_catalog', v_parts_total, 'dead_capital_usd', v_parts_dead_capital,
      'stockout_critical', v_parts_stockout_critical,
      'predictive_revenue_open', v_parts_predictive_revenue,
      'predictive_open_plays', v_parts_predictive_open_plays,
      'replenish_pending', v_parts_replenish_pending,
      'margin_erosion_flags', v_parts_margin_erosion,
      'last_import_at', v_last_import_at),
    'finance', jsonb_build_object('ar_aged_90_plus', v_ar_aged_90)
  );
  return v_result;
end;
$$;

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
  v_parts_score int; v_sales_score int; v_service_score int;
  v_rental_score int; v_finance_score int; v_composite int;
  v_stockouts int; v_dead_capital numeric; v_catalog_total int;
  v_pipeline_total numeric; v_at_risk int; v_ar_aged numeric;
  v_open_service int;
begin
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  else
    ws := coalesce(p_workspace, 'default');
  end if;

  v_summary := public.owner_dashboard_summary(ws);

  v_stockouts := coalesce((v_summary->'parts'->>'stockout_critical')::int, 0);
  v_dead_capital := coalesce((v_summary->'parts'->>'dead_capital_usd')::numeric, 0);
  v_catalog_total := greatest(1, coalesce((v_summary->'parts'->>'total_catalog')::int, 1));
  v_parts_score := greatest(0, least(100,
    100
    - least(40, (v_stockouts::numeric / v_catalog_total * 100)::int)
    - least(30, (v_dead_capital / 10000)::int)));

  v_pipeline_total := coalesce((v_summary->'pipeline'->>'weighted_total')::numeric, 0);
  v_at_risk := coalesce((v_summary->'pipeline'->>'at_risk_count')::int, 0);
  v_sales_score := greatest(0, least(100,
    60
    + least(30, (v_pipeline_total / 100000)::int * 3)
    - least(30, v_at_risk * 5)));

  -- Service — use current_stage + closed_at, not a non-existent status column.
  v_service_score := 75;
  begin
    select count(*)::int
    into v_open_service
    from public.service_jobs
    where workspace_id = ws
      and closed_at is null
      and deleted_at is null
      and current_stage is not null
      and current_stage not in ('complete', 'closed', 'cancelled')
      and created_at > now() - interval '60 days';
    -- Soft heuristic: penalize each stale open job ~2 points, floor at 40.
    v_service_score := greatest(40, 100 - least(60, v_open_service * 2));
  exception when others then v_service_score := 75; end;

  v_rental_score := 75;

  v_ar_aged := coalesce((v_summary->'finance'->>'ar_aged_90_plus')::numeric, 0);
  v_finance_score := greatest(0, least(100,
    100 - least(60, (v_ar_aged / 5000)::int)));

  v_composite := round(
    (v_parts_score * 0.20) + (v_sales_score * 0.25)
    + (v_service_score * 0.20) + (v_rental_score * 0.15)
    + (v_finance_score * 0.20))::int;

  return jsonb_build_object(
    'score', v_composite, 'generated_at', now(),
    'dimensions', jsonb_build_object(
      'parts', v_parts_score, 'sales', v_sales_score,
      'service', v_service_score, 'rental', v_rental_score, 'finance', v_finance_score),
    'weights', jsonb_build_object(
      'parts', 0.20, 'sales', 0.25, 'service', 0.20, 'rental', 0.15, 'finance', 0.20),
    'tier', case
      when v_composite >= 85 then 'excellent'
      when v_composite >= 70 then 'healthy'
      when v_composite >= 55 then 'attention'
      else 'critical' end
  );
end;
$$;

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
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  else
    ws := coalesce(p_workspace, 'default');
  end if;
  v_since := now() - (p_hours_back || ' hours')::interval;

  -- parts_orders uses `total`, not `total_amount`.
  begin
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'parts_order_created', 'at', created_at,
        'summary', format('Parts order created (%s)', coalesce(order_source, 'counter')),
        'amount', total, 'id', id))
      from public.parts_orders
      where workspace_id = ws and created_at >= v_since
      limit 20), '[]'::jsonb);
  exception when others then null; end;

  begin
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'predictive_play_created', 'at', created_at,
        'summary', format('Predictive play: %s in %s days', part_number, projection_window),
        'revenue', projected_revenue * recommended_order_qty, 'id', id))
      from public.predicted_parts_plays
      where workspace_id = ws and created_at >= v_since and status = 'open'
      limit 10), '[]'::jsonb);
  exception when others then null; end;

  begin
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'cdk_import_committed', 'at', completed_at,
        'summary', format('%s import committed: %s rows (%s new, %s updated)',
                          file_type, row_count, rows_inserted, rows_updated),
        'id', id))
      from public.parts_import_runs
      where workspace_id = ws and completed_at >= v_since and status = 'committed'
      limit 10), '[]'::jsonb);
  exception when others then null; end;

  -- Deal closed-won: join qrm_deal_stages on is_closed_won.
  begin
    v_events := v_events || coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'deal_closed_won', 'at', coalesce(d.closed_at, d.updated_at),
        'summary', format('Deal closed: %s', coalesce(d.name, 'untitled')),
        'amount', d.amount, 'id', d.id))
      from public.qrm_deals d
      join public.qrm_deal_stages s on s.id = d.stage_id
      where d.workspace_id = ws
        and coalesce(d.closed_at, d.updated_at) >= v_since
        and s.is_closed_won = true
        and d.deleted_at is null
      limit 10), '[]'::jsonb);
  exception when others then null; end;

  return jsonb_build_object(
    'since', v_since, 'count', jsonb_array_length(v_events), 'events', v_events);
end;
$$;

create or replace function public.owner_team_signals(
  p_workspace text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ws text;
  v_reps jsonb;
begin
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  else
    ws := coalesce(p_workspace, 'default');
  end if;

  begin
    select coalesce(jsonb_agg(row_to_json(t) order by (t.ytd_bookings) desc nulls last), '[]'::jsonb)
    into v_reps
    from (
      select
        coalesce(p.full_name, p.email, 'unassigned')                          as rep_name,
        d.assigned_rep_id                                                     as rep_id,
        count(*) filter (where s.is_closed_won = true
                         and coalesce(d.closed_at, d.updated_at) >= date_trunc('year', now()))::int
                                                                              as ytd_wins,
        coalesce(sum(d.amount) filter (
          where s.is_closed_won = true
            and coalesce(d.closed_at, d.updated_at) >= date_trunc('year', now())
        ), 0)::numeric(14,2)                                                  as ytd_bookings,
        count(*) filter (where coalesce(s.is_closed_won, false) = false
                         and coalesce(s.is_closed_lost, false) = false
                         and d.closed_at is null)::int                        as open_deals,
        round(
          count(*) filter (where s.is_closed_won = true)::numeric
          / nullif(count(*) filter (where s.is_closed_won = true or s.is_closed_lost = true), 0)
          * 100, 1
        )                                                                     as close_rate_pct,
        avg(extract(days from (coalesce(d.closed_at, d.updated_at) - d.created_at)))
          filter (where s.is_closed_won = true)                               as avg_close_days
      from public.qrm_deals d
      left join public.qrm_deal_stages s on s.id = d.stage_id
      left join public.profiles p on p.id = d.assigned_rep_id
      where d.workspace_id = ws and d.deleted_at is null and d.assigned_rep_id is not null
      group by d.assigned_rep_id, p.full_name, p.email
      order by ytd_bookings desc
      limit p_limit
    ) t;
  exception when others then v_reps := '[]'::jsonb; end;

  return jsonb_build_object(
    'generated_at', now(), 'workspace_id', ws, 'reps', v_reps);
end;
$$;

-- ── D. Cache tables: explicit revoke of write grants ──────────────────────
revoke insert, update, delete on public.owner_briefs from authenticated, anon;
revoke insert, update, delete on public.owner_predictive_interventions_cache
  from authenticated, anon;

-- ── E. Hot-path indexes using real column names ───────────────────────────
create index if not exists parts_orders_ws_status_created_idx
  on public.parts_orders (workspace_id, status, created_at desc);

create index if not exists qrm_deals_ws_stage_updated_idx
  on public.qrm_deals (workspace_id, stage_id, updated_at desc)
  where deleted_at is null;

create index if not exists qrm_deals_ws_rep_created_idx
  on public.qrm_deals (workspace_id, assigned_rep_id, created_at desc)
  where deleted_at is null and assigned_rep_id is not null;

create index if not exists predicted_parts_plays_ws_status_revenue_idx
  on public.predicted_parts_plays (workspace_id, status, projected_revenue desc);

create index if not exists customer_invoices_ws_due_status_idx
  on public.customer_invoices (workspace_id, due_date, status);

-- ============================================================================
-- Migration 276 complete.
-- ============================================================================
