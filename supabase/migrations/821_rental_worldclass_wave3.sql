-- 821_rental_worldclass_wave3.sql
--
-- Wave 3 rental world-class:
--   1. Default commission split writer (originated_by → 100% attribution)
--   2. rental.availability.low + rental.cycle.due emitters in lifecycle scan
--   3. Jobsite geofence upsert from lat/lng/radius (PostGIS buffer)

begin;

-- ---------------------------------------------------------------------------
-- 1. Commission attribution
-- ---------------------------------------------------------------------------

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
declare
  v_contract public.rental_contracts%rowtype;
  v_salesperson uuid;
  v_row public.rental_contract_commissions%rowtype;
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'service_role') then
    raise exception 'rental_ensure_default_commission requires authenticated or service_role'
      using errcode = '42501';
  end if;

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

  -- If any active split exists, return the salesperson's row (or first).
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
    select 1 from public.rental_contract_commissions rc
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

revoke all on function public.rental_ensure_default_commission(text, uuid, uuid)
  from public, anon;
grant execute on function public.rental_ensure_default_commission(text, uuid, uuid)
  to authenticated, service_role;

comment on function public.rental_ensure_default_commission(text, uuid, uuid) is
  'Wave 3: ensure a default 100% commission split for the originating salesperson if none exists.';

-- Auto-seed when a contract first goes on rent.
create or replace function public.rental_seed_commission_on_rent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lifecycle_state = 'on_rent'
     and (tg_op = 'INSERT' or old.lifecycle_state is distinct from 'on_rent')
     and new.originated_by is not null
     and new.deleted_at is null then
    perform public.rental_ensure_default_commission(
      new.workspace_id, new.id, new.originated_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rental_seed_commission_on_rent on public.rental_contracts;
create trigger trg_rental_seed_commission_on_rent
  after insert or update of lifecycle_state, originated_by
  on public.rental_contracts
  for each row
  execute function public.rental_seed_commission_on_rent();

-- ---------------------------------------------------------------------------
-- 2. Lifecycle scan: availability.low + cycle.due
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
  -- rental.nearing_end
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

  -- rental.overdue
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

  -- rental.coi.expiring
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

  -- rental.unit.idle_aging
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

  -- rental.cycle.due: on-rent contracts with last cycle invoice ending within 2 days
  -- (or never billed and on_rent_at older than 26 days).
  for v_row in
    select c.id, c.workspace_id, c.contract_number, c.equipment_id, c.qrm_company_id,
           c.on_rent_at,
           (
             select max(ri.period_end)
             from public.rental_invoices ri
             where ri.rental_contract_id = c.id
               and ri.deleted_at is null
               and ri.status not in ('void', 'reversed')
           ) as last_period_end
    from public.rental_contracts c
    where c.deleted_at is null
      and c.lifecycle_state = 'on_rent'
      and (
        (
          select max(ri.period_end)
          from public.rental_invoices ri
          where ri.rental_contract_id = c.id
            and ri.deleted_at is null
            and ri.status not in ('void', 'reversed')
        ) between current_date - 1 and current_date + 2
        or (
          not exists (
            select 1 from public.rental_invoices ri
            where ri.rental_contract_id = c.id
              and ri.deleted_at is null
              and ri.status not in ('void', 'reversed')
          )
          and c.on_rent_at is not null
          and c.on_rent_at::date <= current_date - 26
        )
      )
      and not exists (
        select 1 from public.analytics_events ae
        where ae.flow_event_type = 'rental.cycle.due'
          and ae.entity_id = c.id::text
          and ae.occurred_at > now() - interval '20 hours')
  loop
    perform public.emit_event('rental.cycle.due', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object(
        'rental_id', v_row.id,
        'contract_number', v_row.contract_number,
        'last_period_end', v_row.last_period_end,
        'equipment_id', v_row.equipment_id,
        'qrm_company_id', v_row.qrm_company_id
      ),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  end loop;

  -- rental.availability.low: category fleets with headroom ≤ 1 for the next 14 days.
  for v_row in
    with fleet as (
      select e.workspace_id, e.category::text as category, count(*)::integer as fleet_count
      from public.qrm_equipment e
      where e.ownership = 'rental_fleet'
        and e.availability <> 'decommissioned'
        and e.category is not null
        and e.deleted_at is null
      group by e.workspace_id, e.category::text
    ),
    demand as (
      select e.workspace_id, e.category::text as category, count(distinct l.id)::integer as demand_count
      from public.rental_contract_lines l
      join public.qrm_equipment e on e.id = l.equipment_id
      where l.deleted_at is null
        and l.status in ('active', 'held', 'off_rent', 'quoted')
        and coalesce(l.rental_start_at::date, current_date) <= current_date + 14
        and coalesce(l.rental_end_at::date, current_date + 14) >= current_date
      group by e.workspace_id, e.category::text
    )
    select f.workspace_id, f.category, f.fleet_count,
           coalesce(d.demand_count, 0) as demand_count,
           f.fleet_count - coalesce(d.demand_count, 0) as headroom
    from fleet f
    left join demand d
      on d.workspace_id = f.workspace_id and d.category = f.category
    where f.fleet_count > 0
      and f.fleet_count - coalesce(d.demand_count, 0) <= 1
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
          'overlapping_demand', v_row.demand_count,
          'headroom', v_row.headroom,
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

-- ---------------------------------------------------------------------------
-- 3. Jobsite geofence upsert (lat/lng/radius → circular geography)
-- ---------------------------------------------------------------------------

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
  if coalesce((select auth.role()), '') not in ('authenticated', 'service_role') then
    raise exception 'rental_upsert_jobsite_geofence requires authenticated or service_role'
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

  v_poly := st_buffer(
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    v_radius
  );

  -- Upsert by company + name within workspace for active jobsites.
  select g.id into v_id
  from public.crm_geofences g
  where g.workspace_id = p_workspace_id
    and g.linked_company_id = p_company_id
    and g.geofence_type = 'customer_jobsite'
    and g.is_active
    and lower(g.name) = lower(v_name)
  limit 1;

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
) from public, anon;
grant execute on function public.rental_upsert_jobsite_geofence(
  text, uuid, text, double precision, double precision, numeric, uuid
) to authenticated, service_role;

comment on function public.rental_upsert_jobsite_geofence(
  text, uuid, text, double precision, double precision, numeric, uuid
) is
  'Wave 3: create/update a circular customer_jobsite geofence from lat/lng/radius so rental geofence exit detection can fire.';

commit;
