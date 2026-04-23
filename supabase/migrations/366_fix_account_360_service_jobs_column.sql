-- 366_fix_account_360_service_jobs_column.sql
--
-- Fix: get_account_360 references service_jobs.completed_at which does
-- not exist in this schema — the column is closed_at. The RPC has been
-- 500'ing on every Account Command Center page load, showing reps
-- "This account command surface isn't available right now."
--
-- We keep the returned JSON field named `completed_at` via an alias so
-- the client TypeScript interface (Account360ServiceJob.completed_at)
-- keeps working without a matching UI release.
--
-- Only the service-jobs subquery changes; the rest of the function is
-- byte-identical to the prior definition.

create or replace function public.get_account_360(p_company_id uuid)
returns json
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
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

  -- Recent service jobs.
  -- `service_jobs.completed_at` does not exist; column is `closed_at`.
  -- Alias keeps the JSON field name stable for existing client types.
  select coalesce(json_agg(row_to_json(sj)), '[]'::json) into v_service
    from (
      select sj.id, sj.current_stage::text as current_stage,
             sj.customer_problem_summary, sj.scheduled_start_at, sj.scheduled_end_at,
             sj.closed_at as completed_at, sj.machine_id
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
$function$;
