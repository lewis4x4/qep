-- ============================================================================
-- Migration 262: Parts Intelligence Phase 3.3 — Predictive Parts Plays
--
-- The Moonshot: for each customer machine we track (customer_fleet), predict
-- which parts will likely be needed in the next 30/60/90 days based on:
--   - current operating hours vs service interval
--   - machine_profiles.maintenance_schedule (interval_hours + parts)
--   - machine_profiles.common_wear_parts (avg_replace_hours)
--   - machine_parts_links (parts we stock that fit this model)
--
-- Then tell the sales rep: "Pre-position SKU X, you have Y on hand, order Z
-- from vendor V by their next order day."
--
-- Tables:
--   - predicted_parts_plays — one row per (customer, machine, part, projected date)
--
-- Views:
--   - v_predictive_plays — joined with current inventory + vendor schedule + revenue est
--
-- RPCs:
--   - predict_parts_needs(workspace, lookahead_days) — pure-SQL baseline prediction
--   - predictive_plays_summary(workspace) — dashboard payload
--   - dismiss_play(id) / action_play(id, note) — lifecycle
-- ============================================================================

-- ── predicted_parts_plays ───────────────────────────────────────────────────

create table if not exists public.predicted_parts_plays (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'default',

  -- Who & what
  portal_customer_id    uuid not null references public.portal_customers(id) on delete cascade,
  fleet_id              uuid references public.customer_fleet(id) on delete set null,
  machine_profile_id    uuid references public.machine_profiles(id) on delete set null,
  part_id               uuid references public.parts_catalog(id) on delete cascade,
  part_number           text not null,
  part_description      text,

  -- Prediction
  projection_window     text not null check (projection_window in ('7d', '14d', '30d', '60d', '90d')),
  projected_due_date    date not null,
  probability           numeric(4, 3) not null default 0.7
    check (probability >= 0 and probability <= 1),
  reason                text not null,
  -- e.g. "Machine at 1,820 hrs, 250-hr service interval due in 42 hrs (est 12 days)"
  signal_type           text not null check (signal_type in (
    'hours_based_interval',
    'date_based_schedule',
    'common_wear_pattern',
    'yoy_demand_spike',
    'manual_curation',
    'ai_inferred'
  )),

  -- Inventory context (snapshot at play-creation time)
  current_on_hand       numeric,
  recommended_order_qty numeric,
  projected_revenue     numeric(14, 2),

  -- Next vendor ordering window — tells rep "order by X"
  suggested_vendor_id   uuid references public.vendor_profiles(id) on delete set null,
  suggested_order_by    date,

  -- Lifecycle
  status                text not null default 'open' check (status in (
    'open', 'actioned', 'dismissed', 'expired', 'fulfilled'
  )),
  actioned_by           uuid references public.profiles(id) on delete set null,
  actioned_at           timestamptz,
  action_note           text,

  -- Metadata
  computation_batch_id  text,
  input_signals         jsonb not null default '{}'::jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- One play per (customer, machine, part, window) — re-runs update in place
  unique (workspace_id, portal_customer_id, fleet_id, part_id, projection_window)
);

comment on table public.predicted_parts_plays is
  'Phase 3.3 moonshot: forward-looking parts demand per customer machine. '
  'Rep-facing: pre-position specific SKUs before the customer even asks.';

create index idx_predicted_plays_status
  on public.predicted_parts_plays(workspace_id, status, projected_due_date)
  where status = 'open';

create index idx_predicted_plays_customer
  on public.predicted_parts_plays(workspace_id, portal_customer_id, status);

create index idx_predicted_plays_due_soon
  on public.predicted_parts_plays(workspace_id, projected_due_date)
  where status = 'open';

alter table public.predicted_parts_plays enable row level security;

create policy "predicted_plays_select"
  on public.predicted_parts_plays for select
  using (workspace_id = public.get_my_workspace());

