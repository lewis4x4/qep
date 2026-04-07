-- ============================================================================
-- Migration 177: Round 4 audit fixes
--
-- (a) P1 — get_fleet_radar "expensive" lens computed parts spend at the
--     COMPANY level (not per-equipment), so every machine in the list
--     showed the same lifetime total. Corrected to scope by fleet_id.
--
-- (b) P1 — backfill_customer_lifecycle_events inserted one row per deal
--     instead of one row per company, all with the same window-function
--     minimum timestamp. Rewritten to use DISTINCT ON (company_id).
-- ============================================================================

-- ── (a) get_fleet_radar — per-machine parts spend ────────────────────────

create or replace function public.get_fleet_radar(p_company_id uuid)
returns json
language plpgsql
security invoker
stable
as $$
declare
  v_aging json;
  v_expensive json;
  v_trade_up json;
  v_underutilized json;
  v_attachment_upsell json;
begin
  -- Lens 1: aging machines (unchanged)
  select coalesce(json_agg(row_to_json(e)), '[]'::json) into v_aging
    from (
      select e.id, e.name, e.make, e.model, e.year, e.engine_hours,
             'aging' as lens,
             'Engine hours past 4,000 — replacement window approaching' as reason
        from public.qrm_equipment e
        where e.company_id = p_company_id
          and e.deleted_at is null
          and e.engine_hours is not null
          and e.engine_hours >= 4000
        order by e.engine_hours desc
        limit 25
    ) e;

  -- Lens 2: expensive to maintain — now scoped PER EQUIPMENT via fleet_id
  select coalesce(json_agg(row_to_json(e)), '[]'::json) into v_expensive
    from (
      select e.id, e.name, e.make, e.model, e.year,
             coalesce((
               select sum(po.total)
               from public.parts_orders po
               where po.fleet_id = e.id
             ), 0) as lifetime_parts_spend,
             'expensive_to_maintain' as lens,
             'Lifetime parts spend on this machine crossing the cost-curve heuristic' as reason
        from public.qrm_equipment e
        where e.company_id = p_company_id
          and e.deleted_at is null
        order by e.engine_hours desc nulls last
        limit 25
    ) e
    where (e->>'lifetime_parts_spend')::numeric > 5000;

  -- Lens 3: trade-up windows (unchanged)
  select coalesce(json_agg(row_to_json(e)), '[]'::json) into v_trade_up
    from (
      select e.id, e.name, e.make, e.model, e.year, e.engine_hours,
             (public.get_asset_badges(e.id) ->> 'trade_up_score')::int as trade_up_score,
             'trade_up_window' as lens,
             'Trade-up score 70+ — high-priority commercial opportunity' as reason
        from public.qrm_equipment e
        where e.company_id = p_company_id
          and e.deleted_at is null
        order by e.engine_hours desc nulls last
        limit 50
    ) e
    where trade_up_score >= 70
    limit 25;

  -- Lens 4: under-utilized (unchanged)
  select coalesce(json_agg(row_to_json(e)), '[]'::json) into v_underutilized
    from (
      select e.id, e.name, e.make, e.model, e.year, e.engine_hours, e.updated_at,
             'underutilized' as lens,
             'No equipment activity in 30+ days — under-utilized asset' as reason
        from public.qrm_equipment e
        where e.company_id = p_company_id
          and e.deleted_at is null
          and e.updated_at < now() - interval '30 days'
        order by e.updated_at asc
        limit 25
    ) e;

  -- Lens 5: attachment upsell (unchanged)
  select coalesce(json_agg(row_to_json(e)), '[]'::json) into v_attachment_upsell
    from (
      select e.id, e.name, e.make, e.model, e.year,
             'attachment_upsell' as lens,
             'No attachments registered — upsell opportunity' as reason
        from public.qrm_equipment e
        where e.company_id = p_company_id
          and e.deleted_at is null
          and (e.metadata is null or not (e.metadata ? 'attachments') or jsonb_array_length(coalesce(e.metadata->'attachments', '[]'::jsonb)) = 0)
        order by e.updated_at desc
        limit 25
    ) e;

  return json_build_object(
    'aging',             v_aging,
    'expensive',         v_expensive,
    'trade_up',          v_trade_up,
    'underutilized',     v_underutilized,
    'attachment_upsell', v_attachment_upsell
  );
end;
$$;

comment on function public.get_fleet_radar(uuid) is
  'Account-level fleet opportunity radar — five lenses. Round-4 fix: expensive lens now scopes parts_orders.fleet_id per-machine.';

-- ── (b) backfill_customer_lifecycle_events — one row per company ─────────

create or replace function public.backfill_customer_lifecycle_events()
returns table (event_type text, inserted_count bigint)
language plpgsql
security invoker
as $$
begin
  -- first_quote backfill: one row per company, earliest deal as the source
  return query
    with first_deal_per_company as (
      select distinct on (d.company_id)
        d.workspace_id, d.company_id, d.id as deal_id, d.created_at
      from public.qrm_deals d
      where d.company_id is not null
      order by d.company_id, d.created_at asc
    ),
    inserted as (
      insert into public.customer_lifecycle_events
        (workspace_id, company_id, event_type, event_at, metadata, source_table, source_id)
      select
        fdpc.workspace_id,
        fdpc.company_id,
        'first_quote',
        fdpc.created_at,
        jsonb_build_object('deal_id', fdpc.deal_id),
        'qrm_deals',
        fdpc.deal_id
      from first_deal_per_company fdpc
      where not exists (
        select 1 from public.customer_lifecycle_events cle
        where cle.company_id = fdpc.company_id and cle.event_type = 'first_quote'
      )
      returning 1
    )
    select 'first_quote'::text, count(*)::bigint from inserted;

  -- first_service backfill: one row per company
  return query
    with first_sj_per_company as (
      select distinct on (sj.customer_id)
        sj.workspace_id, sj.customer_id as company_id, sj.id as sj_id, sj.created_at
      from public.service_jobs sj
      where sj.customer_id is not null
      order by sj.customer_id, sj.created_at asc
    ),
    inserted as (
      insert into public.customer_lifecycle_events
        (workspace_id, company_id, event_type, event_at, metadata, source_table, source_id)
      select
        fspc.workspace_id,
        fspc.company_id,
        'first_service',
        fspc.created_at,
        jsonb_build_object('service_job_id', fspc.sj_id),
        'service_jobs',
        fspc.sj_id
      from first_sj_per_company fspc
      where not exists (
        select 1 from public.customer_lifecycle_events cle
        where cle.company_id = fspc.company_id and cle.event_type = 'first_service'
      )
      returning 1
    )
    select 'first_service'::text, count(*)::bigint from inserted;
end;
$$;

comment on function public.backfill_customer_lifecycle_events() is
  'One-shot backfill: one lifecycle event per company per type, earliest occurrence. Round-4 fix: use DISTINCT ON instead of window function to avoid N rows per company.';
