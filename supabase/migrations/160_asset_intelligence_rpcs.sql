-- ============================================================================
-- Migration 160: Asset Intelligence RPCs (Wave 6.2)
--
-- Backing data + composite RPCs for the Asset 360 page and the
-- AssetCountdownStack / AssetBadgeRow / Last24hStrip primitives.
--
-- Reuses existing crm_equipment, service_jobs, parts_orders, crm_deals,
-- voice_captures, and telematics tables. Adds two small reference tables
-- (service intervals + replacement-cost curves) and four SECURITY DEFINER
-- RPCs that the frontend calls in a single round-trip.
-- ============================================================================

-- ── 1. Equipment service intervals ─────────────────────────────────────────

create table if not exists public.equipment_service_intervals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  equipment_id uuid not null references public.crm_equipment(id) on delete cascade,
  interval_label text not null,                     -- '250hr Service', 'Hydraulic Filter', etc.
  interval_hours integer not null check (interval_hours > 0),
  last_completed_hours numeric(12,1),
  last_completed_at timestamptz,
  next_due_hours numeric(12,1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.equipment_service_intervals is 'Per-asset PM intervals. Powers AssetCountdownStack rows for 250/500/1000hr services.';

alter table public.equipment_service_intervals enable row level security;

create policy "esi_workspace" on public.equipment_service_intervals for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "esi_service" on public.equipment_service_intervals for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_esi_equipment on public.equipment_service_intervals(equipment_id);
create index idx_esi_workspace on public.equipment_service_intervals(workspace_id);

create trigger set_esi_updated_at
  before update on public.equipment_service_intervals
  for each row execute function public.set_updated_at();

-- ── 2. Replacement cost curves ─────────────────────────────────────────────

create table if not exists public.replacement_cost_curves (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  make text not null,
  model text not null,
  category text,
  hours_bracket integer not null,                   -- e.g. 0, 1000, 2000, 3000, 5000, 7000
  parts_spend_pct_of_new numeric(5,2) not null,     -- average parts spend at this bracket as % of new
  service_spend_pct_of_new numeric(5,2) not null,
  recommended_action text,                          -- 'monitor' | 'plan_trade_up' | 'urgent_trade_up'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.replacement_cost_curves is 'Reference table: at what hour bracket does cumulative spend tip the trade-up decision per make/model.';

alter table public.replacement_cost_curves enable row level security;

create policy "rcc_workspace" on public.replacement_cost_curves for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "rcc_service" on public.replacement_cost_curves for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_rcc_make_model on public.replacement_cost_curves(make, model, hours_bracket);

create trigger set_rcc_updated_at
  before update on public.replacement_cost_curves
  for each row execute function public.set_updated_at();

-- ── 3. RPC: get_asset_countdowns ───────────────────────────────────────────
-- Returns labelled rows for the AssetCountdownStack primitive.

create or replace function public.get_asset_countdowns(p_equipment_id uuid)
returns table (
  label text,
  current numeric,
  target numeric,
  unit text,
  tone text,
  sort_order int
)
language plpgsql
security invoker
stable
as $$
declare
  v_engine_hours numeric;
  v_year integer;
  v_metadata jsonb;
begin
  -- Caller must have RLS read on the equipment row; if not, return empty
  select e.engine_hours, e.year, e.metadata
    into v_engine_hours, v_year, v_metadata
  from public.crm_equipment e
  where e.id = p_equipment_id;

  if not found then
    return;
  end if;

  -- 1. Service intervals
  return query
    select
      esi.interval_label,
      coalesce(v_engine_hours - coalesce(esi.last_completed_hours, 0), 0)::numeric as current,
      esi.interval_hours::numeric as target,
      'hours'::text as unit,
      case
        when v_engine_hours - coalesce(esi.last_completed_hours, 0) >= esi.interval_hours then 'red'
        when v_engine_hours - coalesce(esi.last_completed_hours, 0) >= esi.interval_hours * 0.9 then 'orange'
        when v_engine_hours - coalesce(esi.last_completed_hours, 0) >= esi.interval_hours * 0.75 then 'yellow'
        else 'blue'
      end as tone,
      10 as sort_order
    from public.equipment_service_intervals esi
    where esi.equipment_id = p_equipment_id;

  -- 2. Warranty (from metadata.warranty_expires_at if present)
  if v_metadata ? 'warranty_expires_at' then
    return query
      select
        'Warranty'::text,
        greatest(0, extract(epoch from now()) / 86400)::numeric,
        greatest(1, extract(epoch from (v_metadata->>'warranty_expires_at')::timestamptz) / 86400)::numeric,
        'days'::text,
        case
          when (v_metadata->>'warranty_expires_at')::timestamptz < now() then 'red'
          when (v_metadata->>'warranty_expires_at')::timestamptz < now() + interval '60 days' then 'orange'
          else 'green'
        end,
        20;
  end if;

  -- 3. Replacement cost crossover (heuristic: 5000 hours by default)
  if v_engine_hours is not null then
    return query
      select
        'Replacement Window'::text,
        v_engine_hours::numeric,
        5000::numeric,
        'hours'::text,
        case
          when v_engine_hours >= 5000 then 'red'
          when v_engine_hours >= 4000 then 'orange'
          when v_engine_hours >= 3000 then 'yellow'
          else 'neutral'
        end,
        30;
  end if;
end;
$$;

comment on function public.get_asset_countdowns(uuid) is 'Composite countdown rows for AssetCountdownStack: service intervals + warranty + replacement window.';

-- ── 4. RPC: get_asset_badges ───────────────────────────────────────────────

create or replace function public.get_asset_badges(p_equipment_id uuid)
returns json
language plpgsql
security invoker
stable
as $$
declare
  v_open_wo int;
  v_open_quotes int;
  v_pending_parts int;
  v_overdue_intervals int;
  v_trade_up_score int;
  v_lifetime_parts numeric;
  v_engine_hours numeric;
begin
  select e.engine_hours into v_engine_hours
    from public.crm_equipment e where e.id = p_equipment_id;

  if not found then
    return json_build_object(
      'open_work_orders', 0, 'open_quotes', 0, 'pending_parts_orders', 0,
      'overdue_intervals', 0, 'trade_up_score', 0, 'lifetime_parts_spend', 0
    );
  end if;

  select count(*) into v_open_wo
    from public.service_jobs sj
    where sj.equipment_id = p_equipment_id
      and sj.status not in ('completed', 'cancelled', 'closed');

  select count(*) into v_open_quotes
    from public.crm_deal_equipment de
    join public.quote_packages q on q.deal_id = de.deal_id
    where de.equipment_id = p_equipment_id
      and q.status in ('draft', 'sent', 'negotiating');

  select count(*) into v_pending_parts
    from public.parts_orders po
    where po.equipment_id = p_equipment_id
      and po.status in ('pending_approval', 'approved', 'ordered', 'partial_received');

  select count(*) into v_overdue_intervals
    from public.equipment_service_intervals esi
    where esi.equipment_id = p_equipment_id
      and v_engine_hours - coalesce(esi.last_completed_hours, 0) >= esi.interval_hours;

  select coalesce(sum(po.total_amount), 0) into v_lifetime_parts
    from public.parts_orders po
    where po.equipment_id = p_equipment_id
      and po.status in ('completed', 'fulfilled');

  -- Trade-up score: simple heuristic based on hours + overdue intervals + parts spend
  v_trade_up_score := least(100, greatest(0,
    coalesce(v_engine_hours / 50, 0)::int  -- 5000 hours = 100
    + v_overdue_intervals * 5
    + (v_lifetime_parts / 1000)::int
  ));

  return json_build_object(
    'open_work_orders', v_open_wo,
    'open_quotes', v_open_quotes,
    'pending_parts_orders', v_pending_parts,
    'overdue_intervals', v_overdue_intervals,
    'trade_up_score', v_trade_up_score,
    'lifetime_parts_spend', v_lifetime_parts
  );
end;
$$;

comment on function public.get_asset_badges(uuid) is 'Six-badge summary used by AssetBadgeRow primitive on Asset 360.';

-- ── 5. RPC: get_asset_24h_activity ─────────────────────────────────────────

create or replace function public.get_asset_24h_activity(p_equipment_id uuid)
returns table (
  category text,
  event_type text,
  count int,
  last_at timestamptz,
  detail text
)
language plpgsql
security invoker
stable
as $$
begin
  -- Commercial: quote_packages touched in 24h
  return query
    select 'commercial'::text, 'quote_touched'::text, count(*)::int, max(q.updated_at), null::text
      from public.quote_packages q
      join public.crm_deal_equipment de on de.deal_id = q.deal_id
      where de.equipment_id = p_equipment_id
        and q.updated_at > now() - interval '24 hours'
      having count(*) > 0;

  -- Commercial: parts_orders created in 24h
  return query
    select 'commercial'::text, 'parts_ordered'::text, count(*)::int, max(po.created_at), null::text
      from public.parts_orders po
      where po.equipment_id = p_equipment_id
        and po.created_at > now() - interval '24 hours'
      having count(*) > 0;

  -- Commercial: voice_captures referencing this equipment in 24h
  return query
    select 'commercial'::text, 'voice_capture'::text, count(*)::int, max(vc.created_at), null::text
      from public.voice_captures vc
      where (vc.metadata ? 'equipment_id' and (vc.metadata->>'equipment_id')::uuid = p_equipment_id)
        and vc.created_at > now() - interval '24 hours'
      having count(*) > 0;

  -- Mechanical: telematics_readings in 24h (best-effort: table may not exist on every workspace)
  begin
    return query
      execute format($q$
        select 'mechanical'::text, 'run_hours'::text, count(*)::int, max(reading_at), null::text
          from public.telematics_readings
          where equipment_id = %L
            and reading_at > now() - interval '24 hours'
          having count(*) > 0
      $q$, p_equipment_id);
  exception when undefined_table then
    -- telematics_readings not present in this deployment
    null;
  end;
end;
$$;

comment on function public.get_asset_24h_activity(uuid) is 'Mechanical + commercial activity rows for Last24hStrip primitive.';

-- ── 6. RPC: get_asset_360 — single round-trip composite ───────────────────

create or replace function public.get_asset_360(p_equipment_id uuid)
returns json
language plpgsql
security invoker
stable
as $$
declare
  v_equipment json;
  v_company json;
  v_badges json;
  v_recent_service json;
  v_open_deal json;
begin
  select to_json(e.*) into v_equipment
    from public.crm_equipment e where e.id = p_equipment_id;

  if v_equipment is null then
    return null;
  end if;

  select to_json(c.*) into v_company
    from public.crm_companies c
    where c.id = (v_equipment->>'company_id')::uuid;

  v_badges := public.get_asset_badges(p_equipment_id);

  select json_agg(row_to_json(sj)) into v_recent_service
    from (
      select id, summary, status, scheduled_for, completed_at
      from public.service_jobs
      where equipment_id = p_equipment_id
      order by created_at desc
      limit 5
    ) sj;

  select to_json(d) into v_open_deal
    from (
      select d.id, d.name, d.amount, d.stage_id, d.next_follow_up_at
      from public.crm_deal_equipment de
      join public.crm_deals d on d.id = de.deal_id
      where de.equipment_id = p_equipment_id
        and d.closed_at is null
      order by d.updated_at desc
      limit 1
    ) d;

  return json_build_object(
    'equipment', v_equipment,
    'company', v_company,
    'badges', v_badges,
    'recent_service', coalesce(v_recent_service, '[]'::json),
    'open_deal', v_open_deal
  );
end;
$$;

comment on function public.get_asset_360(uuid) is 'Single-round-trip composite for Asset 360 page header + tabs.';