create policy "predicted_plays_mutate"
  on public.predicted_parts_plays for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "predicted_plays_service_all"
  on public.predicted_parts_plays for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_predicted_plays_updated_at
  before update on public.predicted_parts_plays
  for each row execute function public.set_updated_at();

-- ── View: v_predictive_plays ────────────────────────────────────────────────
-- Enriched query surface — joins with current inventory, customer, vendor schedule.

create or replace view public.v_predictive_plays as
select
  p.id,
  p.workspace_id,
  p.portal_customer_id,
  p.fleet_id,
  p.part_id,
  p.part_number,
  p.part_description,
  p.projection_window,
  p.projected_due_date,
  p.projected_due_date - current_date          as days_until_due,
  p.probability,
  p.reason,
  p.signal_type,
  p.recommended_order_qty,
  p.projected_revenue,
  p.suggested_order_by,
  p.status,
  coalesce(
    cc.name,
    trim(concat(pc_portal.first_name, ' ', pc_portal.last_name)),
    'Customer'
  )                                             as customer_name,
  cf.make                                       as machine_make,
  cf.model                                      as machine_model,
  cf.year                                       as machine_year,
  cf.current_hours                              as machine_hours,
  cf.serial_number                              as machine_serial,
  -- Current inventory position
  (select coalesce(sum(on_hand), 0)::numeric from public.parts_catalog
    where workspace_id = p.workspace_id and part_number = p.part_number and deleted_at is null)
                                                as current_on_hand_across_branches,
  -- Vendor context
  vp.name                                       as suggested_vendor_name,
  -- Forecast alignment — do we already have this in the forecast?
  (select max(stockout_risk) from public.parts_demand_forecasts f
    where f.workspace_id = p.workspace_id and f.part_number = p.part_number
      and f.forecast_month >= current_date)
                                                as forecast_stockout_risk
from public.predicted_parts_plays p
left join public.portal_customers pc_portal
  on pc_portal.id = p.portal_customer_id
  and pc_portal.workspace_id = p.workspace_id
left join public.crm_companies cc
  on cc.id = pc_portal.crm_company_id
  and cc.workspace_id = p.workspace_id
left join public.customer_fleet cf
  on cf.id = p.fleet_id
left join public.vendor_profiles vp
  on vp.id = p.suggested_vendor_id;

comment on view public.v_predictive_plays is
  'Enriched predictive plays for UI surface. Includes customer + machine + inventory context.';

grant select on public.v_predictive_plays to authenticated;

