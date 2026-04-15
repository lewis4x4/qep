-- ============================================================================
-- Migration 263: Predictive Parts Plays — dedup fix
--
-- Bug in 262: predict_parts_needs() generated duplicate rows per
-- (workspace, customer, fleet, part, projection_window) when a maintenance
-- schedule had multiple intervals listing the same part (e.g. a filter
-- appearing at both 250-hr and 500-hr services), OR when the same part
-- emerged from both `interval_parts` and `common_wear` signals.
--
-- The INSERT ... ON CONFLICT DO UPDATE then tried to update the same row
-- twice in a single statement → SQLSTATE 21000.
--
-- Fix: add a `deduped` CTE that collapses duplicates with DISTINCT ON
-- ordered by projected_due_date asc, probability desc — keeps the most
-- urgent/highest-confidence signal per (fleet, part, window).
-- ============================================================================

create or replace function public.predict_parts_needs(
  p_workspace     text default null,
  p_lookahead_days integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws          text;
  batch_id    text;
  started     timestamptz := now();
  plays_written integer := 0;
  machines_scanned integer := 0;
begin
  ws := coalesce(p_workspace, public.get_my_workspace());
  if public.get_my_role() not in ('admin', 'manager', 'owner') and current_user <> 'service_role' then
    raise exception 'insufficient role';
  end if;

  batch_id := 'predict-' || to_char(now(), 'YYYYMMDD-HH24MISS');

  with fleet_ctx as (
    select
      cf.id                    as fleet_id,
      cf.workspace_id,
      cf.portal_customer_id,
      cf.make,
      cf.model,
      cf.current_hours,
      cf.service_interval_hours,
      cf.last_service_date,
      cf.next_service_due,
      mp.id                    as machine_profile_id,
      mp.maintenance_schedule,
      mp.common_wear_parts
    from public.customer_fleet cf
    left join public.machine_profiles mp
      on mp.workspace_id = cf.workspace_id
      and mp.deleted_at is null
      and (upper(mp.model) = upper(cf.model) or upper(mp.model_family) = upper(cf.model))
      and (mp.manufacturer is null or upper(mp.manufacturer) = upper(cf.make))
    where cf.workspace_id = ws
      and cf.is_active = true
      and cf.current_hours is not null
  ),
  interval_projections as (
    select
      fc.fleet_id, fc.workspace_id, fc.portal_customer_id, fc.machine_profile_id,
      fc.current_hours,
      (sched->>'interval_hours')::numeric    as interval_hours,
      sched->'parts'                          as parts_arr,
      fc.current_hours % (sched->>'interval_hours')::numeric    as hours_into_interval,
      (sched->>'interval_hours')::numeric
        - (fc.current_hours % (sched->>'interval_hours')::numeric)  as hours_until_next
    from fleet_ctx fc
    cross join jsonb_array_elements(coalesce(fc.maintenance_schedule, '[]'::jsonb)) sched
    where (sched->>'interval_hours')::numeric > 0
  ),
  interval_parts as (
    select
      ip.fleet_id, ip.workspace_id, ip.portal_customer_id, ip.machine_profile_id,
      ip.interval_hours, ip.hours_until_next,
      (current_date + ceil(ip.hours_until_next / 6.0)::int)  as projected_due_date,
      part_number_raw::text as part_number_text
    from interval_projections ip
    cross join jsonb_array_elements_text(coalesce(ip.parts_arr, '[]'::jsonb)) as part_number_raw
    where ip.hours_until_next / 6.0 <= p_lookahead_days
  ),
  common_wear as (
    select
      fc.fleet_id, fc.workspace_id, fc.portal_customer_id, fc.machine_profile_id,
      fc.current_hours,
      (part_obj->>'part_number')::text       as part_number_text,
      (part_obj->>'avg_replace_hours')::numeric as avg_replace_hours,
      ((part_obj->>'avg_replace_hours')::numeric
        - (fc.current_hours % nullif((part_obj->>'avg_replace_hours')::numeric, 0))) as hours_until_wear
    from fleet_ctx fc
    cross join lateral (
      select value from jsonb_each(coalesce(fc.common_wear_parts, '{}'::jsonb))
    ) cats(value)
    cross join lateral jsonb_array_elements(coalesce(cats.value, '[]'::jsonb)) part_obj
    where (part_obj->>'avg_replace_hours') is not null
      and (part_obj->>'avg_replace_hours')::numeric > 0
      and ((part_obj->>'avg_replace_hours')::numeric
        - (fc.current_hours % (part_obj->>'avg_replace_hours')::numeric)) / 6.0 <= p_lookahead_days
  ),
  all_signals as (
    select
      ip.fleet_id, ip.workspace_id, ip.portal_customer_id, ip.machine_profile_id,
      ip.part_number_text,
      ip.projected_due_date,
      'hours_based_interval'::text                                  as signal_type,
      format('%s-hr interval due in ~%s hrs (est %s)',
             ip.interval_hours::int,
             ip.hours_until_next::int,
             ip.projected_due_date::text)                           as reason,
      0.85::numeric                                                 as probability
    from interval_parts ip
    union all
    select
      cw.fleet_id, cw.workspace_id, cw.portal_customer_id, cw.machine_profile_id,
      cw.part_number_text,
      (current_date + ceil(cw.hours_until_wear / 6.0)::int),
      'common_wear_pattern'::text,
      format('Wear interval %s hrs — ~%s hrs until replacement',
             cw.avg_replace_hours::int,
             cw.hours_until_wear::int),
      0.65::numeric
    from common_wear cw
  ),
  with_parts as (
    select
      s.fleet_id,
      s.workspace_id,
      s.portal_customer_id,
      s.machine_profile_id,
      s.part_number_text,
      s.projected_due_date,
      s.signal_type,
      s.reason,
      s.probability,
      pc.id          as part_id,
      pc.description as part_description,
      pc.on_hand,
      pc.list_price,
      pc.cost_price,
      pc.vendor_code,
      vp.id          as vendor_id,
      public.next_vendor_order_date(vp.id, '', current_date) as suggested_order_by,
      case
        when s.projected_due_date - current_date <= 7  then '7d'
        when s.projected_due_date - current_date <= 14 then '14d'
        when s.projected_due_date - current_date <= 30 then '30d'
        when s.projected_due_date - current_date <= 60 then '60d'
        else '90d'
      end                                 as projection_window
    from all_signals s
    join public.parts_catalog pc
      on pc.workspace_id = s.workspace_id
      and upper(pc.part_number) = upper(s.part_number_text)
      and pc.deleted_at is null
    left join public.vendor_profiles vp
      on vp.workspace_id = s.workspace_id
      and (upper(vp.name) = upper(pc.vendor_code) or upper(split_part(vp.name, ' ', 1)) = upper(pc.vendor_code))
  ),
  deduped as (
    -- Collapse duplicates: pick the earliest-due, highest-confidence signal
    -- per (fleet, part, window). This prevents ON CONFLICT DO UPDATE from
    -- hitting the same row twice in a single INSERT.
    select distinct on (workspace_id, portal_customer_id, fleet_id, part_id, projection_window)
      *
    from with_parts
    order by
      workspace_id, portal_customer_id, fleet_id, part_id, projection_window,
      projected_due_date asc,
      probability desc
  )
  insert into public.predicted_parts_plays (
    workspace_id, portal_customer_id, fleet_id, machine_profile_id,
    part_id, part_number, part_description,
    projection_window, projected_due_date, probability, reason, signal_type,
    current_on_hand, recommended_order_qty, projected_revenue,
    suggested_vendor_id, suggested_order_by,
    computation_batch_id, input_signals
  )
  select
    wp.workspace_id,
    wp.portal_customer_id,
    wp.fleet_id,
    wp.machine_profile_id,
    wp.part_id,
    wp.part_number_text,
    wp.part_description,
    wp.projection_window,
    wp.projected_due_date,
    wp.probability,
    wp.reason,
    wp.signal_type,
    coalesce(wp.on_hand, 0),
    greatest(1, 2 - coalesce(wp.on_hand, 0))::numeric,
    coalesce(wp.list_price, wp.cost_price, 0),
    wp.vendor_id,
    wp.suggested_order_by,
    batch_id,
    jsonb_build_object(
      'fleet_id',          wp.fleet_id,
      'machine_profile',   wp.machine_profile_id
    )
  from deduped wp
  on conflict (workspace_id, portal_customer_id, fleet_id, part_id, projection_window)
  do update set
    projected_due_date     = excluded.projected_due_date,
    probability            = excluded.probability,
    reason                 = excluded.reason,
    signal_type            = excluded.signal_type,
    current_on_hand        = excluded.current_on_hand,
    recommended_order_qty  = excluded.recommended_order_qty,
    projected_revenue      = excluded.projected_revenue,
    suggested_vendor_id    = excluded.suggested_vendor_id,
    suggested_order_by     = excluded.suggested_order_by,
    computation_batch_id   = excluded.computation_batch_id,
    input_signals          = excluded.input_signals,
    status                 = case when public.predicted_parts_plays.status in ('dismissed', 'actioned', 'fulfilled')
                                  then public.predicted_parts_plays.status
                                  else 'open' end,
    updated_at             = now();

  get diagnostics plays_written = row_count;

  -- Expire plays past their due date that weren't actioned
  update public.predicted_parts_plays
  set status = 'expired', updated_at = now()
  where workspace_id = ws
    and status = 'open'
    and projected_due_date < current_date - 7;

  select count(distinct fleet_id)::int into machines_scanned
  from public.predicted_parts_plays
  where workspace_id = ws and computation_batch_id = batch_id;

  return jsonb_build_object(
    'ok', true,
    'plays_written', plays_written,
    'machines_scanned', machines_scanned,
    'batch_id', batch_id,
    'elapsed_ms', extract(epoch from (now() - started)) * 1000
  );
end;
$$;

-- ============================================================================
-- Migration 263 complete.
-- ============================================================================
