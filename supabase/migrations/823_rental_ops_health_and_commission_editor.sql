-- 823_rental_ops_health_and_commission_editor.sql
--
-- L11.1 + L11.2 (rental world-class polish wave):
--   1. rental_ops_health — one workspace-guarded read RPC feeding the Rental
--      Command Center "Ops Health" panel: commission coverage, cycle-alert
--      resolution, availability-alert state, geofence signal quality. This is
--      the observation surface for the operate/observe/tune window after the
--      m822 release.
--   2. rental_set_contract_commissions — service-only multi-rep split editor
--      (m822 doctrine: commission mutation never ships with caller grants).
--      Splits must total 100; every recipient must belong to the contract's
--      workspace; removed reps are soft-deleted; returning reps are
--      resurrected in place because the m530 unique key
--      (rental_contract_id, salesperson_id) is NOT partial.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ops health aggregate
-- ---------------------------------------------------------------------------

create or replace function public.rental_ops_health(p_workspace_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_commission jsonb;
  v_cycle jsonb;
  v_availability jsonb;
  v_geofence jsonb;
begin
  perform public.rental_assert_workspace(p_workspace_id);

  -- Commission coverage over revenue-bearing contracts. The m822 trigger
  -- seeds attribution atomically, so anything surfacing here is a contract
  -- that predates the trigger or lost its originator — desk follow-up.
  with live as (
    select c.id, c.contract_number,
           exists (
             select 1 from public.rental_contract_commissions rc
             where rc.rental_contract_id = c.id
               and rc.workspace_id = c.workspace_id
               and rc.deleted_at is null
           ) as has_commission
    from public.rental_contracts c
    where c.workspace_id = p_workspace_id
      and c.deleted_at is null
      and c.lifecycle_state in ('reserved', 'on_rent', 'off_rent')
  )
  select jsonb_build_object(
    'live_contracts', count(*),
    'with_commission', count(*) filter (where has_commission),
    'coverage_pct', case when count(*) = 0 then null
      else round(100.0 * count(*) filter (where has_commission) / count(*), 1) end,
    'missing_count', count(*) filter (where not has_commission),
    'missing_sample', coalesce(
      (select jsonb_agg(m.contract_number)
       from (select contract_number from live
             where not has_commission
             order by contract_number limit 8) m),
      '[]'::jsonb)
  ) into v_commission
  from live;

  -- Cycle alerts: resolution = an invoice landed within 3 days of the alert.
  -- Alerts younger than 3 days are still inside their window and counted
  -- separately so the resolution rate is never unfairly dinged.
  with ev as (
    select ae.entity_id, ae.occurred_at,
           exists (
             select 1 from public.rental_invoices ri
             where ri.workspace_id = p_workspace_id
               and ri.rental_contract_id::text = ae.entity_id
               and ri.deleted_at is null
               and ri.status not in ('void', 'reversed')
               and ri.created_at >= ae.occurred_at
               and ri.created_at < ae.occurred_at + interval '3 days'
           ) as billed
    from public.analytics_events ae
    where ae.workspace_id = p_workspace_id
      and ae.flow_event_type = 'rental.cycle.due'
      and ae.occurred_at > now() - interval '30 days'
  )
  select jsonb_build_object(
    'alerts_30d', count(*),
    'in_window', count(*) filter (where occurred_at > now() - interval '3 days' and not billed),
    'billed_within_3d', count(*) filter (where billed),
    'resolution_pct', case
      when count(*) filter (where occurred_at <= now() - interval '3 days') = 0 then null
      else round(100.0 * count(*) filter (where billed and occurred_at <= now() - interval '3 days')
                 / count(*) filter (where occurred_at <= now() - interval '3 days'), 1) end,
    'invoices_posted_30d', (
      select count(*) from public.rental_invoices ri
      where ri.workspace_id = p_workspace_id
        and ri.deleted_at is null
        and ri.status not in ('void', 'reversed')
        and ri.created_at > now() - interval '30 days')
  ) into v_cycle
  from ev;

  -- Availability: alert volume plus the live per-day-minimum-headroom picture
  -- (m822 math). Definer context may call the internal pressure function.
  select jsonb_build_object(
    'alerts_30d', (
      select count(*) from public.analytics_events ae
      where ae.workspace_id = p_workspace_id
        and ae.flow_event_type = 'rental.availability.low'
        and ae.occurred_at > now() - interval '30 days'),
    'current_low', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'category', p.category,
         'fleet_count', p.fleet_count,
         'peak_demand', p.peak_demand,
         'headroom', p.headroom,
         'critical_date', p.critical_date) order by p.headroom, p.category)
       from public.rental_availability_pressure(current_date, current_date + 14) p
       where p.workspace_id = p_workspace_id
         and p.headroom <= 1),
      '[]'::jsonb)
  ) into v_availability;

  select jsonb_build_object(
    'active_jobsite_fences', (
      select count(*) from public.crm_geofences g
      where g.workspace_id = p_workspace_id
        and g.geofence_type = 'customer_jobsite'
        and g.is_active),
    'exit_events_30d', (
      select count(*) from public.analytics_events ae
      where ae.workspace_id = p_workspace_id
        and ae.flow_event_type = 'rental.geofence.exit'
        and ae.occurred_at > now() - interval '30 days'),
    'exit_events_7d', (
      select count(*) from public.analytics_events ae
      where ae.workspace_id = p_workspace_id
        and ae.flow_event_type = 'rental.geofence.exit'
        and ae.occurred_at > now() - interval '7 days')
  ) into v_geofence;

  return jsonb_build_object(
    'commission', v_commission,
    'cycle', v_cycle,
    'availability', v_availability,
    'geofence', v_geofence,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.rental_ops_health(text) from public, anon;
grant execute on function public.rental_ops_health(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Multi-rep commission splits (service-only)
-- ---------------------------------------------------------------------------

create or replace function public.rental_set_contract_commissions(
  p_workspace_id text,
  p_contract_id uuid,
  p_commissions jsonb,
  p_actor_id uuid default null
)
returns setof public.rental_contract_commissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.rental_contracts%rowtype;
  v_entry jsonb;
  v_salesperson uuid;
  v_pct numeric;
  v_role text;
  v_sum numeric := 0;
  v_ids uuid[] := '{}';
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_set_contract_commissions requires service_role'
      using errcode = '42501';
  end if;

  if p_commissions is null
     or jsonb_typeof(p_commissions) <> 'array'
     or jsonb_array_length(p_commissions) = 0 then
    raise exception 'commissions array required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_commissions) > 10 then
    raise exception 'too many commission splits (max 10)' using errcode = '22023';
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

  if p_actor_id is not null and not exists (
    select 1 from public.profile_workspaces pw
    where pw.profile_id = p_actor_id
      and pw.workspace_id = p_workspace_id
  ) then
    raise exception 'actor is not a member of the rental workspace'
      using errcode = '42501';
  end if;

  for v_entry in select * from jsonb_array_elements(p_commissions) loop
    v_salesperson := nullif(v_entry->>'salesperson_id', '')::uuid;
    v_pct := nullif(v_entry->>'split_pct', '')::numeric;
    v_role := nullif(btrim(coalesce(v_entry->>'role', '')), '');

    if v_salesperson is null then
      raise exception 'salesperson_id required on every split' using errcode = '22023';
    end if;
    if v_pct is null or v_pct <= 0 or v_pct > 100 then
      raise exception 'split_pct must be in (0, 100]' using errcode = '22023';
    end if;
    if v_salesperson = any(v_ids) then
      raise exception 'duplicate salesperson in splits' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.profile_workspaces pw
      where pw.profile_id = v_salesperson
        and pw.workspace_id = p_workspace_id
    ) then
      raise exception 'salesperson is not a member of the rental workspace'
        using errcode = '42501';
    end if;

    v_sum := v_sum + v_pct;
    v_ids := v_ids || v_salesperson;

    -- Resurrect-in-place: the m530 unique key includes soft-deleted rows.
    insert into public.rental_contract_commissions
      (workspace_id, rental_contract_id, salesperson_id, split_pct, role)
    values
      (p_workspace_id, p_contract_id, v_salesperson, round(v_pct, 2), v_role)
    on conflict (rental_contract_id, salesperson_id)
    do update set
      split_pct = excluded.split_pct,
      role = excluded.role,
      deleted_at = null,
      updated_at = now();
  end loop;

  if abs(v_sum - 100) > 0.01 then
    raise exception 'split_pct must total 100 (got %)', v_sum using errcode = '22023';
  end if;

  update public.rental_contract_commissions rc
  set deleted_at = now(), updated_at = now()
  where rc.rental_contract_id = p_contract_id
    and rc.workspace_id = p_workspace_id
    and rc.deleted_at is null
    and not (rc.salesperson_id = any(v_ids));

  return query
  select * from public.rental_contract_commissions rc
  where rc.rental_contract_id = p_contract_id
    and rc.workspace_id = p_workspace_id
    and rc.deleted_at is null
  order by rc.split_pct desc, rc.created_at;
end;
$$;

revoke all on function public.rental_set_contract_commissions(text, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.rental_set_contract_commissions(text, uuid, jsonb, uuid)
  to service_role;

commit;
