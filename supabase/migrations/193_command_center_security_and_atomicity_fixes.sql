-- ============================================================================
-- Migration 193: QEP Command Center — P0 + P1 audit fixes
--
-- Fixes shipped in one migration:
--   P0-1  Cross-workspace MV data leakage (mv_exec_*)
--           → security_invoker wrapper views with workspace + role filter
--   P0-2  refresh_exec_materialized_views catches wrong exception class
--           → expand catch to include object_not_in_prerequisite_state
--   P1-1  analytics-snapshot-runner update+insert race
--           → atomic write_kpi_snapshot RPC
--   P1-3  useFallbackKpis fetches whole crm_deals_weighted
--           → analytics_quick_kpi RPC for server-side aggregation
--   P1-4  enqueue_analytics_alert bypassed by evaluator (workspace context)
--           → add p_workspace_id parameter; restore single-source-of-truth
-- ============================================================================

-- ── P0-1. security_invoker wrapper views over every MV ─────────────────────

drop view if exists public.exec_revenue_daily_v cascade;
create view public.exec_revenue_daily_v with (security_invoker = true) as
  select day, closed_deal_count, revenue, margin_dollars, margin_pct
  from public.mv_exec_revenue_daily
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

drop view if exists public.exec_pipeline_stage_summary_v cascade;
create view public.exec_pipeline_stage_summary_v with (security_invoker = true) as
  select stage_id, stage_name, stage_probability, open_deal_count,
         raw_pipeline, weighted_pipeline, avg_age_days, avg_inactivity_days
  from public.mv_exec_pipeline_stage_summary
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

drop view if exists public.exec_margin_daily_v cascade;
create view public.exec_margin_daily_v with (security_invoker = true) as
  select day, margin_dollars, median_margin, negative_margin_deal_count
  from public.mv_exec_margin_daily
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

drop view if exists public.exec_payment_compliance_v cascade;
create view public.exec_payment_compliance_v with (security_invoker = true) as
  select day, total_attempts, passed_attempts, exception_attempts,
         overrides, exception_rate_pct
  from public.mv_exec_payment_compliance
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

drop view if exists public.exec_deposits_aging_v cascade;
create view public.exec_deposits_aging_v with (security_invoker = true) as
  select pending_count, requested_count, received_unverified_count,
         verified_count, refund_in_flight_count, ar_exposure_dollars,
         refund_exposure_dollars, avg_verification_hours
  from public.mv_exec_deposits_aging
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

drop view if exists public.exec_margin_waterfall_v cascade;
create view public.exec_margin_waterfall_v with (security_invoker = true) as
  select month, revenue, gross_margin_dollars, net_contribution_dollars,
         load_dollars, loaded_margin_pct
  from public.mv_exec_margin_waterfall
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

drop view if exists public.exec_traffic_summary_v cascade;
create view public.exec_traffic_summary_v with (security_invoker = true) as
  select day, total_tickets, completed, completed_on_time,
         at_risk_24h, blocked, on_time_rate_pct, avg_cycle_time_hours
  from public.mv_exec_traffic_summary
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

drop view if exists public.exec_inventory_readiness_v cascade;
create view public.exec_inventory_readiness_v with (security_invoker = true) as
  select total_units, ready_units, in_prep_units, blocked_units,
         intake_stalled, ready_rate_pct
  from public.mv_exec_inventory_readiness
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

drop view if exists public.exec_rental_return_summary_v cascade;
create view public.exec_rental_return_summary_v with (security_invoker = true) as
  select open_returns, fresh_returns, aging_returns, refund_pending,
         avg_resolution_hours
  from public.mv_exec_rental_return_summary
  where workspace_id = public.get_my_workspace()
    and public.get_my_role() = 'owner';

-- Lock down direct MV access so the only path is the wrapper views
do $$
declare
  mv text;
begin
  for mv in
    select unnest(array[
      'mv_exec_revenue_daily',
      'mv_exec_pipeline_stage_summary',
      'mv_exec_margin_daily',
      'mv_exec_payment_compliance',
      'mv_exec_deposits_aging',
      'mv_exec_margin_waterfall',
      'mv_exec_traffic_summary',
      'mv_exec_inventory_readiness',
      'mv_exec_rental_return_summary'
    ])
  loop
    execute format('revoke select on public.%I from authenticated', mv);
    execute format('revoke select on public.%I from anon', mv);
  end loop;
end $$;

