-- ============================================================================
-- Migration 156: Live Health Score + Equipment Lifecycle + AR Blocking
--
-- Gap closure for Moonshot 5 — replaces the stale DNA-based health score
-- with a score computed from LIVE cross-department data:
-- - Parts spend trend (30/60/90 day windows from parts_orders)
-- - Service visit frequency (from service_jobs or portal_service_requests)
-- - Payment speed (days to pay from customer_invoices)
-- - Quote-to-close ratio (from crm_deals)
--
-- Also adds:
-- - equipment_lifecycle_summary view (revenue per machine + replacement curve)
-- - Revenue attribution aggregate by make/model
-- - AR→Sales BLOCKING trigger (not just notification)
-- ============================================================================

-- ── 1. Live health score computation ────────────────────────────────────────
-- Replaces the DNA-only version from migration 150

create or replace function public.compute_customer_health_score(p_customer_profile_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal_velocity numeric := 0;
  v_service_engagement numeric := 0;
  v_parts_revenue numeric := 0;
  v_financial_health numeric := 0;
  v_total numeric;
  v_components jsonb;
  v_profile record;
  v_30d_parts_spend numeric;
  v_90d_parts_spend numeric;
  v_service_visits_90d integer;
  v_avg_days_to_pay numeric;
  v_won_deals integer;
  v_lost_deals integer;
  v_quote_close_ratio numeric;
begin
  select * into v_profile from public.customer_profiles_extended where id = p_customer_profile_id;
  if not found then return null; end if;

  -- ── Component 1: Deal Velocity (0-25) ────────────────────────────────
  -- Recent activity + quote-to-close ratio (live from crm_deals)
  select
    count(*) filter (where dh.outcome = 'won') as won,
    count(*) filter (where dh.outcome = 'lost') as lost
  into v_won_deals, v_lost_deals
  from public.customer_deal_history dh
  where dh.customer_profile_id = p_customer_profile_id
    and dh.deal_date > now() - interval '365 days';

  v_quote_close_ratio := case
    when coalesce(v_won_deals, 0) + coalesce(v_lost_deals, 0) = 0 then null
    else round(v_won_deals::numeric / (v_won_deals + v_lost_deals), 3)
  end;

  v_deal_velocity := least(25,
    (case when v_profile.last_interaction_at > now() - interval '30 days' then 8
          when v_profile.last_interaction_at > now() - interval '90 days' then 4 else 0 end) +
    (case when v_profile.last_deal_at > now() - interval '180 days' then 7 else 0 end) +
    (case
      when v_quote_close_ratio >= 0.5 then 10
      when v_quote_close_ratio >= 0.3 then 6
      when v_quote_close_ratio >= 0.1 then 3
      else 0
    end)
  );

  -- ── Component 2: Service Engagement (0-25) ───────────────────────────
  -- Live service visit count (last 90 days) + contract adoption
  v_service_visits_90d := 0;
  begin
    select count(*) into v_service_visits_90d
    from public.service_jobs sj
    where sj.customer_profile_id = p_customer_profile_id
      and sj.created_at > now() - interval '90 days';
  exception when undefined_table or undefined_column then
    v_service_visits_90d := 0;
  end;

  v_service_engagement := least(25,
    (case
      when v_service_visits_90d >= 3 then 15
      when v_service_visits_90d >= 1 then 8
      else 0
    end) +
    (case when coalesce(v_profile.service_contract_rate, 0) >= 0.5 then 10
          when coalesce(v_profile.service_contract_rate, 0) > 0 then 5 else 0 end)
  );

  -- ── Component 3: Parts Revenue (0-25) ───────────────────────────────
  -- Live parts spend trend (30d vs 90d)
  v_30d_parts_spend := 0;
  v_90d_parts_spend := 0;
  begin
    select
      coalesce(sum(po.total) filter (where po.created_at > now() - interval '30 days'), 0),
      coalesce(sum(po.total) filter (where po.created_at > now() - interval '90 days'), 0)
    into v_30d_parts_spend, v_90d_parts_spend
    from public.parts_orders po
    where po.customer_profile_id = p_customer_profile_id;
  exception when undefined_table or undefined_column then
    v_30d_parts_spend := 0;
    v_90d_parts_spend := 0;
  end;

  v_parts_revenue := least(25,
    (case
      when v_90d_parts_spend >= 10000 then 15
      when v_90d_parts_spend >= 2500 then 10
      when v_90d_parts_spend >= 500 then 5
      else 0
    end) +
    -- Trend bonus: is 30d spend trending UP (> 1/3 of 90d)?
    (case
      when v_90d_parts_spend > 0 and (v_30d_parts_spend * 3) > v_90d_parts_spend then 10
      else 0
    end)
  );

  -- ── Component 4: Financial Health (0-25) ────────────────────────────
  -- Live days-to-pay from customer_invoices
  v_avg_days_to_pay := null;
  begin
    select avg(extract(epoch from (ci.paid_at - ci.invoice_date::timestamptz)) / 86400)
    into v_avg_days_to_pay
    from public.customer_invoices ci
    where ci.portal_customer_id in (
      select pc.id from public.portal_customers pc
      where pc.crm_contact_id in (
        select c.id from public.crm_contacts c
        where c.primary_company_id = (
          select crm_company_id from public.customer_profiles_extended where id = p_customer_profile_id
        )
      )
    )
      and ci.paid_at is not null
      and ci.invoice_date > (current_date - interval '365 days');
  exception when undefined_table or undefined_column or others then
    v_avg_days_to_pay := null;
  end;

  v_financial_health := least(25,
    (case
      when v_avg_days_to_pay is null then 10 -- neutral if no data
      when v_avg_days_to_pay <= 15 then 20
      when v_avg_days_to_pay <= 30 then 15
      when v_avg_days_to_pay <= 45 then 8
      when v_avg_days_to_pay <= 60 then 3
      else 0
    end) +
    (case when coalesce(v_profile.avg_discount_pct, 0) < 10 then 5 else 0 end)
  );

  v_total := v_deal_velocity + v_service_engagement + v_parts_revenue + v_financial_health;
  v_components := jsonb_build_object(
    'deal_velocity', v_deal_velocity,
    'service_engagement', v_service_engagement,
    'parts_revenue', v_parts_revenue,
    'financial_health', v_financial_health,
    'signals', jsonb_build_object(
      'parts_spend_30d', v_30d_parts_spend,
      'parts_spend_90d', v_90d_parts_spend,
      'service_visits_90d', v_service_visits_90d,
      'avg_days_to_pay', v_avg_days_to_pay,
      'quote_close_ratio', v_quote_close_ratio,
      'won_deals_365d', v_won_deals,
      'lost_deals_365d', v_lost_deals
    )
  );

  update public.customer_profiles_extended
  set health_score = v_total,
      health_score_components = v_components,
      health_score_updated_at = now()
  where id = p_customer_profile_id;

  return v_total;
end;
$$;

revoke execute on function public.compute_customer_health_score(uuid) from public;
grant execute on function public.compute_customer_health_score(uuid) to authenticated, service_role;

-- ── 2. Equipment lifecycle summary view ─────────────────────────────────────
-- Revenue per machine + replacement cost curve indicator

create or replace view public.equipment_lifecycle_summary as
select
  fi.id as fleet_intelligence_id,
  fi.customer_profile_id,
  fi.customer_name,
  fi.equipment_serial,
  fi.make,
  fi.model,
  fi.year,
  fi.current_hours,
  fi.predicted_replacement_date,
  fi.replacement_confidence,
  cpe.health_score as customer_health_score,
  -- Aggregate revenue attribution per machine from revenue_attribution JSONB
  coalesce((cpe.revenue_attribution ->> fi.equipment_serial)::jsonb, '{}'::jsonb) as revenue_breakdown
from public.fleet_intelligence fi
left join public.customer_profiles_extended cpe on cpe.id = fi.customer_profile_id
where fi.outreach_status is not null;

comment on view public.equipment_lifecycle_summary is 'Per-machine lifecycle view: ownership, service history, revenue, replacement prediction. Moonshot 5 gap closure.';

-- ── 3. Revenue attribution by make/model aggregate ─────────────────────────

create or replace view public.revenue_by_make_model as
with per_machine as (
  select
    fi.make,
    fi.model,
    count(*) as unit_count,
    -- Extract per-machine lifetime revenue from revenue_attribution JSONB
    sum(
      coalesce(
        (cpe.revenue_attribution -> fi.equipment_serial ->> 'parts')::numeric, 0
      ) +
      coalesce(
        (cpe.revenue_attribution -> fi.equipment_serial ->> 'service')::numeric, 0
      ) +
      coalesce(
        (cpe.revenue_attribution -> fi.equipment_serial ->> 'purchase')::numeric, 0
      ) +
      coalesce(
        (cpe.revenue_attribution -> fi.equipment_serial ->> 'rental')::numeric, 0
      )
    ) as total_lifetime_revenue
  from public.fleet_intelligence fi
  left join public.customer_profiles_extended cpe on cpe.id = fi.customer_profile_id
  where fi.equipment_serial is not null
  group by fi.make, fi.model
)
select
  make,
  model,
  unit_count,
  total_lifetime_revenue,
  case
    when unit_count > 0 then round(total_lifetime_revenue / unit_count, 2)
    else 0
  end as avg_lifetime_revenue_per_unit
from per_machine
where total_lifetime_revenue > 0
order by total_lifetime_revenue desc;

comment on view public.revenue_by_make_model is 'Revenue attribution aggregate. Ryan: "Stock more Bandit 2290s because they generate $47K vs $18K." Drives inventory decisions.';

-- ── 4. AR-Sales BLOCKING trigger (not just notification) ───────────────────
-- If a customer has aging AR > 60 days, hard-block new quote_packages for that deal.

create or replace function public.enforce_ar_quote_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_overdue_total numeric;
  v_deal_contact uuid;
  v_deal_company uuid;
begin
  if NEW.deal_id is null then
    return NEW;
  end if;

  -- Find the deal's contact + company
  select primary_contact_id, company_id into v_deal_contact, v_deal_company
  from public.crm_deals where id = NEW.deal_id;

  if v_deal_company is null then
    return NEW;
  end if;

  -- Check for overdue invoices via portal_customers → crm_contact → company
  begin
    select coalesce(sum(ci.balance_due), 0) into v_overdue_total
    from public.customer_invoices ci
    join public.portal_customers pc on pc.id = ci.portal_customer_id
    join public.crm_contacts c on c.id = pc.crm_contact_id
    where c.primary_company_id = v_deal_company
      and ci.status in ('pending', 'sent', 'overdue')
      and ci.due_date < current_date - interval '60 days';
  exception when undefined_table or undefined_column then
    v_overdue_total := 0;
  end;

  if v_overdue_total > 100 then
    raise exception 'AR_HOLD: Customer has $% past due more than 60 days. Collect outstanding balance before creating new quote.',
      round(v_overdue_total, 2)
      using errcode = 'P0001',
            hint = 'Resolve the past-due invoices first, or have A/R approve an override.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_ar_quote_block_trg on public.quote_packages;
create trigger enforce_ar_quote_block_trg
  before insert on public.quote_packages
  for each row
  execute function public.enforce_ar_quote_block();

comment on function public.enforce_ar_quote_block() is 'AR→Sales BLOCKING trigger. Rejects new quote_packages if customer has $100+ past 60 days overdue.';
