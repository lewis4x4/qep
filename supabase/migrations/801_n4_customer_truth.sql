-- ============================================================================
-- 801: N4.1 — Customer truth (DB spine)
--
-- Five verified gaps in the single-customer picture (RF-006/007/035/036/037,
-- see qep_roadmap_tasks N4.1):
--
--   1. Portal identity find-or-create: customer_fleet rows require a
--      portal_customer_id, but only demo seeds ever created portal
--      identities. qep_find_or_create_portal_identity gives the closed-won
--      fleet writer (flow action link_customer_fleet) a company-anchored
--      identity to hang fleet rows on — real contact when one exists, a
--      deterministic shadow identity otherwise.
--   2. customer_fleet idempotency: unique (workspace_id, equipment_id) so the
--      fleet writer can upsert per machine (table was writer-less and empty,
--      so the index is riskless).
--   3. flow_emit_from_deal: payload gains is_closed_won so workflows can key
--      on the close itself instead of guessing from stage names.
--   4. get_account_360: new 'rental' arm (contracts + invoices by
--      qrm_company_id or portal linkage), the parts arm now reads the
--      coalesced anchor (direct crm_company_id OR portal identity — counter
--      orders were invisible), and a new 'value_summary' computes one live
--      total-customer-value number from customer_invoices across all four
--      streams.
--   5. Honest health scores:
--      - compute_customer_health_score: parts component now sums real
--        parts_orders on the coalesced company anchor (was an
--        attachment-rate/lifetime-value proxy), and a rental component
--        (activity + overdue-balance penalty) replaces nothing — rental was
--        simply absent. Rebalanced to five 20-point components.
--      - compute_ownership_health_score: the hardcoded v_rental_score := 75
--        is replaced with a blend of rental_compute_utilization (physical,
--        time, dollar utilization). Workspaces with no rental fleet keep the
--        neutral 75.
-- ============================================================================

-- ── 1. Portal identity find-or-create ───────────────────────────────────────

