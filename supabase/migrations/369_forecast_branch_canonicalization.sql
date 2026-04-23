-- ── parts_demand_forecasts — branch identifier canonicalization ─────────────
--
-- The seeded forecast RPC (compute_seeded_forecast) previously wrote forecasts
-- keyed on parts_catalog.branch_code (CDK codes like "01", "02"). The rest of
-- the system (parts_inventory, parts_reorder_profiles, parts_forecast_risk_summary)
-- keys on branches.slug (values like "gulf-depot", "main"), which is enforced
-- by the composite FK on parts_inventory(workspace_id, branch_id) →
-- branches(workspace_id, slug).
--
-- Consequences of the mismatch:
--   • parts_forecast_risk_summary LEFT JOIN to live inventory always returned NULL
--     → every seeded row showed On Hand = 0 → every seeded row rolled up as
--       stockout_risk = 'critical'.
--   • Forecast rows for the same (workspace, part) existed under both identifier
--     schemes, doubling the row count the UI rendered.
--
-- Fix:
--   1. compute_seeded_forecast now aggregates history at (workspace, part) grain
--      (dropping catalog branch_code from the grouping) and distributes the
--      resulting forecast across actual inventory branches by qty_on_hand share.
--   2. Parts with no parts_inventory footprint are skipped — we can't attribute
--      demand to a branch that doesn't stock the part.
--   3. Stale rows under the old identifier scheme (any branch_id that does not
--      exist in branches.slug for that workspace) are deleted at the start of
--      the run so the UI doesn't render ghost forecasts.

