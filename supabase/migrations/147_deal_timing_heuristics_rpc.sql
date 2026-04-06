-- ============================================================================
-- Migration 147: Deal Timing Heuristics RPCs
--
-- compute_deal_timing_alerts — scans all data sources and generates alerts:
-- 1. Fleet approaching replacement (predicted_replacement_date within 90d)
-- 2. Customer budget cycle approaching (within 60d of budget_cycle_month)
-- 3. Price increases within 45d for relevant fleet makes
-- 4. Seasonal patterns matching current quarter
-- 5. Portal trade-in interest flags (from Wave 1)
-- ============================================================================

create or replace function public.compute_deal_timing_alerts(p_workspace_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_today date := current_date;
  v_90d date := current_date + interval '90 days';
  v_60d date := current_date + interval '60 days';
  v_45d date := current_date + interval '45 days';
  v_current_month integer := extract(month from current_date);
  v_rec record;
begin
  -- 1. Equipment aging: fleet units approaching replacement
  for v_rec in
    select fi.id as fleet_id, fi.customer_profile_id, fi.customer_name,
           fi.make, fi.model, fi.predicted_replacement_date, fi.replacement_confidence
    from public.fleet_intelligence fi
    where fi.predicted_replacement_date is not null
      and fi.predicted_replacement_date between v_today and v_90d
      and fi.outreach_status = 'pending'
  loop
    insert into public.deal_timing_alerts (
      workspace_id, customer_profile_id, fleet_intelligence_id,
      alert_type, trigger_date, urgency, title, description, recommended_action
    ) values (
      p_workspace_id, v_rec.customer_profile_id, v_rec.fleet_id,
      'equipment_aging', v_rec.predicted_replacement_date,
      case
        when v_rec.predicted_replacement_date <= v_today + interval '30 days' then 'immediate'
        when v_rec.predicted_replacement_date <= v_today + interval '60 days' then 'upcoming'
        else 'future'
      end,
      v_rec.customer_name || '''s ' || v_rec.make || ' ' || v_rec.model || ' approaching replacement',
      'Predicted replacement: ' || v_rec.predicted_replacement_date || ' (confidence: ' || round(v_rec.replacement_confidence * 100) || '%)',
      'Schedule customer visit to discuss trade-up options.'
    ) on conflict (workspace_id, customer_profile_id, alert_type, trigger_date) where status = 'pending' do nothing;
    v_count := v_count + 1;
  end loop;

  -- 2. Budget cycle: customers whose budget opens within 60 days
  for v_rec in
    select cp.id as profile_id, cp.customer_name, cp.budget_cycle_month
    from public.customer_profiles_extended cp
    where cp.budget_cycle_month is not null
      and abs(cp.budget_cycle_month - v_current_month) <= 2
  loop
    insert into public.deal_timing_alerts (
      workspace_id, customer_profile_id,
      alert_type, trigger_date, urgency, title, description, recommended_action
    ) values (
      p_workspace_id, v_rec.profile_id,
      'budget_cycle',
      make_date(extract(year from current_date)::int, v_rec.budget_cycle_month, 1),
      case when v_rec.budget_cycle_month = v_current_month then 'immediate' else 'upcoming' end,
      v_rec.customer_name || '''s budget cycle opening (month ' || v_rec.budget_cycle_month || ')',
      'Customer typically approves CapEx purchases in month ' || v_rec.budget_cycle_month,
      'Contact customer with current inventory matching their fleet needs.'
    ) on conflict (workspace_id, customer_profile_id, alert_type, trigger_date) where status = 'pending' do nothing;
    v_count := v_count + 1;
  end loop;

  -- 3. Price increases: upcoming increases matching fleet makes
  for v_rec in
    select pit.manufacturer, pit.effective_date, pit.increase_pct,
           fi.customer_profile_id, cpe.customer_name
    from public.price_increase_tracking pit
    cross join lateral (
      select distinct fi2.customer_profile_id
      from public.fleet_intelligence fi2
      where fi2.make = pit.manufacturer
    ) fi
    join public.customer_profiles_extended cpe on cpe.id = fi.customer_profile_id
    where pit.effective_date between v_today and v_45d
      and pit.workspace_id = p_workspace_id
  loop
    insert into public.deal_timing_alerts (
      workspace_id, customer_profile_id,
      alert_type, trigger_date, urgency, title, description, recommended_action
    ) values (
      p_workspace_id, v_rec.customer_profile_id,
      'price_increase', v_rec.effective_date,
      case when v_rec.effective_date <= v_today + interval '15 days' then 'immediate' else 'upcoming' end,
      v_rec.manufacturer || ' price increase ' || v_rec.increase_pct || '% on ' || v_rec.effective_date,
      v_rec.customer_name || ' has ' || v_rec.manufacturer || ' equipment. Price increase of ' || v_rec.increase_pct || '% effective ' || v_rec.effective_date,
      'Call customer with urgency — buy before price goes up. Draft quote at current pricing.'
    ) on conflict (workspace_id, customer_profile_id, alert_type, trigger_date) where status = 'pending' do nothing;
    v_count := v_count + 1;
  end loop;

  -- 4. Trade-in interest (from portal, Wave 1)
  for v_rec in
    select cf.portal_customer_id, pc.first_name || ' ' || pc.last_name as customer_name,
           cf.make, cf.model, pc.crm_contact_id
    from public.customer_fleet cf
    join public.portal_customers pc on pc.id = cf.portal_customer_id
    where cf.trade_in_interest = true and cf.is_active = true
  loop
    -- Try to find matching customer_profile
    insert into public.deal_timing_alerts (
      workspace_id,
      alert_type, trigger_date, urgency, title, description, recommended_action
    ) values (
      p_workspace_id,
      'trade_in_interest', v_today,
      'immediate',
      v_rec.customer_name || ' interested in trading ' || v_rec.make || ' ' || v_rec.model,
      'Customer flagged trade-in interest via portal.',
      'Contact customer immediately with trade-in valuation and replacement options.'
    ) on conflict (workspace_id, customer_profile_id, alert_type, trigger_date) where status = 'pending' do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.compute_deal_timing_alerts(text) from public;
grant execute on function public.compute_deal_timing_alerts(text) to service_role;

-- ── Dashboard aggregation RPC ───────────────────────────────────────────────

create or replace function public.get_timing_dashboard(p_workspace_id text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total_alerts', count(*),
    'by_urgency', jsonb_build_object(
      'immediate', count(*) filter (where urgency = 'immediate'),
      'upcoming', count(*) filter (where urgency = 'upcoming'),
      'future', count(*) filter (where urgency = 'future')
    ),
    'by_type', jsonb_build_object(
      'budget_cycle', count(*) filter (where alert_type = 'budget_cycle'),
      'price_increase', count(*) filter (where alert_type = 'price_increase'),
      'equipment_aging', count(*) filter (where alert_type = 'equipment_aging'),
      'seasonal_pattern', count(*) filter (where alert_type = 'seasonal_pattern'),
      'trade_in_interest', count(*) filter (where alert_type = 'trade_in_interest')
    ),
    'alerts', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', dta.id,
        'alert_type', dta.alert_type,
        'urgency', dta.urgency,
        'title', dta.title,
        'description', dta.description,
        'recommended_action', dta.recommended_action,
        'trigger_date', dta.trigger_date,
        'status', dta.status,
        'customer_name', cpe.customer_name,
        'assigned_rep_id', dta.assigned_rep_id
      ) order by
        case dta.urgency when 'immediate' then 1 when 'upcoming' then 2 else 3 end,
        dta.trigger_date
    ), '[]'::jsonb)
  )
  from public.deal_timing_alerts dta
  left join public.customer_profiles_extended cpe on cpe.id = dta.customer_profile_id
  where dta.workspace_id = p_workspace_id
    and dta.status = 'pending';
$$;

revoke execute on function public.get_timing_dashboard(text) from public;
grant execute on function public.get_timing_dashboard(text) to authenticated, service_role;