create or replace function public.qep_find_or_create_portal_identity(
  p_workspace_id text,
  p_crm_company_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_contact record;
  v_company_name text;
begin
  if p_crm_company_id is null then
    return null;
  end if;

  select pc.id into v_id
  from public.portal_customers pc
  where pc.workspace_id = p_workspace_id
    and pc.crm_company_id = p_crm_company_id
  order by (pc.auth_user_id is not null) desc, pc.is_active desc, pc.created_at asc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select c.id, c.first_name, c.last_name, c.email into v_contact
  from public.crm_contacts c
  where c.primary_company_id = p_crm_company_id
    and c.deleted_at is null
  order by (c.email is not null) desc, c.created_at asc
  limit 1;

  select qc.name into v_company_name
  from public.qrm_companies qc
  where qc.id = p_crm_company_id;

  insert into public.portal_customers (
    workspace_id,
    crm_contact_id,
    crm_company_id,
    first_name,
    last_name,
    email,
    portal_role,
    is_active
  ) values (
    p_workspace_id,
    v_contact.id,
    p_crm_company_id,
    coalesce(nullif(trim(v_contact.first_name), ''), v_company_name, 'Fleet'),
    coalesce(nullif(trim(v_contact.last_name), ''), 'Contact'),
    coalesce(v_contact.email, 'fleet+' || p_crm_company_id || '@shadow.qep.local'),
    'viewer',
    true
  )
  on conflict (workspace_id, email) do update
    set crm_company_id = coalesce(portal_customers.crm_company_id, excluded.crm_company_id)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.qep_find_or_create_portal_identity(text, uuid) is
  'N4.1: company-anchored portal identity for internal writers (customer_fleet). Reuses an existing identity, else creates one from the company''s best contact, else a deterministic shadow identity (no auth_user_id, cannot log in). Service-role only.';

revoke execute on function public.qep_find_or_create_portal_identity(text, uuid) from public;
revoke execute on function public.qep_find_or_create_portal_identity(text, uuid) from authenticated;
grant execute on function public.qep_find_or_create_portal_identity(text, uuid) to service_role;

-- ── 2. customer_fleet idempotency ────────────────────────────────────────────
-- Full (non-partial) unique index so PostgREST upsert on_conflict can target
-- it; NULL equipment_ids stay insertable (NULLs are distinct).

create unique index if not exists uq_customer_fleet_ws_equipment
  on public.customer_fleet (workspace_id, equipment_id);

-- ── 3. Deal event payload: is_closed_won ────────────────────────────────────

create or replace function public.flow_emit_from_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_equipment_id uuid;
  v_stage_name text;
  v_is_closed_won boolean;
  v_old_stage_name text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'deal.created';
  elsif new.stage_id is distinct from old.stage_id then
    v_event_type := 'deal.stage.changed';
  else
    return new;
  end if;

  select de.equipment_id into v_equipment_id
  from public.qrm_deal_equipment de
  where de.deal_id = new.id and de.role = 'subject'
  order by de.created_at asc
  limit 1;

  select s.name, s.is_closed_won into v_stage_name, v_is_closed_won
  from public.crm_deal_stages s where s.id = new.stage_id;
  if tg_op = 'UPDATE' then
    select s.name into v_old_stage_name from public.crm_deal_stages s where s.id = old.stage_id;
  end if;

  perform public.emit_event(
    v_event_type,
    'qrm',
    'crm_deal',
    new.id::text,
    jsonb_build_object(
      'deal_id', new.id,
      'workspace_id', new.workspace_id,
      'amount', new.amount,
      'stage_id', new.stage_id,
      'stage_name', v_stage_name,
      'is_closed_won', coalesce(v_is_closed_won, false),
      'expected_close_on', new.expected_close_on,
      'company_id', new.company_id,
      'assigned_rep_id', new.assigned_rep_id,
      'closed_at', new.closed_at,
      'equipment_id', v_equipment_id,
      'old_stage_id', case when tg_op = 'UPDATE' then old.stage_id else null end,
      'old_stage_name', v_old_stage_name
    ),
    new.workspace_id
  );
  return new;
end;
$$;

-- ── 4. Account 360: rental arm, coalesced parts anchor, value summary ──────

create or replace function public.get_account_360(p_company_id uuid)
returns json
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_company jsonb;
  v_profile json;
  v_fleet json;
  v_quotes json;
  v_service json;
  v_parts json;
  v_rental json;
  v_invoices json;
  v_value json;
  v_health json;
  v_ar_block json;
begin
  select to_jsonb(c) || jsonb_build_object(
      'ein', public.mask_customer_ein(c.ein),
      'ein_masked', (c.ein is not null and not public.qrm_can_access_customer_ein())
    ) into v_company
    from public.qrm_companies c
    where c.id = p_company_id;

  if v_company is null then
    return null;
  end if;

  select to_json(cpe.*) into v_profile
    from public.customer_profiles_extended cpe
    where cpe.crm_company_id = p_company_id
    limit 1;

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

  -- Parts on the coalesced anchor: counter orders carry crm_company_id
  -- directly, portal orders reach the company through portal_customers.
  select json_build_object(
    'lifetime_total', coalesce(sum(po.total), 0),
    'order_count', count(*),
    'recent', coalesce((
      select json_agg(row_to_json(r))
      from (
        select po2.id, po2.status, po2.total, po2.created_at
        from public.parts_orders po2
        left join public.portal_customers pc2 on pc2.id = po2.portal_customer_id
        where coalesce(po2.crm_company_id, pc2.crm_company_id) = p_company_id
        order by po2.created_at desc
        limit 10
      ) r
    ), '[]'::json)
  ) into v_parts
  from public.parts_orders po
  left join public.portal_customers pc on pc.id = po.portal_customer_id
  where coalesce(po.crm_company_id, pc.crm_company_id) = p_company_id;

  -- Rental arm: contracts anchored on the company directly or through a
  -- portal identity; invoice money from the canonical rental ledger.
  -- (rental_invoices has no invoice_date — period_start is the issue date.
  -- Money aggregates ignore contract soft-deletion — billed history is a
  -- financial fact; contract counts respect it.)
  select json_build_object(
    'contract_count', count(rc.id),
    'open_contract_count', count(rc.id) filter (
      where rc.lifecycle_state in ('reserved', 'on_rent', 'off_rent')),
    'lifetime_billed', coalesce((
      select sum(ri.total_cents)
      from public.rental_invoices ri
      where ri.rental_contract_id in (
        select rc2.id from public.rental_contracts rc2
        where rc2.qrm_company_id = p_company_id
           or rc2.portal_customer_id in (
                select pc3.id from public.portal_customers pc3
                where pc3.crm_company_id = p_company_id)
      ) and ri.status <> 'void' and ri.deleted_at is null
    ), 0) / 100.0,
    'open_balance', coalesce((
      select sum(ri.balance_cents)
      from public.rental_invoices ri
      where ri.rental_contract_id in (
        select rc2.id from public.rental_contracts rc2
        where rc2.qrm_company_id = p_company_id
           or rc2.portal_customer_id in (
                select pc3.id from public.portal_customers pc3
                where pc3.crm_company_id = p_company_id)
      ) and ri.status <> 'void' and ri.balance_cents > 0 and ri.deleted_at is null
    ), 0) / 100.0,
    'recent_invoices', coalesce((
      select json_agg(row_to_json(r))
      from (
        select ri.id, ri.invoice_number, ri.status,
               ri.period_start as invoice_date, ri.due_date,
               ri.total_cents, ri.balance_cents, ri.rental_contract_id
        from public.rental_invoices ri
        join public.rental_contracts rc4 on rc4.id = ri.rental_contract_id
        where (rc4.qrm_company_id = p_company_id
               or rc4.portal_customer_id in (
                    select pc4.id from public.portal_customers pc4
                    where pc4.crm_company_id = p_company_id))
          and ri.deleted_at is null
        order by coalesce(ri.posted_at, ri.created_at) desc
        limit 10
      ) r
    ), '[]'::json)
  ) into v_rental
  from public.rental_contracts rc
  where (rc.qrm_company_id = p_company_id
     or rc.portal_customer_id in (
          select pc5.id from public.portal_customers pc5
          where pc5.crm_company_id = p_company_id))
    and rc.deleted_at is null;

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

  -- One live total-customer-value number: billed truth from the AR ledger,
  -- broken out by stream (rental invoices mirror into customer_invoices as
  -- invoice_type='rental' since M4.1, so this single source spans all four).
  select json_build_object(
    'equipment_lifetime', coalesce(sum(ci.total) filter (where ci.invoice_type = 'equipment'), 0),
    'parts_lifetime',     coalesce(sum(ci.total) filter (where ci.invoice_type = 'parts'), 0),
    'service_lifetime',   coalesce(sum(ci.total) filter (
                            where ci.invoice_type = 'service' or ci.service_job_id is not null), 0),
    'rental_lifetime',    coalesce(sum(ci.total) filter (where ci.invoice_type = 'rental'), 0),
    'other_lifetime',     coalesce(sum(ci.total) filter (
                            where ci.invoice_type not in ('equipment', 'parts', 'service', 'rental')
                              and ci.service_job_id is null), 0),
    'total_customer_value', coalesce(sum(ci.total), 0)
  ) into v_value
  from public.customer_invoices ci
  where ci.crm_company_id = p_company_id
    and ci.status <> 'void';

  begin
    select public.get_health_score_with_deltas((v_profile->>'id')::uuid) into v_health;
  exception when others then
    v_health := null;
  end;

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
    'rental',        v_rental,
    'invoices',      v_invoices,
    'value_summary', v_value,
    'health',        v_health,
    'ar_block',      v_ar_block
  );