create or replace function public.compute_seeded_forecast(
  p_workspace text default null,
  p_forecast_months integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws                  text;
  forecasts_written   integer := 0;
  stale_deleted       integer := 0;
  batch_id            text;
  start_ts            timestamptz := now();
begin
  ws := coalesce(p_workspace, public.get_my_workspace());
  if public.get_my_role() not in ('admin', 'manager', 'owner') and current_user <> 'service_role' then
    raise exception 'insufficient role';
  end if;

  batch_id := 'seeded-' || to_char(now(), 'YYYYMMDD-HH24MISS');

  -- ── Step 0 · Purge rows pinned to non-canonical branch identifiers ──────
  -- parts_inventory.branch_id (the canonical identifier, == branches.slug)
  -- is the set we should match. Any forecast row whose branch_id is not in
  -- that set for the same workspace is a ghost from the legacy branch_code
  -- path and must be removed before we rewrite.
  with
    valid as (
      select distinct workspace_id, branch_id
      from public.parts_inventory
      where (ws is null or workspace_id = ws)
        and deleted_at is null
    ),
    dead as (
      delete from public.parts_demand_forecasts pdf
      using (
        select pdf2.workspace_id, pdf2.branch_id
        from public.parts_demand_forecasts pdf2
        left join valid v
          on v.workspace_id = pdf2.workspace_id
          and v.branch_id = pdf2.branch_id
        where (ws is null or pdf2.workspace_id = ws)
          and v.branch_id is null
      ) d
      where pdf.workspace_id = d.workspace_id
        and pdf.branch_id = d.branch_id
      returning 1
    )
  select count(*) into stale_deleted from dead;

  -- ── Step 1 · Roll monthly CDK history up to (workspace, part) ───────────
  -- Dropping branch_code from the group so we get one signal per part even
  -- when the catalog has multiple branch_code variants for the same part.
  with monthly_stats as (
    select
      pc.workspace_id,
      pc.part_number,
      coalesce(sum(h.sales_qty) filter (where h.month_offset between 1 and 12), 0)
                                              as last_12mo_sum,
      coalesce(sum(h.sales_qty) filter (where h.month_offset between 1 and 3), 0)
                                              as last_3mo_sum,
      coalesce(avg(h.sales_qty) filter (where h.month_offset between 1 and 12), 0)
                                              as avg_monthly_12mo,
      coalesce(avg(h.sales_qty) filter (where h.month_offset between 1 and 3), 0)
                                              as avg_monthly_3mo,
      stddev_samp(h.sales_qty) filter (where h.month_offset between 1 and 12)
                                              as std_dev_12mo,
      count(h.*) filter (where h.month_offset between 1 and 12 and h.sales_qty > 0)
                                              as active_months_12mo
    from public.parts_catalog pc
    left join public.parts_history_monthly h on h.part_id = pc.id
    where pc.deleted_at is null
      and (ws is null or pc.workspace_id = ws)
    group by pc.workspace_id, pc.part_number
    having coalesce(avg(h.sales_qty) filter (where h.month_offset between 1 and 12), 0) > 0
        or coalesce(sum(h.sales_qty) filter (where h.month_offset between 1 and 3), 0) > 0
  ),
  -- ── Step 2 · Inventory positions per (workspace, part, branch) ──────────
  inv as (
    select
      pi.workspace_id,
      lower(pi.part_number) as part_number_lc,
      pi.part_number,
      pi.branch_id,
      sum(pi.qty_on_hand)::int as qty_on_hand
    from public.parts_inventory pi
    where pi.deleted_at is null
      and (ws is null or pi.workspace_id = ws)
    group by pi.workspace_id, pi.part_number, pi.branch_id
  ),
  inv_totals as (
    select workspace_id, part_number_lc, sum(qty_on_hand) as total_on_hand, count(*) as branch_count
    from inv
    group by workspace_id, part_number_lc
  ),
  -- ── Step 3 · Expand to per-branch, per-month forecasts ─────────────────
  base as (
    select
      ms.workspace_id,
      ms.part_number,
      lower(ms.part_number) as part_number_lc,
      ms.avg_monthly_3mo,
      ms.avg_monthly_12mo,
      ms.std_dev_12mo,
      ms.active_months_12mo,
      ms.last_3mo_sum,
      ms.last_12mo_sum,
      -- predicted_qty for the part as a whole (workspace-wide)
      greatest(0, round(((ms.avg_monthly_3mo * 0.7) + (ms.avg_monthly_12mo * 0.3))::numeric, 2))
                                              as predicted_total,
      greatest(0, round((((ms.avg_monthly_3mo * 0.7) + (ms.avg_monthly_12mo * 0.3))
                         - coalesce(ms.std_dev_12mo, 0))::numeric, 2))
                                              as conf_low_total,
      round((((ms.avg_monthly_3mo * 0.7) + (ms.avg_monthly_12mo * 0.3))
              + coalesce(ms.std_dev_12mo, 0))::numeric, 2)
                                              as conf_high_total
    from monthly_stats ms
  ),
  forecasts as (
    select
      b.workspace_id,
      b.part_number,
      i.branch_id,
      i.qty_on_hand,
      (date_trunc('month', current_date) + (gs || ' month')::interval)::date as forecast_month,
      -- share of predicted demand proportional to live stock share;
      -- if everyone's at zero, split evenly across branches that carry it
      case
        when it.total_on_hand > 0 then i.qty_on_hand::numeric / it.total_on_hand
        when it.branch_count > 0 then 1.0 / it.branch_count
        else 0
      end as share,
      b.predicted_total,
      b.conf_low_total,
      b.conf_high_total,
      b.avg_monthly_3mo,
      b.avg_monthly_12mo,
      b.std_dev_12mo,
      b.active_months_12mo,
      coalesce(rp.reorder_point, 0) as reorder_point
    from base b
    join inv i
      on i.workspace_id = b.workspace_id
      and i.part_number_lc = b.part_number_lc
    join inv_totals it
      on it.workspace_id = b.workspace_id
      and it.part_number_lc = b.part_number_lc
    left join public.parts_reorder_profiles rp
      on rp.workspace_id = b.workspace_id
      and rp.branch_id = i.branch_id
      and lower(rp.part_number) = b.part_number_lc
    cross join generate_series(1, p_forecast_months) gs
  )
  insert into public.parts_demand_forecasts (
    workspace_id, part_number, branch_id, forecast_month,
    predicted_qty, confidence_low, confidence_high,
    qty_on_hand_at_forecast, reorder_point_at_forecast,
    stockout_risk, drivers, model_version, computation_batch_id, computed_at,
    input_sources, seeded_from_history
  )
  select
    f.workspace_id,
    f.part_number,
    f.branch_id,
    f.forecast_month,
    round((f.predicted_total * f.share)::numeric, 2)   as predicted_qty,
    round((f.conf_low_total * f.share)::numeric, 2)    as confidence_low,
    round((f.conf_high_total * f.share)::numeric, 2)   as confidence_high,
    f.qty_on_hand,
    nullif(f.reorder_point, 0),
    case
      when (f.predicted_total * f.share) <= 0 and f.qty_on_hand > 0 then 'low'
      when f.qty_on_hand <= 0 and (f.predicted_total * f.share) > 0 then 'critical'
      when (f.predicted_total * f.share) > 0
           and f.qty_on_hand::numeric / (f.predicted_total * f.share) < 0.5 then 'critical'
      when (f.predicted_total * f.share) > 0
           and f.qty_on_hand::numeric / (f.predicted_total * f.share) < 1.0 then 'high'
      when f.reorder_point > 0 and f.qty_on_hand <= f.reorder_point then 'medium'
      when (f.predicted_total * f.share) > 0
           and f.qty_on_hand::numeric / (f.predicted_total * f.share) < 1.5 then 'medium'
      else 'low'
    end,
    jsonb_build_object(
      'base_velocity_per_month', f.avg_monthly_12mo,
      'recent_3mo_velocity',     f.avg_monthly_3mo,
      'monthly_std_dev',         coalesce(f.std_dev_12mo, 0),
      'active_months_12mo',      f.active_months_12mo,
      'branch_share',            round(f.share::numeric, 4),
      'blend_weights',           jsonb_build_object('recent', 0.7, 'long', 0.3)
    ),
    'v3_seeded_by_inventory_share',
    batch_id,
    start_ts,
    jsonb_build_object('cdk_history_months', 24, 'distribution', 'by_inventory_share'),
    true
  from forecasts f
  on conflict (workspace_id, part_number, branch_id, forecast_month) do update
  set
    predicted_qty               = excluded.predicted_qty,
    confidence_low              = excluded.confidence_low,
    confidence_high             = excluded.confidence_high,
    qty_on_hand_at_forecast     = excluded.qty_on_hand_at_forecast,
    reorder_point_at_forecast   = excluded.reorder_point_at_forecast,
    stockout_risk               = excluded.stockout_risk,
    drivers                     = excluded.drivers,
    model_version               = excluded.model_version,
    computation_batch_id        = excluded.computation_batch_id,
    computed_at                 = excluded.computed_at,
    input_sources               = excluded.input_sources,
    seeded_from_history         = excluded.seeded_from_history,
    updated_at                  = now();

  get diagnostics forecasts_written = row_count;

  return jsonb_build_object(
    'ok',                 true,
    'forecasts_written',  forecasts_written,
    'stale_deleted',      stale_deleted,
    'batch_id',           batch_id,
    'elapsed_ms',         extract(epoch from (now() - start_ts)) * 1000,
    'model_version',      'v3_seeded_by_inventory_share'
  );
end;
$$;

grant execute on function public.compute_seeded_forecast(text, integer) to authenticated;

comment on function public.compute_seeded_forecast(text, integer) is
  'Seeds parts_demand_forecasts from parts_history_monthly, canonicalized on branches.slug via parts_inventory — replaces the legacy branch_code-keyed writer.';
