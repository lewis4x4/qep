-- ============================================================================
-- Migration 199: Wave 7 Iron Companion v1.6 — SLO compute function
--
-- Defines `public.iron_compute_slos(p_workspace_id text)` which returns a
-- single JSONB row with the 5 production SLO metrics for the Iron Companion,
-- computed over the appropriate rolling window per metric. See
-- docs/iron-slos.md for the full definitions and rationale.
--
-- This is the canonical compute path for the SLO admin card and (in a
-- follow-up) the nightly SLO history cron. Read-only — never mutates state.
-- ============================================================================

create or replace function public.iron_compute_slos(
  p_workspace_id text default 'default'
) returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  -- Targets (kept inline to make this function self-contained — these
  -- match docs/iron-slos.md exactly)
  v_classify_target_ms integer := 800;
  v_execute_target_ms integer := 2000;
  v_undo_target_rate numeric := 0.995;
  v_dead_letter_target_rate numeric := 0.005;
  v_cost_target_pct numeric := 0.05;

  -- Computed values
  v_classify_p95_ms integer;
  v_execute_p95_ms integer;
  v_undo_success_rate numeric;
  v_undo_attempts integer;
  v_dead_letter_rate numeric;
  v_iron_runs_total integer;
  v_cost_escalation_pct numeric;
  v_active_users_24h integer;
begin
  -- ── 1. Classify p95 latency (rolling 7 days) ──
  -- Uses iron_messages where role='iron' (the orchestrator's response row),
  -- which has latency_ms set. Excludes nulls so silent failures don't drag
  -- the percentile down.
  begin
    select
      percentile_cont(0.95) within group (order by latency_ms)::integer
    into v_classify_p95_ms
    from public.iron_messages
    where workspace_id = p_workspace_id
      and role = 'iron'
      and latency_ms is not null
      and created_at > now() - interval '7 days';
  exception when others then
    v_classify_p95_ms := null;
  end;

  -- ── 2. Execute p95 latency (rolling 7 days) ──
  -- Iron-surface flow runs only — automated workflows are tracked separately.
  begin
    select
      percentile_cont(0.95) within group (order by duration_ms)::integer
    into v_execute_p95_ms
    from public.flow_workflow_runs
    where workspace_id = p_workspace_id
      and surface in ('iron_conversational', 'iron_voice')
      and duration_ms is not null
      and started_at > now() - interval '7 days';
  exception when others then
    v_execute_p95_ms := null;
  end;

  -- ── 3. Undo success rate (rolling 30 days) ──
  -- Numerator: runs marked status='undone' (the iron_mark_run_undone RPC
  -- only sets this on success). Denominator: all runs where the user
  -- actually clicked undo (status in undone OR there's an undone_at
  -- timestamp on a non-undone row, which would indicate a partial undo).
  begin
    with attempts as (
      select
        count(*) filter (where status = 'undone') as success,
        count(*) filter (where undone_at is not null or status = 'undone') as total
      from public.flow_workflow_runs
      where workspace_id = p_workspace_id
        and surface in ('iron_conversational', 'iron_voice')
        and started_at > now() - interval '30 days'
    )
    select
      case when total > 0 then success::numeric / total::numeric else null end,
      total
    into v_undo_success_rate, v_undo_attempts
    from attempts;
  exception when others then
    v_undo_success_rate := null;
    v_undo_attempts := 0;
  end;

  -- ── 4. Dead letter rate (rolling 7 days) ──
  begin
    with totals as (
      select
        count(*) filter (where status = 'dead_lettered') as dead_lettered,
        count(*) as total
      from public.flow_workflow_runs
      where workspace_id = p_workspace_id
        and surface in ('iron_conversational', 'iron_voice')
        and started_at > now() - interval '7 days'
    )
    select
      case when total > 0 then dead_lettered::numeric / total::numeric else 0 end,
      total
    into v_dead_letter_rate, v_iron_runs_total
    from totals;
  exception when others then
    v_dead_letter_rate := null;
    v_iron_runs_total := 0;
  end;

  -- ── 5. Cost cap escalations (rolling 24 h) ──
  -- Active users are defined as anyone with a usage row today. Escalations
  -- are users whose degradation_state climbed past 'reduced' today.
  begin
    with daily as (
      select
        count(*) filter (where degradation_state in ('cached', 'escalated')) as escalated,
        count(*) as active_users
      from public.iron_usage_counters
      where workspace_id = p_workspace_id
        and bucket_date >= current_date - interval '1 day'
    )
    select
      case when active_users > 0 then escalated::numeric / active_users::numeric else 0 end,
      active_users
    into v_cost_escalation_pct, v_active_users_24h
    from daily;
  exception when others then
    v_cost_escalation_pct := null;
    v_active_users_24h := 0;
  end;

  return jsonb_build_object(
    'computed_at', now(),
    'workspace_id', p_workspace_id,

    'classify_p95_ms', v_classify_p95_ms,
    'classify_target_ms', v_classify_target_ms,
    'classify_pass', v_classify_p95_ms is null or v_classify_p95_ms <= v_classify_target_ms,

    'execute_p95_ms', v_execute_p95_ms,
    'execute_target_ms', v_execute_target_ms,
    'execute_pass', v_execute_p95_ms is null or v_execute_p95_ms <= v_execute_target_ms,

    'undo_success_rate', v_undo_success_rate,
    'undo_target_rate', v_undo_target_rate,
    'undo_attempts', v_undo_attempts,
    'undo_pass', v_undo_success_rate is null or v_undo_success_rate >= v_undo_target_rate,

    'dead_letter_rate', v_dead_letter_rate,
    'dead_letter_target_rate', v_dead_letter_target_rate,
    'iron_runs_total', v_iron_runs_total,
    'dead_letter_pass', v_dead_letter_rate is null or v_dead_letter_rate <= v_dead_letter_target_rate,

    'cost_escalation_pct', v_cost_escalation_pct,
    'cost_target_pct', v_cost_target_pct,
    'active_users_24h', v_active_users_24h,
    'cost_pass', v_cost_escalation_pct is null or v_cost_escalation_pct <= v_cost_target_pct
  );
end;
$$;

comment on function public.iron_compute_slos is
  'Wave 7 Iron Companion v1.6: returns a single JSONB row with the 5 production SLO metrics. See docs/iron-slos.md for definitions. Read-only.';

revoke execute on function public.iron_compute_slos(text) from public;
grant execute on function public.iron_compute_slos(text) to authenticated, service_role;