end;
$function$;

comment on function public.get_account_360(uuid) is
  'Single round-trip Account 360 payload: role-masked EIN, coalesced-anchor parts, rental arm, and a value_summary spanning all four revenue streams (N4.1).';

-- ── 5a. Customer health score: real parts + rental components ──────────────

create or replace function public.compute_customer_health_score(p_customer_profile_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_deal_velocity numeric := 0;
  v_service_engagement numeric := 0;
  v_parts_revenue numeric := 0;
  v_rental_engagement numeric := 0;
  v_financial_health numeric := 0;
  v_total numeric;
  v_components jsonb;
  v_service_visits_90d integer := 0;
  v_parts_spend_12m numeric := 0;
  v_parts_last_order timestamptz;
  v_rental_billed_12m numeric := 0;
  v_rental_overdue numeric := 0;
  v_open_contracts integer := 0;
  v_contracts_ever integer := 0;
begin
  select * into v_profile
  from public.customer_profiles_extended
  where id = p_customer_profile_id;

  if not found then
    return null;
  end if;

  select count(*)::integer
  into v_service_visits_90d
  from public.service_jobs sj
  where sj.customer_id = v_profile.crm_company_id
    and sj.created_at > now() - interval '90 days'
    and sj.deleted_at is null;

  -- Five 20-point components (was four 25-point ones; rental was absent and
  -- parts was an attachment-rate proxy that never read parts_orders).
  v_deal_velocity := least(20,
    (case when v_profile.last_interaction_at > now() - interval '30 days' then 8
          when v_profile.last_interaction_at > now() - interval '90 days' then 4 else 0 end) +
    (case when v_profile.last_deal_at > now() - interval '180 days' then 7 else 0 end) +
    (case when coalesce(v_profile.total_deals, 0) >= 3 then 10
          when coalesce(v_profile.total_deals, 0) >= 1 then 5 else 0 end)
  );

  v_service_engagement := least(20,
    (case when v_service_visits_90d >= 3 then 15
          when v_service_visits_90d >= 1 then 8 else 0 end) +
    (case when coalesce(v_profile.service_contract_rate, 0) >= 0.5 then 10
          when coalesce(v_profile.service_contract_rate, 0) > 0 then 5 else 0 end)
  );

  if v_profile.crm_company_id is not null then
    select coalesce(sum(po.total), 0),
           max(po.created_at)
      into v_parts_spend_12m, v_parts_last_order
    from public.parts_orders po
    left join public.portal_customers pc on pc.id = po.portal_customer_id
    where coalesce(po.crm_company_id, pc.crm_company_id) = v_profile.crm_company_id
      and po.created_at > now() - interval '365 days'
      and coalesce(po.status, '') not in ('cancelled', 'void');

    v_parts_revenue := least(20,
      (case when v_parts_spend_12m >= 25000 then 12
            when v_parts_spend_12m >= 5000 then 9
            when v_parts_spend_12m > 0 then 6 else 0 end) +
      (case when v_parts_last_order > now() - interval '90 days' then 8
            when v_parts_last_order > now() - interval '180 days' then 4 else 0 end)
    );

    select
      coalesce(sum(ri.total_cents) filter (
        where ri.period_start > (now() - interval '365 days')::date), 0) / 100.0,
      coalesce(sum(ri.balance_cents) filter (
        where ri.status = 'posted' and ri.balance_cents > 0
          and ri.due_date < current_date), 0) / 100.0
      into v_rental_billed_12m, v_rental_overdue
    from public.rental_invoices ri
    where ri.rental_contract_id in (
      select rc.id from public.rental_contracts rc
      where rc.qrm_company_id = v_profile.crm_company_id
         or rc.portal_customer_id in (
              select pc.id from public.portal_customers pc
              where pc.crm_company_id = v_profile.crm_company_id)
    ) and ri.status <> 'void' and ri.deleted_at is null;

    select
      count(*) filter (where rc.lifecycle_state in ('reserved', 'on_rent', 'off_rent')),
      count(*)
      into v_open_contracts, v_contracts_ever
    from public.rental_contracts rc
    where (rc.qrm_company_id = v_profile.crm_company_id
       or rc.portal_customer_id in (
            select pc.id from public.portal_customers pc
            where pc.crm_company_id = v_profile.crm_company_id))
      and rc.deleted_at is null;

    v_rental_engagement := greatest(0, least(20,
      (case when v_rental_billed_12m >= 25000 then 10
            when v_rental_billed_12m >= 5000 then 7
            when v_rental_billed_12m > 0 then 5 else 0 end) +
      (case when v_open_contracts > 0 then 10
            when v_contracts_ever > 0 then 4 else 0 end) -
      (case when v_rental_overdue >= 5000 then 10
            when v_rental_overdue >= 500 then 6
            when v_rental_overdue > 0 then 3 else 0 end)
    ));
  else
    -- Profiles not yet anchored to a company keep the legacy proxy so the
    -- score does not crater on identity gaps; rental contributes nothing.
    v_parts_revenue := least(20,
      (case when coalesce(v_profile.attachment_rate, 0) >= 0.5 then 12
            when coalesce(v_profile.attachment_rate, 0) > 0 then 6 else 0 end) +
      (case when coalesce(v_profile.lifetime_value, 0) >= 500000 then 8
            when coalesce(v_profile.lifetime_value, 0) >= 100000 then 6
            when coalesce(v_profile.lifetime_value, 0) >= 25000 then 3 else 0 end)
    );
    v_rental_engagement := 0;
  end if;

  v_financial_health := least(20,
    (case when coalesce(v_profile.avg_discount_pct, 0) < 5 then 12
          when coalesce(v_profile.avg_discount_pct, 0) < 10 then 8
          when coalesce(v_profile.avg_discount_pct, 0) < 15 then 4 else 0 end) +
    (case when coalesce(v_profile.avg_days_to_close, 999) < 30 then 8
          when coalesce(v_profile.avg_days_to_close, 999) < 60 then 6
          when coalesce(v_profile.avg_days_to_close, 999) < 90 then 3 else 0 end)
  );

  v_total := v_deal_velocity + v_service_engagement + v_parts_revenue
             + v_rental_engagement + v_financial_health;
  v_components := jsonb_build_object(
    'deal_velocity', v_deal_velocity,
    'service_engagement', v_service_engagement,
    'parts_revenue', v_parts_revenue,
    'rental_engagement', v_rental_engagement,
    'financial_health', v_financial_health
  );

  update public.customer_profiles_extended
  set health_score = v_total,
      health_score_components = v_components,
      health_score_updated_at = now()
  where id = p_customer_profile_id;

  return v_total;
end;
$$;

-- ── 5b. Ownership health score: real rental dimension ──────────────────────

create or replace function public.compute_ownership_health_score(p_workspace text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ws text;
  v_summary jsonb;
  v_parts_score integer;
  v_sales_score integer;
  v_service_score integer;
  v_rental_score integer := 75;
  v_finance_score integer;
  v_composite integer;
  v_stockouts integer;
  v_dead_capital numeric;
  v_catalog_total integer;
  v_pipeline_total numeric;
  v_at_risk integer;
  v_ar_aged numeric;
  v_open_service integer;
  v_util jsonb;
begin
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  else
    ws := coalesce(p_workspace, 'default');
  end if;

  v_summary := public.owner_dashboard_summary(ws);

  v_stockouts := coalesce((v_summary -> 'parts' ->> 'stockout_critical')::integer, 0);
  v_dead_capital := coalesce((v_summary -> 'parts' ->> 'dead_capital_usd')::numeric, 0);
  v_catalog_total := greatest(1, coalesce((v_summary -> 'parts' ->> 'total_catalog')::integer, 1));
  v_parts_score := greatest(0, least(100,
    100
    - least(40, (v_stockouts::numeric / v_catalog_total * 100)::integer)
    - least(30, (v_dead_capital / 10000)::integer)
  ));

  v_pipeline_total := coalesce((v_summary -> 'pipeline' ->> 'weighted_total')::numeric, 0);
  v_at_risk := coalesce((v_summary -> 'pipeline' ->> 'at_risk_count')::integer, 0);
  v_sales_score := greatest(0, least(100,
    60 + least(30, (v_pipeline_total / 100000)::integer * 3) - least(30, v_at_risk * 5)
  ));

  select count(*)::integer
  into v_open_service
  from public.service_jobs
  where workspace_id = ws
    and closed_at is null
    and deleted_at is null
    and current_stage::text not in ('invoiced', 'paid_closed')
    and created_at > now() - interval '60 days';

  v_service_score := greatest(40, 100 - least(60, coalesce(v_open_service, 0) * 2));

  -- Real rental dimension (was a hardcoded 75): utilization blend from the
  -- canonical rental ledger. No rental fleet keeps the neutral legacy value.
  begin
    v_util := public.rental_compute_utilization(ws);
  exception when others then
    v_util := null;
  end;
  if coalesce((v_util ->> 'fleet_count')::integer, 0) > 0 then
    v_rental_score := greatest(0, least(100, round(
      coalesce((v_util ->> 'physical_pct')::numeric, 0) * 0.5 +
      coalesce((v_util ->> 'time_pct_30d')::numeric, 0) * 0.3 +
      least(100, coalesce((v_util ->> 'dollar_pct')::numeric, 0) * 2) * 0.2
    )::integer));
  end if;

  v_ar_aged := coalesce((v_summary -> 'finance' ->> 'ar_aged_90_plus')::numeric, 0);
  v_finance_score := greatest(0, least(100, 100 - least(60, (v_ar_aged / 5000)::integer)));

  v_composite := round(
    (v_parts_score * 0.20)
    + (v_sales_score * 0.25)
    + (v_service_score * 0.20)
    + (v_rental_score * 0.15)
    + (v_finance_score * 0.20)
  )::integer;

  return jsonb_build_object(
    'score', v_composite,
    'generated_at', now(),
    'dimensions', jsonb_build_object(
      'parts', v_parts_score,
      'sales', v_sales_score,
      'service', v_service_score,
      'rental', v_rental_score,
      'finance', v_finance_score
    ),
    'weights', jsonb_build_object('parts', 0.20, 'sales', 0.25, 'service', 0.20, 'rental', 0.15, 'finance', 0.20),
    'tier', case
      when v_composite >= 85 then 'excellent'
      when v_composite >= 70 then 'healthy'
      when v_composite >= 55 then 'attention'
      else 'critical'
    end
  );
end;
$$;
