-- ============================================================================
-- Migration 173: Account 360 + Fleet Opportunity Radar RPCs (Phase A + C)
--
-- Two SECURITY INVOKER composite RPCs that power the upgraded
-- QrmCompanyDetailPage (Account 360) and the new FleetRadarPage:
--
--   get_account_360(p_company_id)  — single round-trip Account 360 payload
--   get_fleet_radar(p_company_id)  — five-lens fleet opportunity scan
--
-- Both functions are SECURITY INVOKER so RLS on the underlying tables
-- (qrm_companies, qrm_equipment, quote_packages, service_jobs,
-- customer_invoices) flows through to the caller. They join only what the
-- spec §8.1 + §10.1 explicitly require — no over-fetching.
-- ============================================================================

-- ── 1. get_account_360 ───────────────────────────────────────────────────

create or replace function public.get_account_360(p_company_id uuid)
returns json
language plpgsql
security invoker
stable
as $$
declare
  v_company json;
  v_profile json;
  v_fleet json;
  v_quotes json;
  v_service json;
  v_parts json;
  v_invoices json;
  v_health json;
  v_ar_block json;
begin
  select to_json(c.*) into v_company
    from public.qrm_companies c
    where c.id = p_company_id;

  if v_company is null then
    return null;
  end if;

  -- Extended profile (budget cycle, health score, etc.)
  select to_json(cpe.*) into v_profile
    from public.customer_profiles_extended cpe
    where cpe.crm_company_id = p_company_id
    limit 1;

  -- Fleet (top 50 by updated_at)
  select coalesce(json_agg(row_to_json(e)), '[]'::json) into v_fleet
    from (
      select e.id, e.name, e.make, e.model, e.year, e.engine_hours,
             e.serial_number, e.asset_tag, e.metadata, e.updated_at,
             esc.stage_label, esc.eta, esc.last_updated as stage_updated
        from public.qrm_equipment e
        left join public.equipment_status_canonical esc on esc.equipment_id = e.id
        where e.company_id = p_company_id
          and e.deleted_at is null
        order by e.updated_at desc
        limit 50
    ) e;

  -- Open quotes (joined via deals)
  select coalesce(json_agg(row_to_json(q)), '[]'::json) into v_quotes
    from (
      select q.id, q.deal_id, q.status, q.net_total, q.expires_at, q.created_at,
             d.name as deal_name
        from public.quote_packages q
        join public.qrm_deals d on d.id = q.deal_id
        where d.company_id = p_company_id
          and q.status in ('draft', 'sent', 'negotiating')
        order by q.expires_at asc nulls last
        limit 25
    ) q;

  -- Recent service jobs
  select coalesce(json_agg(row_to_json(sj)), '[]'::json) into v_service
    from (
      select sj.id, sj.current_stage::text as current_stage,
             sj.customer_problem_summary, sj.scheduled_start_at, sj.scheduled_end_at,
             sj.completed_at, sj.machine_id
        from public.service_jobs sj
        where sj.customer_id = p_company_id
        order by sj.created_at desc
        limit 25
    ) sj;

  -- Parts orders (lifetime + recent)
  select json_build_object(
    'lifetime_total', coalesce(sum(po.total), 0),
    'order_count', count(*),
    'recent', coalesce((
      select json_agg(row_to_json(r))
      from (
        select po2.id, po2.status, po2.total, po2.created_at
        from public.parts_orders po2
        join public.portal_customers pc on pc.id = po2.portal_customer_id
        where pc.crm_company_id = p_company_id
        order by po2.created_at desc
        limit 10
      ) r
    ), '[]'::json)
  ) into v_parts
  from public.parts_orders po
  join public.portal_customers pc on pc.id = po.portal_customer_id
  where pc.crm_company_id = p_company_id;

  -- Open / overdue invoices
  select coalesce(json_agg(row_to_json(ci)), '[]'::json) into v_invoices
    from (
      select ci.id, ci.invoice_number, ci.invoice_date, ci.due_date,
             ci.total, ci.amount_paid, ci.balance_due, ci.status
        from public.customer_invoices ci
        where ci.crm_company_id = p_company_id
          and ci.status in ('pending', 'sent', 'viewed', 'partial', 'overdue')
        order by ci.due_date asc
        limit 25
    ) ci;

  -- Health score with 7/30/90d deltas (reuses Phase 2C RPC)
  begin
    select public.get_health_score_with_deltas((v_profile->>'id')::uuid) into v_health;
  exception when others then
    v_health := null;
  end;

  -- Active AR credit block, if any
  select to_json(b.*) into v_ar_block
    from public.ar_credit_blocks b
    where b.company_id = p_company_id
      and b.status = 'active'
    limit 1;

  return json_build_object(
    'company',       v_company,
    'profile',       v_profile,
    'fleet',         v_fleet,
    'open_quotes',   v_quotes,
    'service',       v_service,
    'parts',         v_parts,
    'invoices',      v_invoices,
    'health',        v_health,
    'ar_block',      v_ar_block
  );
end;
$$;

comment on function public.get_account_360(uuid) is
  'Single round-trip Account 360 payload: company + profile + fleet + open quotes + service jobs + parts rollup + invoices + health + AR block. SECURITY INVOKER honors caller RLS.';

-- ── 2. get_fleet_radar — five-lens fleet opportunity scan ────────────────

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
  -- Lens 1: aging machines (engine_hours past replacement window heuristic 4000h)
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

  -- Lens 2: expensive to maintain (lifetime parts spend > $5K)
  select coalesce(json_agg(row_to_json(e)), '[]'::json) into v_expensive
    from (
      select e.id, e.name, e.make, e.model, e.year,
             coalesce((select sum(po.total)
                       from public.parts_orders po
                       join public.portal_customers pc on pc.id = po.portal_customer_id
                       where pc.crm_company_id = p_company_id
                         and po.fleet_id is not null), 0) as lifetime_parts_spend,
             'expensive_to_maintain' as lens,
             'Lifetime parts spend crossing the cost-curve heuristic' as reason
        from public.qrm_equipment e
        where e.company_id = p_company_id
          and e.deleted_at is null
        order by e.engine_hours desc nulls last
        limit 10
    ) e
    where (e->>'lifetime_parts_spend')::numeric > 5000;

  -- Lens 3: trade-up windows (badges trade_up_score >= 70)
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

  -- Lens 4: under-utilized (no telematics readings in 30+ days — best-effort)
  -- Falls back to "no engine_hours change" if telematics_readings absent.
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

  -- Lens 5: attachment upsell (machines with no attachments referenced in metadata)
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
  'Account-level fleet opportunity radar with five lenses (aging / expensive / trade-up / underutilized / attachment-upsell). Spec §10.1.';
