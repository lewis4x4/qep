-- ============================================================================
-- Migration 261: Parts Intelligence Phase 2 — Schedule-aware replenishment
--                                          + Machine↔Parts knowledge graph
--
-- Ships two related additions:
--
-- A. Auto-replenish schedule + forecast awareness
--    - Extends parts_auto_replenish_queue with scheduled_for / forecast_driven
--      / vendor_price_corroborated / cdk_vendor_list_price
--    - Extends status check to include 'scheduled' (waiting for vendor's
--      ordering day per vendor_order_schedules)
--    - Adds RPC next_vendor_order_date() for the edge function
--
-- B. Machine ↔ Parts knowledge graph (prereq for Phase 3.3 moonshot —
--    predictive failure → pre-position parts)
--    - machine_parts_links table (association strength between a machine_profile
--      and a part_catalog row — learned from CDK data + manual curation)
--    - v_machine_parts_connections view that joins parts_catalog.machine_code
--      to machine_profiles via fuzzy match + manual mapping overrides
--    - machine_parts_graph_refresh() RPC that rebuilds links from current data
-- ============================================================================

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ A. Auto-replenish schedule + forecast awareness                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Extend queue table
alter table public.parts_auto_replenish_queue
  add column if not exists scheduled_for date,
  add column if not exists forecast_driven boolean not null default false,
  add column if not exists forecast_covered_days integer,
  add column if not exists vendor_price_corroborated boolean not null default false,
  add column if not exists cdk_vendor_list_price numeric(14, 4),
  add column if not exists potential_overpay_flag boolean not null default false;

comment on column public.parts_auto_replenish_queue.scheduled_for is
  'When frequency-based vendor_order_schedules defer this PO to a future day.';
comment on column public.parts_auto_replenish_queue.forecast_driven is
  'True when recommended_qty was sized from the forecast (lead_time × daily_velocity + safety stock).';
comment on column public.parts_auto_replenish_queue.vendor_price_corroborated is
  'True when our selected unit cost was cross-checked against parts_vendor_prices.';

-- Relax the status enum to include 'scheduled'
alter table public.parts_auto_replenish_queue
  drop constraint if exists parts_auto_replenish_queue_status_check;

alter table public.parts_auto_replenish_queue
  add constraint parts_auto_replenish_queue_status_check
  check (status in ('pending', 'scheduled', 'approved', 'auto_approved', 'rejected', 'ordered', 'expired'));

-- Useful index for the /parts/replenish dashboard (Phase 2.5 follow-up UI)
create index if not exists idx_auto_replenish_queue_scheduled
  on public.parts_auto_replenish_queue(workspace_id, scheduled_for)
  where status = 'scheduled';

-- ── RPC: next_vendor_order_date ─────────────────────────────────────────────
-- Given a (vendor_id, branch_code), returns the next calendar date on which
-- this vendor should be ordered from per their configured schedule.
-- Returns NULL if no schedule configured (→ caller treats as on_demand).

