-- 822_rental_worldclass_security_and_signal_hardening.sql
--
-- Fix-forward for applied migrations 820/821:
--   1. Restore tenant isolation / least privilege on Wave 2/3 RPCs.
--   2. Bind commission attribution to a profile in the contract workspace.
--   3. Compute cycle.due from the next billable 28-day boundary.
--   4. Compute availability.low from minimum daily headroom, not the sum of
--      every booking that touches the 14-day window.

begin;

-- ---------------------------------------------------------------------------
-- 1. Wave 2/3 RPC authorization
-- ---------------------------------------------------------------------------

-- The geofence evaluator is an internal cron/runner surface. The function
-- body already accepts service_role/direct DB execution; remove browser access.
revoke all on function public.rental_evaluate_geofence_crossings(text)
  from public, anon, authenticated;
grant execute on function public.rental_evaluate_geofence_crossings(text)
  to service_role;

-- Keep the conversion board browser-callable, but put the existing body behind
-- the workspace guard introduced in migration 779.
do $$
begin
  if to_regprocedure('public.rental_conversion_board_v1_unchecked(text,integer)') is null then
    alter function public.rental_conversion_board(text, integer)
      rename to rental_conversion_board_v1_unchecked;
  end if;
end $$;

revoke all on function public.rental_conversion_board_v1_unchecked(text, integer)
  from public, anon, authenticated, service_role;

