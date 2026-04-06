-- ============================================================================
-- Migration 150: Health Score Computation + Cross-Department Alert Generation
-- ============================================================================

-- ── 1. Compute customer health score (4 components, 0-25 each) ──────────────

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
begin
  select * into v_profile from public.customer_profiles_extended where id = p_customer_profile_id;
  if not found then return null; end if;

  -- Component 1: Deal Velocity (0-25)
  -- Based on: recent deal activity, pipeline presence, total deals
  v_deal_velocity := least(25,
    (case when v_profile.last_deal_at > now() - interval '180 days' then 10 else 0 end) +
    (case when v_profile.total_deals >= 3 then 10 when v_profile.total_deals >= 1 then 5 else 0 end) +
    (case when v_profile.last_interaction_at > now() - interval '30 days' then 5 else 0 end)
  );

  -- Component 2: Service Engagement (0-25)
  -- Based on: service contract adoption, recent service activity
  v_service_engagement := least(25,
    (case when coalesce(v_profile.service_contract_rate, 0) >= 0.5 then 15
          when coalesce(v_profile.service_contract_rate, 0) > 0 then 8 else 0 end) +
    (case when v_profile.fleet_size >= 3 then 10 when v_profile.fleet_size >= 1 then 5 else 0 end)
  );

  -- Component 3: Parts Revenue (0-25)
  -- Based on: attachment rate, parts purchase patterns
  v_parts_revenue := least(25,
    (case when coalesce(v_profile.attachment_rate, 0) >= 0.5 then 15
          when coalesce(v_profile.attachment_rate, 0) > 0 then 8 else 0 end) +
    (case when coalesce(v_profile.lifetime_value, 0) >= 500000 then 10
          when coalesce(v_profile.lifetime_value, 0) >= 100000 then 7
          when coalesce(v_profile.lifetime_value, 0) >= 25000 then 4 else 0 end)
  );

  -- Component 4: Financial Health (0-25)
  -- Based on: avg discount (low = healthy), days to close (fast = healthy)
  v_financial_health := least(25,
    (case when coalesce(v_profile.avg_discount_pct, 0) < 5 then 15
          when coalesce(v_profile.avg_discount_pct, 0) < 10 then 10
          when coalesce(v_profile.avg_discount_pct, 0) < 15 then 5 else 0 end) +
    (case when coalesce(v_profile.avg_days_to_close, 999) < 30 then 10
          when coalesce(v_profile.avg_days_to_close, 999) < 60 then 7
          when coalesce(v_profile.avg_days_to_close, 999) < 90 then 4 else 0 end)
  );

  v_total := v_deal_velocity + v_service_engagement + v_parts_revenue + v_financial_health;
  v_components := jsonb_build_object(
    'deal_velocity', v_deal_velocity,
    'service_engagement', v_service_engagement,
    'parts_revenue', v_parts_revenue,
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

revoke execute on function public.compute_customer_health_score(uuid) from public;
grant execute on function public.compute_customer_health_score(uuid) to authenticated, service_role;

-- ── 2. Generate cross-department alerts ─────────────────────────────────────

create or replace function public.generate_cross_department_alerts(p_workspace_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_rec record;
begin
  -- AR → Sales: overdue invoices block quoting
  for v_rec in
    select ci.portal_customer_id, pc.crm_contact_id,
           sum(ci.balance_due) as total_overdue,
           pc.first_name || ' ' || pc.last_name as customer_name
    from public.customer_invoices ci
    join public.portal_customers pc on pc.id = ci.portal_customer_id
    where ci.status in ('pending', 'sent', 'overdue')
      and ci.due_date < current_date - interval '60 days'
      and ci.workspace_id = p_workspace_id
    group by ci.portal_customer_id, pc.crm_contact_id, pc.first_name, pc.last_name
    having sum(ci.balance_due) > 0
  loop
    insert into public.cross_department_alerts (
      workspace_id, source_department, target_department,
      alert_type, severity, title, body,
      context_entity_type
    ) values (
      p_workspace_id, 'finance', 'sales',
      'overdue_ar', 'critical',
      'Hold quoting: ' || v_rec.customer_name || ' has $' || v_rec.total_overdue::int || ' past due',
      'Customer has invoices past 60 days. Collect outstanding balance before processing new quotes.',
      'invoice'
    ) on conflict (workspace_id, customer_profile_id, alert_type, source_department) where status = 'pending' do nothing;
    v_count := v_count + 1;
  end loop;

  -- Portal → Sales: trade-in interest (from Wave 1)
  for v_rec in
    select cf.portal_customer_id,
           pc.first_name || ' ' || pc.last_name as customer_name,
           cf.make, cf.model
    from public.customer_fleet cf
    join public.portal_customers pc on pc.id = cf.portal_customer_id
    where cf.trade_in_interest = true and cf.is_active = true
  loop
    insert into public.cross_department_alerts (
      workspace_id, source_department, target_department,
      alert_type, severity, title, body,
      context_entity_type
    ) values (
      p_workspace_id, 'portal', 'sales',
      'trade_in_interest', 'warning',
      v_rec.customer_name || ' wants to trade ' || v_rec.make || ' ' || v_rec.model,
      'Customer flagged trade-in interest via portal. Contact with valuation and replacement options.',
      'fleet_item'
    ) on conflict (workspace_id, customer_profile_id, alert_type, source_department) where status = 'pending' do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.generate_cross_department_alerts(text) from public;
grant execute on function public.generate_cross_department_alerts(text) to service_role;