create or replace function public.next_vendor_order_date(
  p_vendor_id  uuid,
  p_branch     text default '',
  p_from_date  date default current_date
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  sched record;
  next_date date;
  target_dow int;
  today_dow int;
  days_ahead int;
begin
  -- Prefer branch-specific schedule; fall back to any active schedule.
  select frequency, day_of_week
    into sched
  from public.vendor_order_schedules
  where vendor_id = p_vendor_id
    and is_active = true
    and (branch_code = p_branch or branch_code = '')
  order by case when branch_code = p_branch then 0 else 1 end
  limit 1;

  if sched is null then
    return null;
  end if;

  if sched.frequency = 'daily' then
    return p_from_date;
  end if;

  if sched.frequency = 'on_demand' then
    return p_from_date; -- no cadence → treat as eligible today
  end if;

  -- weekly / biweekly / monthly all need a day_of_week
  if sched.day_of_week is null then
    return p_from_date;
  end if;

  target_dow := case lower(sched.day_of_week)
    when 'sunday'    then 0
    when 'monday'    then 1
    when 'tuesday'   then 2
    when 'wednesday' then 3
    when 'thursday'  then 4
    when 'friday'    then 5
    when 'saturday'  then 6
    else 1
  end;

  today_dow := extract(dow from p_from_date);
  days_ahead := (target_dow - today_dow + 7) % 7;
  next_date := p_from_date + days_ahead;

  if sched.frequency = 'biweekly' and days_ahead = 0 then
    -- ISO week parity check — if current ISO week is even, push out 7 days
    if (extract(week from next_date))::int % 2 = 0 then
      next_date := next_date + 7;
    end if;
  end if;

  if sched.frequency = 'monthly' then
    -- keep same dow but only first occurrence per month
    if extract(month from next_date) = extract(month from p_from_date)
       and next_date - p_from_date < 7
       and target_dow = today_dow then
      -- already matches today and inside this month → fine
      null;
    else
      next_date := p_from_date + days_ahead;
    end if;
  end if;

  return next_date;
end;
$$;

grant execute on function public.next_vendor_order_date(uuid, text, date) to authenticated;

-- ── RPC: parts_replenish_queue_summary ───────────────────────────────────────
-- Dashboard payload for the auto-replenish review UI.

create or replace function public.parts_replenish_queue_summary(p_workspace text default null)
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
    'totals', jsonb_build_object(
      'pending',        (select count(*)::int from public.parts_auto_replenish_queue where workspace_id = ws and status = 'pending'),
      'scheduled',      (select count(*)::int from public.parts_auto_replenish_queue where workspace_id = ws and status = 'scheduled'),
      'auto_approved',  (select count(*)::int from public.parts_auto_replenish_queue where workspace_id = ws and status = 'auto_approved'),
      'approved',       (select count(*)::int from public.parts_auto_replenish_queue where workspace_id = ws and status = 'approved'),
      'ordered',        (select count(*)::int from public.parts_auto_replenish_queue where workspace_id = ws and status = 'ordered'),
      'overpay_flags',  (select count(*)::int from public.parts_auto_replenish_queue where workspace_id = ws and potential_overpay_flag = true and status in ('pending','scheduled'))
    ),
    'by_vendor', (
      select coalesce(jsonb_agg(row_to_json(v)), '[]'::jsonb)
      from (
        select
          vp.name                    as vendor_name,
          q.selected_vendor_id,
          count(*)::int              as item_count,
          sum(q.estimated_total)::numeric(14,2) as total_usd,
          min(q.scheduled_for)       as next_order_date
        from public.parts_auto_replenish_queue q
        left join public.vendor_profiles vp on vp.id = q.selected_vendor_id
        where q.workspace_id = ws and q.status in ('pending','scheduled','auto_approved')
        group by vp.name, q.selected_vendor_id
        order by total_usd desc nulls last
        limit 20
      ) v
    ),
    'upcoming', (
      select coalesce(jsonb_agg(row_to_json(u)), '[]'::jsonb)
      from (
        select
          q.part_number,
          q.branch_id,
          q.qty_on_hand,
          q.reorder_point,
          q.recommended_qty,
          q.forecast_driven,
          q.forecast_covered_days,
          q.estimated_unit_cost,
          q.estimated_total,
          q.status,
          q.scheduled_for,
          q.potential_overpay_flag,
          vp.name as vendor_name
        from public.parts_auto_replenish_queue q
        left join public.vendor_profiles vp on vp.id = q.selected_vendor_id
        where q.workspace_id = ws and q.status in ('pending','scheduled','auto_approved')
        order by
          case q.status
            when 'auto_approved' then 0
            when 'scheduled'     then 1
            when 'pending'       then 2
            else 9
          end,
          q.scheduled_for asc nulls first,
          q.estimated_total desc nulls last
        limit 30
      ) u
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.parts_replenish_queue_summary(text) to authenticated;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ B. Machine ↔ Parts knowledge graph                                    ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create table if not exists public.machine_parts_links (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    text not null default 'default',
  machine_id      uuid not null references public.machine_profiles(id) on delete cascade,
  part_id         uuid not null references public.parts_catalog(id) on delete cascade,
  part_number     text not null,
  link_source     text not null check (
    link_source in ('cdk_machine_code', 'manual_curation', 'ai_inferred', 'manufacturer_catalog')
  ),
  association_strength numeric(4, 3) not null default 0.5
    check (association_strength >= 0 and association_strength <= 1),
  usage_frequency text check (
    usage_frequency in ('common_wear', 'scheduled_maintenance', 'failure_repair', 'optional_accessory')
  ),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, machine_id, part_id)
);

comment on table public.machine_parts_links is
  'Knowledge graph linking machine_profiles to parts_catalog. Populated by '
  'machine_parts_graph_refresh() from parts_catalog.machine_code matches, '
  'augmented manually and by AI inference. Feeds Phase 3.3 predictive failure.';

create index idx_machine_parts_links_machine
  on public.machine_parts_links(workspace_id, machine_id, association_strength desc);

create index idx_machine_parts_links_part
  on public.machine_parts_links(workspace_id, part_id, association_strength desc);

alter table public.machine_parts_links enable row level security;

create policy "machine_parts_links_select"
  on public.machine_parts_links for select
  using (workspace_id = public.get_my_workspace());

create policy "machine_parts_links_mutate_elevated"
  on public.machine_parts_links for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "machine_parts_links_service_all"
  on public.machine_parts_links for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_machine_parts_links_updated_at
  before update on public.machine_parts_links
  for each row execute function public.set_updated_at();

-- ── View: machine_parts_connections — unified graph query surface ──────────

create or replace view public.v_machine_parts_connections as
select
  mpl.workspace_id,
  mpl.machine_id,
  mp.manufacturer,
  mp.model,
  mp.model_family,
  mp.category                        as machine_category,
  mpl.part_id,
  pc.part_number,
  pc.description                     as part_description,
  pc.vendor_code,
  pc.branch_code,
  pc.on_hand,
  pc.cost_price,
  pc.list_price,
  mpl.link_source,
  mpl.association_strength,
  mpl.usage_frequency,
  -- bring in velocity class for predictive planning
  v.velocity_class,
  v.daily_velocity,
  v.history_12mo_sales
from public.machine_parts_links mpl
join public.machine_profiles mp on mp.id = mpl.machine_id
join public.parts_catalog pc on pc.id = mpl.part_id and pc.deleted_at is null
left join public.v_parts_velocity v on v.part_id = pc.id;

comment on view public.v_machine_parts_connections is
  'Unified machine↔parts graph query surface. Each row = one link with '
  'machine + part + velocity context. Used by /parts/companion/machines to '
  'show "parts for this model" and by Phase 3.3 predictive failure engine.';

-- ── RPC: machine_parts_graph_refresh ────────────────────────────────────────
-- Rebuild links from current parts_catalog data. Strategy:
--   1. For each part_catalog row with a machine_code or model_code, try to
--      match against machine_profiles by normalizing both sides
--   2. Association strength based on 12-month sales history (higher = stronger)
--   3. Idempotent — upsert by (workspace, machine, part)
--
-- Preserves manually curated links (link_source='manual_curation').

create or replace function public.machine_parts_graph_refresh(p_workspace text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  links_upserted integer := 0;
  machines_matched integer := 0;
  started timestamptz := now();
begin
  ws := coalesce(p_workspace, public.get_my_workspace());
  if public.get_my_role() not in ('admin', 'manager', 'owner') and current_user <> 'service_role' then
    raise exception 'insufficient role';
  end if;

  -- Re-derive from CDK matches, preserving manual_curation rows
  with candidates as (
    select
      pc.id                                         as part_id,
      pc.workspace_id,
      pc.part_number,
      mp.id                                         as machine_id,
      greatest(
        0.3,
        least(
          1.0,
          coalesce(pc.last_12mo_sales, 0) / nullif(
            (select max(last_12mo_sales) from public.parts_catalog where machine_code = pc.machine_code and workspace_id = pc.workspace_id),
            0
          )
        )
      )                                             as strength,
      case
        when coalesce(pc.class_code, '') = 'M' then 'scheduled_maintenance'
        when coalesce(pc.movement_code, '') in ('A','B') then 'common_wear'
        else null
      end                                           as usage_frequency,
      'cdk_machine_code'                            as link_source
    from public.parts_catalog pc
    join public.machine_profiles mp
      on mp.workspace_id = pc.workspace_id
      and (
        upper(pc.machine_code) = upper(mp.model)
        or upper(pc.model_code) = upper(mp.model)
        or upper(pc.machine_code) = upper(mp.model_family)
        or upper(pc.model_code) = upper(mp.model_family)
      )
    where pc.workspace_id = ws
      and pc.deleted_at is null
      and (pc.machine_code is not null or pc.model_code is not null)
  )
  insert into public.machine_parts_links (
    workspace_id, machine_id, part_id, part_number,
    link_source, association_strength, usage_frequency
  )
  select c.workspace_id, c.machine_id, c.part_id, c.part_number,
         c.link_source, c.strength, c.usage_frequency
  from candidates c
  on conflict (workspace_id, machine_id, part_id) do update
  set
    association_strength = case
      when public.machine_parts_links.link_source = 'manual_curation' then public.machine_parts_links.association_strength
      else excluded.association_strength
    end,
    usage_frequency = coalesce(public.machine_parts_links.usage_frequency, excluded.usage_frequency),
    updated_at = now();

  get diagnostics links_upserted = row_count;

  select count(distinct machine_id)::int into machines_matched
  from public.machine_parts_links
  where workspace_id = ws;

  return jsonb_build_object(
    'ok', true,
    'links_upserted', links_upserted,
    'machines_with_parts', machines_matched,
    'elapsed_ms', extract(epoch from (now() - started)) * 1000
  );
end;
$$;

grant execute on function public.machine_parts_graph_refresh(text) to authenticated;

-- ── RPC: machine_parts_intel — per-machine parts roll-up ───────────────────
-- Returns all parts linked to a given machine, ordered by association strength
-- and seeded with velocity/stockout context. Feeds the MachineProfile page.

create or replace function public.machine_parts_intel(
  p_machine_id uuid,
  p_limit      integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  result jsonb;
begin
  ws := public.get_my_workspace();

  select jsonb_build_object(
    'machine', (
      select row_to_json(m)
      from public.machine_profiles m
      where m.id = p_machine_id and m.workspace_id = ws
    ),
    'parts', coalesce((
      select jsonb_agg(row_to_json(p))
      from (
        select
          c.part_id, c.part_number, c.part_description,
          c.link_source, c.association_strength, c.usage_frequency,
          c.on_hand, c.cost_price, c.list_price,
          c.velocity_class, c.daily_velocity, c.history_12mo_sales,
          c.branch_code
        from public.v_machine_parts_connections c
        where c.machine_id = p_machine_id and c.workspace_id = ws
        order by c.association_strength desc, c.history_12mo_sales desc
        limit p_limit
      ) p
    ), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'total_linked_parts', (
        select count(*)::int from public.machine_parts_links
        where machine_id = p_machine_id and workspace_id = ws
      ),
      'common_wear_parts', (
        select count(*)::int from public.machine_parts_links
        where machine_id = p_machine_id and workspace_id = ws
          and usage_frequency = 'common_wear'
      ),
      'maintenance_parts', (
        select count(*)::int from public.machine_parts_links
        where machine_id = p_machine_id and workspace_id = ws
          and usage_frequency = 'scheduled_maintenance'
      )
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.machine_parts_intel(uuid, integer) to authenticated;

grant select on public.v_machine_parts_connections to authenticated;

-- ============================================================================
-- Migration 261 complete.
-- ============================================================================
