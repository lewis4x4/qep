-- ── Forecast inventory fallback + branches canonical backfill ───────────────
--
-- Migration 369 canonicalized compute_seeded_forecast on branches.slug via
-- parts_inventory, but two follow-on gaps kept the forecast page empty:
--
--   1. parts_inventory holds branch slugs ("main-yard", "lakecity-branch",
--      "gulf-depot", "main") that were never inserted into the branches
--      table. The composite FK on parts_demand_forecasts (and
--      parts_reorder_profiles) rejects every write that references those
--      slugs, so even correct forecasts silently failed to land.
--   2. compute_seeded_forecast's HAVING clause requires demand history in
--      parts_history_monthly. The demo seed ships inventory without history
--      rows, so the RPC computed zero forecasts and operators saw an empty
--      grid — exactly the opposite of the operator utility the forecast
--      page is supposed to deliver.
--
-- This migration:
--
--   A. Backfills the branches table from distinct parts_inventory.branch_id
--      values for the workspace, with curated display names for the three
--      known demo yards and a generic title-case fallback for any other
--      slug. The insert is idempotent (ON CONFLICT DO NOTHING) so we don't
--      clobber existing branch metadata.
--   B. Rewrites compute_seeded_forecast to UNION the history-driven
--      forecast with an inventory-fallback path. Every (workspace, part,
--      branch) with a parts_inventory row gets a forecast row per month.
--      Parts with no history land as predicted_qty=0 but still carry
--      qty_on_hand, reorder_point, and a stockout_risk derived from
--      on-hand — so critically under-stocked parts surface without
--      requiring a history feed that the demo data does not have.

-- ── A · Backfill branches from parts_inventory ─────────────────────────────

insert into public.branches (workspace_id, slug, display_name, is_active, notes)
select
  pi.workspace_id,
  pi.branch_id as slug,
  case pi.branch_id
    when 'main-yard'       then 'Main Yard'
    when 'lakecity-branch' then 'Lake City'
    when 'gulf-depot'      then 'Gulf Depot'
    when 'main'            then 'Main'
    else initcap(replace(regexp_replace(pi.branch_id, '-branch$', ''), '-', ' '))
  end as display_name,
  true as is_active,
  'Backfilled from parts_inventory (migration 370)' as notes
from public.parts_inventory pi
where pi.deleted_at is null
group by pi.workspace_id, pi.branch_id
on conflict (workspace_id, slug) do nothing;

-- ── B · compute_seeded_forecast with inventory fallback ────────────────────

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

  with
    -- ── Step 1 · Roll CDK history to (workspace, part) ────────────────────
    monthly_stats as (
      select
        pc.workspace_id,
        pc.part_number,
        lower(pc.part_number) as part_number_lc,
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
    -- ── Step 2 · Inventory positions per (workspace, part, branch) ────────
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
      select workspace_id, part_number_lc,
             sum(qty_on_hand) as total_on_hand,
             count(*) as branch_count
      from inv
      group by workspace_id, part_number_lc
    ),
    -- ── Step 3 · Base forecasts (workspace-wide predicted quantities) ─────
    base as (
      select
        ms.workspace_id,
        ms.part_number,
        ms.part_number_lc,
        ms.avg_monthly_3mo,
        ms.avg_monthly_12mo,
        ms.std_dev_12mo,
        ms.active_months_12mo,
        ms.last_3mo_sum,
        ms.last_12mo_sum,
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
    -- ── Step 4a · History-driven per-branch, per-month forecasts ──────────
    history_forecasts as (
      select
        b.workspace_id,
        b.part_number,
        i.branch_id,
        i.qty_on_hand,
        (date_trunc('month', current_date) + (gs || ' month')::interval)::date as forecast_month,
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
        coalesce(rp.reorder_point, 0) as reorder_point,
        true as from_history
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
    ),
    -- ── Step 4b · Inventory-fallback forecasts for parts without history ──
    fallback_forecasts as (
      select
        i.workspace_id,
        i.part_number,
        i.branch_id,
        i.qty_on_hand,
        (date_trunc('month', current_date) + (gs || ' month')::interval)::date as forecast_month,
        0::numeric as share,
        0::numeric as predicted_total,
        0::numeric as conf_low_total,
        0::numeric as conf_high_total,
        0::numeric as avg_monthly_3mo,
        0::numeric as avg_monthly_12mo,
        null::numeric as std_dev_12mo,
        0::bigint as active_months_12mo,
        coalesce(rp.reorder_point, 0) as reorder_point,
        false as from_history
      from inv i
      left join public.parts_reorder_profiles rp
        on rp.workspace_id = i.workspace_id
        and rp.branch_id = i.branch_id
        and lower(rp.part_number) = i.part_number_lc
      cross join generate_series(1, p_forecast_months) gs
      where not exists (
        select 1 from base b
        where b.workspace_id = i.workspace_id
          and b.part_number_lc = i.part_number_lc
      )
    ),
    all_forecasts as (
      select * from history_forecasts
      union all
      select * from fallback_forecasts
    ),
    ins as (
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
          when not f.from_history and f.qty_on_hand <= 0 then 'critical'
          when not f.from_history and f.reorder_point > 0 and f.qty_on_hand <= f.reorder_point then 'medium'
          when not f.from_history then 'low'
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
        case
          when f.from_history then
            jsonb_build_object(
              'base_velocity_per_month', f.avg_monthly_12mo,
              'recent_3mo_velocity',     f.avg_monthly_3mo,
              'monthly_std_dev',         coalesce(f.std_dev_12mo, 0),
              'active_months_12mo',      f.active_months_12mo,
              'branch_share',            round(f.share::numeric, 4),
              'blend_weights',           jsonb_build_object('recent', 0.7, 'long', 0.3)
            )
          else
            jsonb_build_object(
              'order_history', 0,
              'note',          'no_demand_history'
            )
        end,
        case when f.from_history then 'v3_seeded_by_inventory_share' else 'v3_inventory_fallback' end,
        batch_id,
        start_ts,
        case
          when f.from_history then jsonb_build_object('cdk_history_months', 24, 'distribution', 'by_inventory_share')
          else jsonb_build_object('source', 'parts_inventory', 'distribution', 'per_branch_zero')
        end,
        f.from_history
      from all_forecasts f
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
        updated_at                  = now()
      returning 1
    )
  select count(*) into forecasts_written from ins;

  return jsonb_build_object(
    'ok',                 true,
    'forecasts_written',  forecasts_written,
    'stale_deleted',      stale_deleted,
    'batch_id',           batch_id,
    'elapsed_ms',         extract(epoch from (now() - start_ts)) * 1000,
    'model_version',      'v3_seeded_by_inventory_share+fallback'
  );
end;
$$;

grant execute on function public.compute_seeded_forecast(text, integer) to authenticated;

comment on function public.compute_seeded_forecast(text, integer) is
  'Seeds parts_demand_forecasts from parts_history_monthly and falls back to parts_inventory for parts without history. Canonicalized on branches.slug.';