grant select on public.exec_revenue_daily_v          to authenticated;
grant select on public.exec_pipeline_stage_summary_v to authenticated;
grant select on public.exec_margin_daily_v           to authenticated;
grant select on public.exec_payment_compliance_v     to authenticated;
grant select on public.exec_deposits_aging_v         to authenticated;
grant select on public.exec_margin_waterfall_v       to authenticated;
grant select on public.exec_traffic_summary_v        to authenticated;
grant select on public.exec_inventory_readiness_v    to authenticated;
grant select on public.exec_rental_return_summary_v  to authenticated;

-- ── P0-2. refresh helper: catch first-run "object_not_in_prerequisite_state" ──

create or replace function public.refresh_exec_materialized_views()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin refresh materialized view concurrently public.mv_exec_revenue_daily;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_revenue_daily; end;
  begin refresh materialized view concurrently public.mv_exec_pipeline_stage_summary;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_pipeline_stage_summary; end;
  begin refresh materialized view concurrently public.mv_exec_margin_daily;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_margin_daily; end;
  begin refresh materialized view concurrently public.mv_exec_payment_compliance;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_payment_compliance; end;
  begin refresh materialized view concurrently public.mv_exec_deposits_aging;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_deposits_aging; end;
  begin refresh materialized view concurrently public.mv_exec_margin_waterfall;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_margin_waterfall; end;
  begin refresh materialized view concurrently public.mv_exec_traffic_summary;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_traffic_summary; end;
  begin refresh materialized view concurrently public.mv_exec_inventory_readiness;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_inventory_readiness; end;
  begin refresh materialized view concurrently public.mv_exec_rental_return_summary;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state
    then refresh materialized view public.mv_exec_rental_return_summary; end;
end;
$$;

-- ── P1-1. write_kpi_snapshot — atomic update+insert ────────────────────────

