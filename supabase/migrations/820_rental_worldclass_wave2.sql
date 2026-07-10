-- 820_rental_worldclass_wave2.sql
--
-- Wave 2 rental world-class:
--   1. Geofence writer: evaluate telematics GPS against jobsite geofences and
--      insert geofence_events so the existing exit trigger + flow can fire.
--   2. Wire evaluation into rental_intelligence_scan (already cron'd daily)
--      and add a frequent service-safe scan for on-rent units.
--   3. Workspace conversion board RPC ranked from rental/RPO truth.

begin;

-- ---------------------------------------------------------------------------
-- 1. Geofence crossing detector (writer for geofence_events)
-- ---------------------------------------------------------------------------

create or replace function public.rental_evaluate_geofence_crossings(
  p_workspace_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row record;
  v_inside boolean;
  v_last_type text;
  v_exited integer := 0;
  v_entered integer := 0;
  v_scanned integer := 0;
begin
  if coalesce((select auth.role()), '') not in ('service_role', 'authenticated') then
    raise exception 'rental_evaluate_geofence_crossings requires authenticated or service_role'
      using errcode = '42501';
  end if;

  for v_row in
    select
      c.id as contract_id,
      c.workspace_id,
      c.contract_number,
      c.qrm_company_id,
      c.equipment_id,
      tf.last_lat::double precision as lat,
      tf.last_lng::double precision as lng,
      tf.last_reading_at,
      g.id as geofence_id,
      g.name as geofence_name
    from public.rental_contracts c
    join public.telematics_feeds tf
      on tf.equipment_id = c.equipment_id
     and tf.workspace_id = c.workspace_id
     and tf.is_active
    join public.crm_geofences g
      on g.workspace_id = c.workspace_id
     and g.is_active
     and g.geofence_type = 'customer_jobsite'
     and (
       g.linked_company_id is null
       or g.linked_company_id = c.qrm_company_id
     )
    where c.deleted_at is null
      and c.lifecycle_state in ('on_rent', 'off_rent')
      and c.equipment_id is not null
      and tf.last_lat is not null
      and tf.last_lng is not null
      and tf.last_reading_at is not null
      and tf.last_reading_at > now() - interval '6 hours'
      and (p_workspace_id is null or c.workspace_id = p_workspace_id)
  loop
    v_scanned := v_scanned + 1;

    select st_covers(
      g.polygon,
      st_setsrid(st_makepoint(v_row.lng, v_row.lat), 4326)::extensions.geography
    )
    into v_inside
    from public.crm_geofences g
    where g.id = v_row.geofence_id;

    select ge.event_type
    into v_last_type
    from public.geofence_events ge
    where ge.equipment_id = v_row.equipment_id
      and ge.geofence_id = v_row.geofence_id
    order by ge.event_at desc
    limit 1;

    if v_inside is true then
      -- Only enter when last state was not already entered (first sight or re-entry).
      if v_last_type is distinct from 'entered' then
        insert into public.geofence_events (
          workspace_id, equipment_id, geofence_id, event_type, event_at,
          reading_lat, reading_lng, ai_confidence
        ) values (
          v_row.workspace_id, v_row.equipment_id, v_row.geofence_id, 'entered',
          coalesce(v_row.last_reading_at, now()),
          v_row.lat, v_row.lng, null
        );
        v_entered := v_entered + 1;
      end if;
    elsif v_last_type = 'entered' then
      -- Exit only after a confirmed enter → outside transition (no spam for
      -- units that never occupied the jobsite polygon).
      if not exists (
        select 1 from public.geofence_events ge
        where ge.equipment_id = v_row.equipment_id
          and ge.geofence_id = v_row.geofence_id
          and ge.event_type = 'exited'
          and ge.event_at > now() - interval '6 hours'
      ) then
        insert into public.geofence_events (
          workspace_id, equipment_id, geofence_id, event_type, event_at,
          reading_lat, reading_lng, ai_confidence
        ) values (
          v_row.workspace_id, v_row.equipment_id, v_row.geofence_id, 'exited',
          coalesce(v_row.last_reading_at, now()),
          v_row.lat, v_row.lng, null
        );
        v_exited := v_exited + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'scanned_pairs', v_scanned,
    'entered_events', v_entered,
    'exited_events', v_exited
  );
end;
$$;

revoke all on function public.rental_evaluate_geofence_crossings(text)
  from public, anon;
grant execute on function public.rental_evaluate_geofence_crossings(text)
  to authenticated, service_role;

comment on function public.rental_evaluate_geofence_crossings(text) is
  'Wave 2: compares active telematics GPS for on-rent units to customer_jobsite geofences and writes geofence_events so trg_rental_geofence_exit can fire.';

-- Hook into the existing intelligence scan (daily cron already registered).
create or replace function public.rental_intelligence_scan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_forecasts integer;
  v_overages integer;
  v_geofence jsonb;
begin
  v_forecasts := public.rental_forecast_demand();
  v_overages := public.rental_telematics_overage_check();
  v_geofence := public.rental_evaluate_geofence_crossings(null);
  return jsonb_build_object(
    'forecast_rows', v_forecasts,
    'overage_events', v_overages,
    'geofence', v_geofence
  );
end;
$$;

-- Frequent scan for live theft/unauthorized-move detection (every 15 min).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'rental-geofence-evaluate') then
      perform cron.unschedule('rental-geofence-evaluate');
    end if;
    perform cron.schedule(
      'rental-geofence-evaluate',
      '*/15 * * * *',
      $cron$select public.rental_evaluate_geofence_crossings(null)$cron$
    );
  end if;