create or replace function public.rental_conversion_board(
  p_workspace_id text,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.rental_assert_workspace(p_workspace_id);
  return public.rental_conversion_board_v1_unchecked(p_workspace_id, p_limit);
end;
$$;

revoke all on function public.rental_conversion_board(text, integer)
  from public, anon;
grant execute on function public.rental_conversion_board(text, integer)
  to authenticated, service_role;

-- Commission creation is an internal mutation. The edge functions call the
-- public service-only wrapper; the on-rent trigger calls the private internal
-- implementation so an authenticated contract transition still seeds safely.
create or replace function public.rental_ensure_default_commission_internal(
  p_workspace_id text,
  p_contract_id uuid,
  p_salesperson_id uuid default null
)
returns public.rental_contract_commissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.rental_contracts%rowtype;
  v_salesperson uuid;
  v_row public.rental_contract_commissions%rowtype;
begin
  select * into v_contract
  from public.rental_contracts c
  where c.id = p_contract_id
    and c.workspace_id = p_workspace_id
    and c.deleted_at is null
  for update;
  if not found then
    raise exception 'rental contract not found' using errcode = 'P0002';
  end if;

  v_salesperson := coalesce(p_salesperson_id, v_contract.originated_by);
  if v_salesperson is null then
    raise exception 'no salesperson available for commission attribution'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profile_workspaces pw
    where pw.profile_id = v_salesperson
      and pw.workspace_id = p_workspace_id
  ) then
    raise exception 'salesperson is not a member of the rental workspace'
      using errcode = '42501';
  end if;

  select * into v_row
  from public.rental_contract_commissions rc
  where rc.rental_contract_id = p_contract_id
    and rc.workspace_id = p_workspace_id
    and rc.deleted_at is null
    and rc.salesperson_id = v_salesperson
  limit 1;
  if found then
    return v_row;
  end if;

  if exists (
    select 1
    from public.rental_contract_commissions rc
    where rc.rental_contract_id = p_contract_id
      and rc.workspace_id = p_workspace_id
      and rc.deleted_at is null
  ) then
    select * into v_row
    from public.rental_contract_commissions rc
    where rc.rental_contract_id = p_contract_id
      and rc.workspace_id = p_workspace_id
      and rc.deleted_at is null
    order by rc.created_at
    limit 1;
    return v_row;
  end if;

  insert into public.rental_contract_commissions (
    workspace_id, rental_contract_id, salesperson_id, split_pct, role
  ) values (
    p_workspace_id, p_contract_id, v_salesperson, 100, 'originator'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rental_ensure_default_commission_internal(text, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.rental_ensure_default_commission(
  p_workspace_id text,
  p_contract_id uuid,
  p_salesperson_id uuid default null
)
returns public.rental_contract_commissions
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_ensure_default_commission requires service_role'
      using errcode = '42501';
  end if;
  return public.rental_ensure_default_commission_internal(
    p_workspace_id, p_contract_id, p_salesperson_id
  );
end;
$$;

revoke all on function public.rental_ensure_default_commission(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rental_ensure_default_commission(text, uuid, uuid)
  to service_role;

create or replace function public.rental_seed_commission_on_rent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.originated_by is not null
     and new.deleted_at is null then
    if tg_op = 'INSERT'
       or (new.lifecycle_state = 'on_rent'
           and old.lifecycle_state is distinct from 'on_rent') then
      perform public.rental_ensure_default_commission_internal(
        new.workspace_id, new.id, new.originated_by
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.rental_seed_commission_on_rent()
  from public, anon, authenticated, service_role;

-- Jobsite fence mutation is routed through rental-ops and therefore requires
-- service_role. Validate both the company and optional actor in the workspace.
create or replace function public.rental_upsert_jobsite_geofence(
  p_workspace_id text,
  p_company_id uuid,
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_radius_meters numeric default 250,
  p_actor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_radius numeric := least(greatest(coalesce(p_radius_meters, 250), 25), 5000);
  v_poly extensions.geography;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_upsert_jobsite_geofence requires service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_workspace_id), '') is null or p_company_id is null then
    raise exception 'workspace and company are required' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'valid lat/lng required' using errcode = '22023';
  end if;
  if v_name is null then
    v_name := 'Jobsite';
  end if;

  if not exists (
    select 1 from public.qrm_companies c
    where c.id = p_company_id
      and c.workspace_id = p_workspace_id
      and c.deleted_at is null
  ) then
    raise exception 'company not found in workspace' using errcode = 'P0002';
  end if;
  if p_actor_id is not null and not exists (
    select 1 from public.profile_workspaces pw
    where pw.profile_id = p_actor_id
      and pw.workspace_id = p_workspace_id
  ) then
    raise exception 'actor is not a member of the rental workspace'
      using errcode = '42501';
  end if;

  v_poly := st_buffer(
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    v_radius
  );

  -- Serialize the natural upsert key even when no row exists yet.
  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id || ':' || p_company_id::text || ':' || lower(v_name),
    0
  ));

  select g.id into v_id
  from public.crm_geofences g
  where g.workspace_id = p_workspace_id
    and g.linked_company_id = p_company_id
    and g.geofence_type = 'customer_jobsite'
    and g.is_active
    and lower(g.name) = lower(v_name)
  order by g.created_at
  limit 1
  for update;

  if v_id is not null then
    update public.crm_geofences
    set polygon = v_poly,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'center_lat', p_lat,
          'center_lng', p_lng,
          'radius_meters', v_radius,
          'updated_by', p_actor_id,
          'source', 'rental_upsert_jobsite_geofence'
        ),
        updated_at = now()
    where id = v_id;
  else
    insert into public.crm_geofences (
      workspace_id, name, geofence_type, polygon, linked_company_id,
      metadata, is_active, created_by
    ) values (
      p_workspace_id, v_name, 'customer_jobsite', v_poly, p_company_id,
      jsonb_build_object(
        'center_lat', p_lat,
        'center_lng', p_lng,
        'radius_meters', v_radius,
        'source', 'rental_upsert_jobsite_geofence'
      ),
      true,
      p_actor_id
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.rental_upsert_jobsite_geofence(
  text, uuid, text, double precision, double precision, numeric, uuid
) from public, anon, authenticated;
grant execute on function public.rental_upsert_jobsite_geofence(
  text, uuid, text, double precision, double precision, numeric, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Correct signal candidate calculations
-- ---------------------------------------------------------------------------

create or replace function public.rental_cycle_due_candidates(
  p_as_of date default current_date,
  p_lookahead_days integer default 2
)
returns table (
  id uuid,
  workspace_id text,
  contract_number text,
  equipment_id uuid,
  qrm_company_id uuid,
  on_rent_at timestamptz,
  last_period_end date,
  next_cycle_due date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.workspace_id,
    c.contract_number,
    c.equipment_id,
    c.qrm_company_id,
    c.on_rent_at,
    invoice.last_period_end,
    case
      when invoice.last_period_end is null then c.on_rent_at::date + 28
      else invoice.last_period_end + 29
    end as next_cycle_due
  from public.rental_contracts c
  left join lateral (
    select max(ri.period_end) as last_period_end
    from public.rental_invoices ri
    where ri.workspace_id = c.workspace_id
      and ri.rental_contract_id = c.id
      and ri.deleted_at is null
      and ri.status not in ('void', 'reversed')
  ) invoice on true
  where c.deleted_at is null
    and c.lifecycle_state = 'on_rent'
    and c.on_rent_at is not null
    and case
      when invoice.last_period_end is null then c.on_rent_at::date + 28
      else invoice.last_period_end + 29
    end <= p_as_of + least(greatest(coalesce(p_lookahead_days, 2), 0), 14)
$$;

revoke all on function public.rental_cycle_due_candidates(date, integer)
  from public, anon, authenticated, service_role;

create or replace function public.rental_availability_pressure(
  p_from date default current_date,
  p_to date default current_date + 14
)
returns table (
  workspace_id text,
  category text,
  fleet_count integer,
  peak_demand integer,
  headroom integer,
  critical_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d.day::date as day
    from generate_series(p_from, p_to, interval '1 day') d(day)
    where p_to >= p_from and p_to - p_from <= 31
  ),
  categories as (
    select
      e.workspace_id,
      e.category::text as category,
      count(*) filter (
        where coalesce(e.readiness_status::text, 'available') <> 'in_service'
      )::integer as fleet_count
    from public.qrm_equipment e
    where e.ownership = 'rental_fleet'
      and e.availability <> 'decommissioned'
      and e.category is not null
      and e.deleted_at is null
    group by e.workspace_id, e.category::text
  ),
  commitments as (
    select
      l.workspace_id,
      e.category::text as category,
      coalesce(l.rental_start_at::date, p_from) as starts_on,
      coalesce(l.rental_end_at::date, p_to) as ends_on
    from public.rental_contract_lines l
    join public.qrm_equipment e
      on e.id = l.equipment_id
     and e.workspace_id = l.workspace_id
    where l.deleted_at is null
      and l.status in ('active', 'held', 'off_rent')
      and e.category is not null
      and not exists (
        select 1
        from public.rental_reservation_holds active_hold
        where active_hold.rental_contract_line_id = l.id
          and active_hold.status = 'active'
          and active_hold.deleted_at is null
      )
    union all
    select
      h.workspace_id,
      coalesce(e.category::text, h.equipment_category) as category,
      h.hold_start as starts_on,
      h.hold_end as ends_on
    from public.rental_reservation_holds h
    left join public.qrm_equipment e
      on e.id = h.equipment_id
     and e.workspace_id = h.workspace_id
    where h.status = 'active'
      and h.deleted_at is null
      and coalesce(e.category::text, h.equipment_category) is not null
  ),
  daily as (
    select
      c.workspace_id,
      c.category,
      c.fleet_count,
      d.day,
      count(k.*) filter (
        where k.starts_on <= d.day and k.ends_on >= d.day
      )::integer as demand_count
    from categories c
    cross join days d
    left join commitments k
      on k.workspace_id = c.workspace_id
     and k.category = c.category
     and k.starts_on <= d.day
     and k.ends_on >= d.day
    group by c.workspace_id, c.category, c.fleet_count, d.day
  ),
  ranked as (
    select
      d.*,
      row_number() over (
        partition by d.workspace_id, d.category
        order by d.fleet_count - d.demand_count asc, d.demand_count desc, d.day asc
      ) as pressure_rank
    from daily d
  )
  select
    r.workspace_id,
    r.category,
    r.fleet_count,
    r.demand_count as peak_demand,
    r.fleet_count - r.demand_count as headroom,
    r.day as critical_date
  from ranked r
  where r.pressure_rank = 1
$$;

revoke all on function public.rental_availability_pressure(date, date)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Lifecycle scan using the corrected candidates
-- ---------------------------------------------------------------------------

create or replace function public.rental_lifecycle_scan()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emitted integer := 0;
  v_row record;
begin
  for v_row in
    select c.id, c.workspace_id, c.contract_number,
           coalesce(c.approved_end_date, c.requested_end_date) as ends_at,
           c.equipment_id, c.qrm_company_id
    from public.rental_contracts c
    where c.deleted_at is null and c.lifecycle_state = 'on_rent'
      and coalesce(c.approved_end_date, c.requested_end_date)
          between current_date and current_date + 7
      and not exists (
        select 1 from public.analytics_events ae
        where ae.flow_event_type = 'rental.nearing_end'
          and ae.entity_id = c.id::text and ae.occurred_at > now() - interval '20 hours')
  loop
    perform public.emit_event('rental.nearing_end', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object('rental_id', v_row.id, 'contract_number', v_row.contract_number,
        'ends_at', v_row.ends_at, 'equipment_id', v_row.equipment_id,
        'qrm_company_id', v_row.qrm_company_id),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  end loop;

  for v_row in
    select c.id, c.workspace_id, c.contract_number,
           coalesce(c.approved_end_date, c.requested_end_date) as ends_at,
           c.lifecycle_state, c.equipment_id, c.qrm_company_id
    from public.rental_contracts c
    where c.deleted_at is null and c.lifecycle_state in ('on_rent', 'off_rent')
      and coalesce(c.approved_end_date, c.requested_end_date) < current_date
      and not exists (
        select 1 from public.analytics_events ae
        where ae.flow_event_type = 'rental.overdue'
          and ae.entity_id = c.id::text and ae.occurred_at > now() - interval '20 hours')
  loop
    perform public.emit_event('rental.overdue', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object('rental_id', v_row.id, 'contract_number', v_row.contract_number,
        'ends_at', v_row.ends_at, 'lifecycle_state', v_row.lifecycle_state,
        'days_overdue', current_date - v_row.ends_at,
        'equipment_id', v_row.equipment_id, 'qrm_company_id', v_row.qrm_company_id),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  end loop;

  for v_row in
    select c.id, c.workspace_id, c.contract_number, c.coi_expires_at, c.qrm_company_id
    from public.rental_contracts c
    where c.deleted_at is null and c.lifecycle_state in ('reserved', 'on_rent', 'off_rent')
      and c.coi_required and c.coi_expires_at is not null
      and c.coi_expires_at between current_date and current_date + 14
      and not exists (
        select 1 from public.analytics_events ae
        where ae.flow_event_type = 'rental.coi.expiring'
          and ae.entity_id = c.id::text and ae.occurred_at > now() - interval '20 hours')
  loop
    perform public.emit_event('rental.coi.expiring', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object('rental_id', v_row.id, 'contract_number', v_row.contract_number,
        'coi_expires_at', v_row.coi_expires_at, 'qrm_company_id', v_row.qrm_company_id),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  end loop;

  for v_row in
    select c.id, c.workspace_id, c.contract_number, c.off_rent_at, c.equipment_id
    from public.rental_contracts c
    where c.deleted_at is null and c.lifecycle_state = 'off_rent'
      and c.off_rent_at < now() - interval '3 days'
      and not exists (
        select 1 from public.analytics_events ae
        where ae.flow_event_type = 'rental.unit.idle_aging'
          and ae.entity_id = c.id::text and ae.occurred_at > now() - interval '20 hours')
  loop
    perform public.emit_event('rental.unit.idle_aging', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object('rental_id', v_row.id, 'contract_number', v_row.contract_number,
        'off_rent_at', v_row.off_rent_at,
        'idle_days', extract(day from now() - v_row.off_rent_at)::int,
        'equipment_id', v_row.equipment_id),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  end loop;

  for v_row in
    select due.*
    from public.rental_cycle_due_candidates(current_date, 2) due
    where not exists (
      select 1 from public.analytics_events ae
      where ae.flow_event_type = 'rental.cycle.due'
        and ae.entity_id = due.id::text
        and ae.occurred_at > now() - interval '20 hours')
  loop
    perform public.emit_event('rental.cycle.due', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object(
        'rental_id', v_row.id,
        'contract_number', v_row.contract_number,
        'last_period_end', v_row.last_period_end,
        'next_cycle_due', v_row.next_cycle_due,
        'equipment_id', v_row.equipment_id,
        'qrm_company_id', v_row.qrm_company_id
      ),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  end loop;

  for v_row in
    select pressure.*
    from public.rental_availability_pressure(current_date, current_date + 14) pressure
    where pressure.headroom <= 1
  loop
    if not exists (
      select 1 from public.analytics_events ae
      where ae.flow_event_type = 'rental.availability.low'
        and ae.entity_id = v_row.workspace_id || ':' || v_row.category
        and ae.occurred_at > now() - interval '20 hours'
    ) then
      perform public.emit_event(
        'rental.availability.low',
        'rental',
        'rental_category',
        v_row.workspace_id || ':' || v_row.category,
        jsonb_build_object(
          'category', v_row.category,
          'fleet_count', v_row.fleet_count,
          'overlapping_demand', v_row.peak_demand,
          'headroom', v_row.headroom,
          'critical_date', v_row.critical_date,
          'window_days', 14
        ),
        v_row.workspace_id
      );
      v_emitted := v_emitted + 1;
    end if;
  end loop;

  return v_emitted;
end;
$$;

revoke all on function public.rental_lifecycle_scan()
  from public, anon, authenticated;
grant execute on function public.rental_lifecycle_scan()
  to service_role;

commit;