create or replace function public.write_kpi_snapshot(
  p_workspace_id text,
  p_metric_key text,
  p_metric_value numeric,
  p_data_quality_score numeric,
  p_period_start date,
  p_period_end date,
  p_refresh_state text,
  p_metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Atomic: mark prior open snapshots as recalculated, then insert the
  -- new fresh/partial row. The unique partial index can never trip
  -- because both ops are in the same statement block.
  update public.analytics_kpi_snapshots
  set refresh_state = 'recalculated'
  where workspace_id = p_workspace_id
    and metric_key = p_metric_key
    and period_start = p_period_start
    and period_end = p_period_end
    and refresh_state in ('fresh', 'partial');

  insert into public.analytics_kpi_snapshots
    (workspace_id, metric_key, metric_value, data_quality_score,
     period_start, period_end, refresh_state, metadata)
  values
    (p_workspace_id, p_metric_key, p_metric_value, p_data_quality_score,
     p_period_start, p_period_end, p_refresh_state, p_metadata)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.write_kpi_snapshot(text, text, numeric, numeric, date, date, text, jsonb) from public;
grant execute on function public.write_kpi_snapshot(text, text, numeric, numeric, date, date, text, jsonb) to service_role;

-- ── P1-3. analytics_quick_kpi — server-side fallback aggregation ───────────
--
-- Replaces the useFallbackKpis whole-table fetches in apps/web. Returns a
-- numeric value for one of the registered fallback metric_keys. Owner-only
-- via security_invoker on the underlying tables.

create or replace function public.analytics_quick_kpi(p_metric_key text)
returns numeric
language plpgsql
security invoker
stable
as $$
declare
  v_value numeric;
  v_revenue numeric;
  v_margin numeric;
  v_start_of_month date;
begin
  if public.get_my_role() != 'owner' then
    return null;
  end if;

  v_start_of_month := date_trunc('month', now())::date;

  case p_metric_key
    when 'weighted_pipeline' then
      select coalesce(sum(weighted_amount), 0) into v_value
      from public.crm_deals_weighted;

    when 'enterprise_risk_count' then
      select coalesce(sum(open_count), 0)::numeric into v_value
      from public.exec_exception_summary
      where severity in ('critical', 'error');

    when 'revenue_mtd' then
      select coalesce(sum(d.amount), 0) into v_value
      from public.crm_deals d
      join public.crm_deal_stages s on s.id = d.stage_id
      where d.deleted_at is null
        and s.is_closed_won = true
        and d.closed_at >= v_start_of_month;

    when 'gross_margin_dollars_mtd' then
      select coalesce(sum(d.margin_amount), 0) into v_value
      from public.crm_deals d
      join public.crm_deal_stages s on s.id = d.stage_id
      where d.deleted_at is null
        and s.is_closed_won = true
        and d.closed_at >= v_start_of_month;

    when 'gross_margin_pct_mtd' then
      select coalesce(sum(d.amount), 0), coalesce(sum(d.margin_amount), 0)
        into v_revenue, v_margin
      from public.crm_deals d
      join public.crm_deal_stages s on s.id = d.stage_id
      where d.deleted_at is null
        and s.is_closed_won = true
        and d.closed_at >= v_start_of_month;
      v_value := case when v_revenue > 0 then (v_margin / v_revenue) * 100 else 0 end;

    else
      return null;
  end case;

  return v_value;
end;
$$;

revoke execute on function public.analytics_quick_kpi(text) from public;
grant execute on function public.analytics_quick_kpi(text) to authenticated, service_role;

comment on function public.analytics_quick_kpi(text) is
  'QEP Command Center fallback: server-side aggregation for the 5 fallback metric_keys. Replaces the whole-table fetches in useFallbackKpis. Owner-only.';

-- ── P1-4. enqueue_analytics_alert — accept p_workspace_id ──────────────────
--
-- Replaces the mig 188 version. New first parameter so service-role callers
-- (the alert evaluator edge fn) can stamp the correct workspace. When called
-- from a user JWT context with NULL p_workspace_id, falls back to
-- get_my_workspace() for backward compat.

create or replace function public.enqueue_analytics_alert(
  p_workspace_id text,
  p_alert_type text,
  p_metric_key text,
  p_severity text,
  p_title text,
  p_description text default null,
  p_role_target text default 'ceo',
  p_business_impact_value numeric default null,
  p_business_impact_type text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_branch_id text default null,
  p_root_cause_guess text default null,
  p_suggested_action text default null,
  p_source_record_ids jsonb default '[]'::jsonb,
  p_dedupe_key text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_exception_id uuid;
  v_workspace text;
begin
  v_workspace := coalesce(p_workspace_id, public.get_my_workspace());
  if v_workspace is null then
    raise exception 'enqueue_analytics_alert: workspace_id required (caller has no JWT workspace context)';
  end if;

  -- Dedupe: existing open row with the same dedupe_key short-circuits
  if p_dedupe_key is not null then
    select id into v_alert_id
    from public.analytics_alerts
    where workspace_id = v_workspace
      and dedupe_key = p_dedupe_key
      and status in ('new', 'acknowledged', 'in_progress')
    limit 1;
    if v_alert_id is not null then
      update public.analytics_alerts
      set updated_at = now(),
          source_record_ids = case
            when source_record_ids ? p_source_record_ids::text then source_record_ids
            else source_record_ids || p_source_record_ids
          end
      where id = v_alert_id;
      return v_alert_id;
    end if;
  end if;

  -- Dual-write blocker severities into the existing exception_queue
  if p_severity in ('error', 'critical') then
    insert into public.exception_queue
      (source, severity, title, detail, payload, workspace_id)
    values
      ('analytics_alert',
       p_severity,
       p_title,
       p_description,
       jsonb_build_object(
         'metric_key', p_metric_key,
         'role_target', p_role_target,
         'business_impact_value', p_business_impact_value,
         'business_impact_type', p_business_impact_type,
         'source_record_ids', p_source_record_ids,
         'dedupe_key', p_dedupe_key
       ),
       v_workspace)
    returning id into v_exception_id;
  end if;

  insert into public.analytics_alerts
    (workspace_id, alert_type, metric_key, severity, title, description,
     role_target, business_impact_value, business_impact_type,
     entity_type, entity_id, branch_id, root_cause_guess, suggested_action,
     source_record_ids, dedupe_key, exception_queue_id, metadata)
  values
    (v_workspace, p_alert_type, p_metric_key, p_severity, p_title, p_description,
     p_role_target, p_business_impact_value, p_business_impact_type,
     p_entity_type, p_entity_id, p_branch_id, p_root_cause_guess, p_suggested_action,
     p_source_record_ids, p_dedupe_key, v_exception_id, p_metadata)
  returning id into v_alert_id;

  return v_alert_id;
end;
$$;

revoke execute on function public.enqueue_analytics_alert(
  text, text, text, text, text, text, text, numeric, text, text, uuid, text, text, text, jsonb, text, jsonb
) from public;
grant execute on function public.enqueue_analytics_alert(
  text, text, text, text, text, text, text, numeric, text, text, uuid, text, text, text, jsonb, text, jsonb
) to service_role;

-- The unqualified comment can't resolve because a prior migration created
-- an earlier signature of enqueue_analytics_alert and overloads now coexist.
-- Comment the specific 17-arg signature directly.
comment on function public.enqueue_analytics_alert(
  text, text, text, text, text, text, text, numeric, text, text, uuid, text, text, text, jsonb, text, jsonb
) is
  'QEP Command Center alert evaluator entry point (mig 193). Accepts explicit p_workspace_id for service-role callers. Dedupes on dedupe_key, dual-writes blockers into exception_queue, returns analytics_alerts.id.';