-- ── RPC: predict_parts_needs — pure-SQL baseline predictor ──────────────────
-- For each (customer_fleet, machine_profile, linked_part), project when the
-- part will likely be needed. Writes into predicted_parts_plays with an
-- idempotent batch_id so re-runs update in place.

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

  -- Main insert: for each customer fleet row, find matching machine_profiles,
  -- then find linked parts, then compute projected_due_date from current_hours
  -- vs service_interval_hours. We assume a conservative daily_usage of 6 hours
  -- when we don't have a per-machine telemetry value (TODO: telemetry layer).

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
    -- Flatten the JSON maintenance_schedule into per-interval rows
    select
      fc.fleet_id, fc.workspace_id, fc.portal_customer_id, fc.machine_profile_id,
      fc.current_hours,
      (sched->>'interval_hours')::numeric    as interval_hours,
      sched->'parts'                          as parts_arr,
      -- Hours-since-last-service: assume last was at the most recent interval hit
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
      -- Projected date = now + (hours_until_next / 6 daily hours)
      (current_date + ceil(ip.hours_until_next / 6.0)::int)  as projected_due_date,
      part_number_raw::text as part_number_text
    from interval_projections ip
    cross join jsonb_array_elements_text(coalesce(ip.parts_arr, '[]'::jsonb)) as part_number_raw
    where ip.hours_until_next / 6.0 <= p_lookahead_days
  ),
  common_wear as (
    -- Common-wear: for each linked part, project next replacement based on
    -- avg_replace_hours if we can find one in common_wear_parts JSONB.
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
      s.*,
      pc.id          as part_id,
      pc.description as part_description,
      pc.on_hand,
      pc.list_price,
      pc.cost_price,
      pc.vendor_code,
      vp.id          as vendor_id,
      public.next_vendor_order_date(vp.id, '', current_date) as suggested_order_by
    from all_signals s
    join public.parts_catalog pc
      on pc.workspace_id = s.workspace_id
      and upper(pc.part_number) = upper(s.part_number_text)
      and pc.deleted_at is null
    left join public.vendor_profiles vp
      on vp.workspace_id = s.workspace_id
      and (upper(vp.name) = upper(pc.vendor_code) or upper(split_part(vp.name, ' ', 1)) = upper(pc.vendor_code))
    -- Dedup: pick the best (latest projected_due_date is fine; primary key of CTE is fleet+part)
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
    case
      when wp.projected_due_date - current_date <= 7  then '7d'
      when wp.projected_due_date - current_date <= 14 then '14d'
      when wp.projected_due_date - current_date <= 30 then '30d'
      when wp.projected_due_date - current_date <= 60 then '60d'
      else '90d'
    end,
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
  from with_parts wp
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
    -- Don't reopen a dismissed or actioned play on re-run
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

grant execute on function public.predict_parts_needs(text, integer) to authenticated;

-- ── RPC: predictive_plays_summary — dashboard payload ───────────────────────

create or replace function public.predictive_plays_summary(p_workspace text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  result jsonb;
begin
  ws := coalesce(p_workspace, public.get_my_workspace());

  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'open_plays', (
        select count(*)::int from public.predicted_parts_plays
        where workspace_id = ws and status = 'open'
      ),
      'plays_due_7d', (
        select count(*)::int from public.predicted_parts_plays
        where workspace_id = ws and status = 'open'
          and projected_due_date <= current_date + 7
      ),
      'plays_needing_order', (
        select count(*)::int from public.predicted_parts_plays
        where workspace_id = ws and status = 'open'
          and recommended_order_qty > coalesce(current_on_hand, 0)
      ),
      'projected_revenue_90d', (
        select coalesce(sum(projected_revenue * recommended_order_qty), 0)::numeric(14,2)
        from public.predicted_parts_plays
        where workspace_id = ws and status = 'open'
          and projected_due_date <= current_date + 90
      ),
      'customers_touched', (
        select count(distinct portal_customer_id)::int
        from public.predicted_parts_plays
        where workspace_id = ws and status = 'open'
      )
    ),
    'plays', (
      select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb)
      from (
        select
          id, part_number, part_description,
          projection_window, projected_due_date, days_until_due,
          probability, reason, signal_type, recommended_order_qty,
          projected_revenue, status, suggested_order_by,
          customer_name, machine_make, machine_model, machine_hours,
          current_on_hand_across_branches, suggested_vendor_name
        from public.v_predictive_plays
        where workspace_id = ws and status = 'open'
        order by projected_due_date asc, probability desc
        limit 30
      ) p
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.predictive_plays_summary(text) to authenticated;

-- ── RPC: action a play (fulfilled / dismissed) ──────────────────────────────

create or replace function public.action_predictive_play(
  p_play_id uuid,
  p_action  text, -- 'actioned' | 'dismissed' | 'fulfilled'
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();
  if public.get_my_role() not in ('rep', 'admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;
  if p_action not in ('actioned', 'dismissed', 'fulfilled', 'open') then
    raise exception 'invalid action';
  end if;

  update public.predicted_parts_plays
  set status        = p_action,
      actioned_by   = actor,
      actioned_at   = now(),
      action_note   = coalesce(p_note, action_note),
      updated_at    = now()
  where id = p_play_id and workspace_id = ws;

  return jsonb_build_object('ok', true, 'play_id', p_play_id, 'status', p_action);
end;
$$;

grant execute on function public.action_predictive_play(uuid, text, text) to authenticated;

-- ============================================================================
-- Migration 262 complete.
-- ============================================================================