exception
  when others then
    raise notice 'rental-geofence-evaluate cron registration failed: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Workspace conversion board ranked from rental/RPO truth
-- ---------------------------------------------------------------------------

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
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'service_role') then
    raise exception 'rental_conversion_board requires authenticated or service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_workspace_id), '') is null then
    raise exception 'workspace is required' using errcode = '22023';
  end if;

  return coalesce((
    with company_stats as (
      select
        rc.qrm_company_id as company_id,
        count(*)::integer as contract_count,
        count(*) filter (
          where rc.lifecycle_state in ('reserved', 'on_rent', 'off_rent', 'returned')
        )::integer as open_contract_count,
        coalesce(sum(ri.total_cents) filter (
          where ri.id is not null
            and ri.deleted_at is null
            and ri.reversal_of_invoice_id is null
            and ri.period_start >= (current_date - 90)
        ), 0)::bigint as trailing_90d_billed_cents,
        coalesce(sum(rc.rpo_credit_accrued_cents) filter (
          where rc.rpo_eligible
        ), 0)::bigint as rpo_accrued_cents,
        count(*) filter (
          where rc.rpo_eligible
            and coalesce(rc.rpo_credit_accrued_cents, 0) > 0
        )::integer as active_rpo_count,
        max(rc.rpo_purchase_price_cents) filter (
          where rc.rpo_eligible
        ) as max_rpo_purchase_price_cents
      from public.rental_contracts rc
      left join public.rental_invoices ri
        on ri.rental_contract_id = rc.id
      where rc.workspace_id = p_workspace_id
        and rc.deleted_at is null
        and rc.qrm_company_id is not null
      group by rc.qrm_company_id
    )
    select jsonb_agg(row_to_json(t)::jsonb order by t.rank_score desc, t.trailing_90d_billed_cents desc)
    from (
      select
        cs.company_id,
        co.name as company_name,
        cs.contract_count,
        cs.open_contract_count,
        cs.trailing_90d_billed_cents,
        cs.rpo_accrued_cents,
        cs.active_rpo_count,
        cs.max_rpo_purchase_price_cents,
        (
          (cs.active_rpo_count * 100) +
          least(cs.contract_count, 20) * 5 +
          least(cs.trailing_90d_billed_cents / 10000, 50) +
          case when cs.rpo_accrued_cents > 0 then 40 else 0 end
        )::integer as rank_score,
        case
          when cs.active_rpo_count > 0 and cs.rpo_accrued_cents >= coalesce(cs.max_rpo_purchase_price_cents, 0) / 2
            then 'high'
          when cs.active_rpo_count > 0 or cs.contract_count >= 3
            then 'medium'
          else 'low'
        end as confidence
      from company_stats cs
      join public.qrm_companies co
        on co.id = cs.company_id
       and co.deleted_at is null
      where cs.contract_count > 0
      order by rank_score desc, trailing_90d_billed_cents desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.rental_conversion_board(text, integer)
  from public, anon;
grant execute on function public.rental_conversion_board(text, integer)
  to authenticated, service_role;

comment on function public.rental_conversion_board(text, integer) is
  'Wave 2: ranks companies by live rental spend + RPO accrual for the conversion queue.';

commit;
