-- 384_post_build_schema_lint_repairs.sql
--
-- Post-build audit repairs for public RPCs that drifted away from the current
-- production schema. Each replacement keeps the existing public signature.

create or replace function public.flare_dedupe_count(
  p_route text,
  p_description text,
  p_first_error text default null,
  p_threshold real default 0.62
)
returns integer
language plpgsql
security definer
stable
set search_path = public, extensions, pg_temp
as $$
begin
  return (
    select count(*)::integer
    from public.flare_reports f
    where f.workspace_id = public.get_my_workspace()
      and f.created_at > now() - interval '7 days'
      and f.status <> 'duplicate'
      and (
        f.route = p_route
        or extensions.similarity(lower(coalesce(f.user_description, '')), lower(coalesce(p_description, ''))) >= p_threshold
        or (
          p_first_error is not null
          and jsonb_array_length(coalesce(f.console_errors, '[]'::jsonb)) > 0
          and extensions.similarity(
            lower(coalesce((f.console_errors -> 0 ->> 'message'), '')),
            lower(p_first_error)
          ) >= p_threshold
        )
      )
  );
exception
  when undefined_function then
    return (
      select count(*)::integer
      from public.flare_reports f
      where f.workspace_id = public.get_my_workspace()
        and f.created_at > now() - interval '7 days'
        and f.status <> 'duplicate'
        and f.route = p_route
    );
end;
$$;

create or replace function public.flare_recent_voice_capture(p_user_id uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id
  into v_id
  from public.voice_captures
  where user_id = p_user_id
    and created_at > now() - interval '5 minutes'
  order by created_at desc
  limit 1;

  return v_id;
exception
  when undefined_table then
    return null;
end;
$$;

create or replace function public.flare_recent_user_activity(p_user_id uuid)
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_row json;
begin
  select json_build_object(
    'id', a.id,
    'type', a.activity_type,
    'subject', coalesce(a.body, a.metadata ->> 'subject', a.metadata ->> 'title'),
    'occurred_at', a.occurred_at
  )
  into v_row
  from public.qrm_activities a
  where a.created_by = p_user_id
    and a.created_at > now() - interval '30 minutes'
    and a.deleted_at is null
  order by a.created_at desc
  limit 1;

  return v_row;
exception
  when undefined_table then
    return null;
end;
$$;

create or replace function public.crm_dispatch_due_follow_up_reminders(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_fired integer := 0;
  v_updated integer;
begin
  if p_limit is null or p_limit < 1 then
    p_limit := 50;
  end if;

  for r in
    select
      ri.id as reminder_id,
      ri.deal_id,
      ri.assigned_user_id,
      ri.workspace_id,
      d.name as deal_name
    from public.crm_reminder_instances ri
    join public.crm_deals d on d.id = ri.deal_id
    where ri.status = 'scheduled'
      and ri.deleted_at is null
      and ri.due_at <= now()
      and d.deleted_at is null
      and d.closed_at is null
    order by ri.due_at asc
    limit p_limit
  loop
    update public.crm_reminder_instances
    set status = 'fired',
        fired_at = now(),
        updated_at = now()
    where id = r.reminder_id
      and status = 'scheduled';

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      continue;
    end if;

    v_fired := v_fired + 1;

    insert into public.crm_in_app_notifications (
      workspace_id,
      user_id,
      kind,
      title,
      body,
      deal_id,
      reminder_instance_id
    )
    values (
      r.workspace_id,
      r.assigned_user_id,
      'follow_up_due',
      'Follow-up due',
      coalesce(r.deal_name, 'Deal'),
      r.deal_id,
      r.reminder_id
    )
    on conflict (reminder_instance_id) where reminder_instance_id is not null do nothing;
  end loop;

  return jsonb_build_object('fired', v_fired, 'at', now());
end;
$$;

create or replace function public.archive_crm_deal(p_deal_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deal public.crm_deals%rowtype;
begin
  select *
  into v_deal
  from public.crm_deals
  where id = p_deal_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.quote_packages q
    where q.workspace_id = v_deal.workspace_id
      and q.deal_id = p_deal_id
      and q.status <> 'archived'
  ) then
    raise exception 'DEAL_ARCHIVE_HAS_QUOTES';
  end if;

  if exists (
    select 1
    from public.sequence_enrollments se
    where se.deal_id = p_deal_id::text
      and se.status in ('active', 'paused')
  ) then
    raise exception 'DEAL_ARCHIVE_HAS_SEQUENCES';
  end if;

  update public.crm_deals
  set deleted_at = now()
  where id = p_deal_id
    and deleted_at is null
  returning * into v_deal;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_deal.id,
    'workspaceId', v_deal.workspace_id,
    'name', v_deal.name,
    'stageId', v_deal.stage_id,
    'primaryContactId', v_deal.primary_contact_id,
    'companyId', v_deal.company_id,
    'assignedRepId', v_deal.assigned_rep_id,
    'amount', v_deal.amount,
    'expectedCloseOn', v_deal.expected_close_on,
    'nextFollowUpAt', v_deal.next_follow_up_at,
    'lastActivityAt', v_deal.last_activity_at,
    'closedAt', v_deal.closed_at,
    'hubspotDealId', v_deal.hubspot_deal_id,
    'createdAt', v_deal.created_at,
    'updatedAt', v_deal.updated_at,
    'deletedAt', v_deal.deleted_at
  );
end;
$$;

create or replace function public.iron_top_flows(
  p_user_id uuid,
  p_limit integer default 6
) returns table (
  flow_slug text,
  execution_count bigint,
  last_used_at timestamptz,
  recency_score numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      def.slug as flow_slug,
      count(runs.id) as execution_count,
      max(coalesce(runs.finished_at, runs.started_at)) as last_used_at,
      (
        count(runs.id)::numeric /
        greatest(1, extract(epoch from (now() - max(coalesce(runs.finished_at, runs.started_at)))) / 86400)
      )::numeric(10, 4) as recency_score
    from public.flow_workflow_runs runs
    join public.flow_workflow_definitions def on def.id = runs.workflow_id
    where runs.attributed_user_id = p_user_id
      and runs.status = 'succeeded'
      and coalesce(runs.finished_at, runs.started_at) > now() - interval '60 days'
      and coalesce(runs.surface, def.surface) in ('iron_conversational', 'iron_voice')
    group by def.slug
    order by recency_score desc nulls last
    limit greatest(1, least(coalesce(p_limit, 6), 50));
end;
$$;

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
  v_financial_health numeric := 0;
  v_total numeric;
  v_components jsonb;
  v_service_visits_90d integer := 0;
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

  v_deal_velocity := least(25,
    (case when v_profile.last_interaction_at > now() - interval '30 days' then 8
          when v_profile.last_interaction_at > now() - interval '90 days' then 4 else 0 end) +
    (case when v_profile.last_deal_at > now() - interval '180 days' then 7 else 0 end) +
    (case when coalesce(v_profile.total_deals, 0) >= 3 then 10
          when coalesce(v_profile.total_deals, 0) >= 1 then 5 else 0 end)
  );

  v_service_engagement := least(25,
    (case when v_service_visits_90d >= 3 then 15
          when v_service_visits_90d >= 1 then 8 else 0 end) +
    (case when coalesce(v_profile.service_contract_rate, 0) >= 0.5 then 10
          when coalesce(v_profile.service_contract_rate, 0) > 0 then 5 else 0 end)
  );

  v_parts_revenue := least(25,
    (case when coalesce(v_profile.attachment_rate, 0) >= 0.5 then 15
          when coalesce(v_profile.attachment_rate, 0) > 0 then 8 else 0 end) +
    (case when coalesce(v_profile.lifetime_value, 0) >= 500000 then 10
          when coalesce(v_profile.lifetime_value, 0) >= 100000 then 7
          when coalesce(v_profile.lifetime_value, 0) >= 25000 then 4 else 0 end)
  );

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

create or replace function public.get_asset_badges(p_equipment_id uuid)
returns json
language plpgsql
security invoker
stable
as $$
declare
  v_open_wo integer;
  v_open_quotes integer;
  v_pending_parts integer := 0;
  v_overdue_intervals integer;
  v_trade_up_score integer;
  v_lifetime_parts numeric := 0;
  v_engine_hours numeric;
begin
  select e.engine_hours
  into v_engine_hours
  from public.crm_equipment e
  where e.id = p_equipment_id;

  if not found then
    return json_build_object(
      'open_work_orders', 0,
      'open_quotes', 0,
      'pending_parts_orders', 0,
      'overdue_intervals', 0,
      'trade_up_score', 0,
      'lifetime_parts_spend', 0
    );
  end if;

  select count(*)::integer
  into v_open_wo
  from public.service_jobs sj
  where sj.machine_id = p_equipment_id
    and sj.deleted_at is null
    and sj.closed_at is null
    and sj.current_stage::text not in ('invoiced', 'paid_closed');

  select count(*)::integer
  into v_open_quotes
  from public.crm_deal_equipment de
  join public.quote_packages q on q.deal_id = de.deal_id
  where de.equipment_id = p_equipment_id
    and q.status in ('draft', 'pending_approval', 'approved', 'approved_with_conditions', 'changes_requested', 'ready', 'sent', 'viewed');

  select count(*)::integer
  into v_overdue_intervals
  from public.equipment_service_intervals esi
  where esi.equipment_id = p_equipment_id
    and coalesce(v_engine_hours, 0) - coalesce(esi.last_completed_hours, 0) >= esi.interval_hours;

  v_trade_up_score := least(100, greatest(0,
    coalesce(v_engine_hours / 50, 0)::integer
    + coalesce(v_overdue_intervals, 0) * 5
    + (coalesce(v_lifetime_parts, 0) / 1000)::integer
  ));

  return json_build_object(
    'open_work_orders', coalesce(v_open_wo, 0),
    'open_quotes', coalesce(v_open_quotes, 0),
    'pending_parts_orders', coalesce(v_pending_parts, 0),
    'overdue_intervals', coalesce(v_overdue_intervals, 0),
    'trade_up_score', v_trade_up_score,
    'lifetime_parts_spend', coalesce(v_lifetime_parts, 0)
  );
end;
$$;

create or replace function public.get_asset_24h_activity(p_equipment_id uuid)
returns table (
  category text,
  event_type text,
  count int,
  last_at timestamptz,
  detail text
)
language plpgsql
security invoker
stable
as $$
begin
  return query
    select 'commercial'::text, 'quote_touched'::text, count(*)::integer, max(q.updated_at), null::text
    from public.quote_packages q
    join public.crm_deal_equipment de on de.deal_id = q.deal_id
    where de.equipment_id = p_equipment_id
      and q.updated_at > now() - interval '24 hours'
    having count(*) > 0;

  return query
    select 'service'::text, 'service_touched'::text, count(*)::integer, max(sj.updated_at), null::text
    from public.service_jobs sj
    where sj.machine_id = p_equipment_id
      and sj.updated_at > now() - interval '24 hours'
      and sj.deleted_at is null
    having count(*) > 0;
end;
$$;

create or replace function public.get_asset_360(p_equipment_id uuid)
returns json
language plpgsql
security invoker
stable
as $$
declare
  v_equipment json;
  v_company json;
  v_badges json;
  v_recent_service json;
  v_open_deal json;
begin
  select to_json(e.*)
  into v_equipment
  from public.crm_equipment e
  where e.id = p_equipment_id;

  if v_equipment is null then
    return null;
  end if;

  select to_json(c.*)
  into v_company
  from public.crm_companies c
  where c.id = (v_equipment ->> 'company_id')::uuid;

  v_badges := public.get_asset_badges(p_equipment_id);

  select json_agg(row_to_json(sj))
  into v_recent_service
  from (
    select
      id,
      customer_problem_summary,
      current_stage::text as current_stage,
      scheduled_start_at,
      scheduled_end_at,
      closed_at
    from public.service_jobs
    where machine_id = p_equipment_id
      and deleted_at is null
    order by created_at desc
    limit 5
  ) sj;

  select to_json(d)
  into v_open_deal
  from (
    select d.id, d.name, d.amount, d.stage_id, d.next_follow_up_at
    from public.crm_deal_equipment de
    join public.crm_deals d on d.id = de.deal_id
    where de.equipment_id = p_equipment_id
      and d.closed_at is null
      and d.deleted_at is null
    order by d.updated_at desc
    limit 1
  ) d;

  return json_build_object(
    'equipment', v_equipment,
    'company', v_company,
    'badges', v_badges,
    'recent_service', coalesce(v_recent_service, '[]'::json),
    'open_deal', v_open_deal
  );
end;
$$;

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
  v_attachment_upsell json := '[]'::json;
begin
  select coalesce(json_agg(row_to_json(e)), '[]'::json)
  into v_aging
  from (
    select e.id, e.name, e.make, e.model, e.year, e.engine_hours,
           'aging' as lens,
           'Engine hours past 4,000 - replacement window approaching' as reason
    from public.qrm_equipment e
    where e.company_id = p_company_id
      and e.deleted_at is null
      and e.engine_hours is not null
      and e.engine_hours >= 4000
    order by e.engine_hours desc
    limit 25
  ) e;

  select coalesce(json_agg(row_to_json(e)), '[]'::json)
  into v_expensive
  from (
    select *
    from (
      select e.id, e.name, e.make, e.model, e.year,
             coalesce((
               select sum(po.total)
               from public.parts_orders po
               join public.portal_customers pc on pc.id = po.portal_customer_id
               where pc.crm_company_id = p_company_id
                 and po.fleet_id is not null
             ), 0) as lifetime_parts_spend,
             'expensive_to_maintain' as lens,
             'Lifetime parts spend crossing the cost-curve heuristic' as reason
      from public.qrm_equipment e
      where e.company_id = p_company_id
        and e.deleted_at is null
      order by e.engine_hours desc nulls last
      limit 10
    ) ranked
    where ranked.lifetime_parts_spend > 5000
  ) e;

  select coalesce(json_agg(row_to_json(e)), '[]'::json)
  into v_trade_up
  from (
    select *
    from (
      select e.id, e.name, e.make, e.model, e.year, e.engine_hours,
             (public.get_asset_badges(e.id) ->> 'trade_up_score')::integer as trade_up_score,
             'trade_up_window' as lens,
             'Trade-up score 70+ - high-priority commercial opportunity' as reason
      from public.qrm_equipment e
      where e.company_id = p_company_id
        and e.deleted_at is null
      order by e.engine_hours desc nulls last
      limit 50
    ) scored
    where scored.trade_up_score >= 70
    limit 25
  ) e;

  select coalesce(json_agg(row_to_json(e)), '[]'::json)
  into v_underutilized
  from (
    select e.id, e.name, e.make, e.model, e.year, e.engine_hours, e.updated_at,
           'underutilized' as lens,
           'No equipment activity in 30+ days - under-utilized asset' as reason
    from public.qrm_equipment e
    where e.company_id = p_company_id
      and e.deleted_at is null
      and e.updated_at < now() - interval '30 days'
    order by e.updated_at asc
    limit 25
  ) e;

  return json_build_object(
    'aging', v_aging,
    'expensive_to_maintain', v_expensive,
    'trade_up_window', v_trade_up,
    'underutilized', v_underutilized,
    'attachment_upsell', v_attachment_upsell
  );
end;
$$;

create or replace function public.match_hub_knowledge(
  p_query_embedding extensions.vector(1536),
  p_workspace text default null,
  p_match_count integer default 8,
  p_min_similarity double precision default 0.72
)
returns table (
  chunk_id uuid,
  source_id uuid,
  chunk_index integer,
  body text,
  similarity double precision,
  source_title text,
  source_type text,
  notebooklm_source_id text,
  related_build_item_id uuid,
  related_decision_id uuid,
  related_feedback_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
begin
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  elsif p_workspace is not null and length(p_workspace) > 0 then
    ws := p_workspace;
  else
    ws := 'default';
  end if;

  return query
    select
      c.id as chunk_id,
      c.source_id,
      c.chunk_index,
      c.body,
      1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity,
      s.title as source_title,
      s.source_type,
      s.notebooklm_source_id,
      s.related_build_item_id,
      s.related_decision_id,
      s.related_feedback_id
    from public.hub_knowledge_chunk c
    join public.hub_knowledge_source s on s.id = c.source_id
    where c.workspace_id = ws
      and s.deleted_at is null
      and c.embedding is not null
      and (1 - (c.embedding operator(extensions.<=>) p_query_embedding)) >= p_min_similarity
    order by c.embedding operator(extensions.<=>) p_query_embedding
    limit greatest(1, least(p_match_count, 50));
end;
$$;

drop function if exists public.match_hub_feedback_dedup(
  extensions.vector(1536), uuid, double precision, integer, integer
);

create or replace function public.match_hub_feedback_dedup(
  p_query_embedding extensions.vector(1536),
  p_exclude_id uuid default null,
  p_min_similarity double precision default 0.85,
  p_max_age_days integer default 45,
  p_match_count integer default 3,
  p_workspace text default null
)
returns table (
  feedback_id uuid,
  submitted_by uuid,
  body text,
  ai_summary text,
  status text,
  priority text,
  similarity double precision,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
begin
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  elsif p_workspace is not null and length(p_workspace) > 0 then
    ws := p_workspace;
  else
    ws := 'default';
  end if;

  return query
    select
      f.id as feedback_id,
      f.submitted_by,
      f.body,
      f.ai_summary,
      f.status::text,
      f.priority::text,
      1 - (f.embedding operator(extensions.<=>) p_query_embedding) as similarity,
      f.created_at
    from public.hub_feedback f
    where f.workspace_id = ws
      and f.deleted_at is null
      and f.embedding is not null
      and f.status not in ('shipped', 'wont_fix')
      and f.created_at >= now() - make_interval(days => greatest(1, p_max_age_days))
      and (p_exclude_id is null or f.id <> p_exclude_id)
      and (1 - (f.embedding operator(extensions.<=>) p_query_embedding)) >= p_min_similarity
    order by f.embedding operator(extensions.<=>) p_query_embedding
    limit greatest(1, least(p_match_count, 10));
end;
$$;

create or replace function public.run_data_quality_audit()
returns table (issue_class text, found_count int)
language plpgsql
security invoker
as $$
#variable_conflict use_column
declare
  v_count integer;
begin
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
  select 'equipment_no_owner', 'error', 'crm_equipment', e.id,
         jsonb_build_object('name', e.name), now()
  from public.crm_equipment e
  where e.company_id is null
    and e.deleted_at is null
  on conflict (workspace_id, issue_class, entity_table, entity_id)
  do update set last_checked = now(), status = 'open';

  get diagnostics v_count = row_count;
  issue_class := 'equipment_no_owner';
  found_count := v_count;
  return next;
end;
$$;

revoke execute on function public.flare_dedupe_count(text, text, text, real) from public;
grant execute on function public.flare_dedupe_count(text, text, text, real) to authenticated, service_role;

revoke execute on function public.crm_dispatch_due_follow_up_reminders(integer) from public;
grant execute on function public.crm_dispatch_due_follow_up_reminders(integer) to service_role, postgres;

revoke execute on function public.archive_crm_deal(uuid) from public;
grant execute on function public.archive_crm_deal(uuid) to authenticated, service_role;

revoke execute on function public.iron_top_flows(uuid, integer) from public;
grant execute on function public.iron_top_flows(uuid, integer) to authenticated, service_role;

revoke execute on function public.compute_customer_health_score(uuid) from public;
grant execute on function public.compute_customer_health_score(uuid) to authenticated, service_role;

revoke execute on function public.compute_ownership_health_score(text) from public;
grant execute on function public.compute_ownership_health_score(text) to authenticated, service_role;

revoke execute on function public.match_hub_knowledge(extensions.vector(1536), text, integer, double precision) from public;
grant execute on function public.match_hub_knowledge(extensions.vector(1536), text, integer, double precision) to authenticated, service_role;

revoke execute on function public.match_hub_feedback_dedup(extensions.vector(1536), uuid, double precision, integer, integer, text) from public;
grant execute on function public.match_hub_feedback_dedup(extensions.vector(1536), uuid, double precision, integer, integer, text) to authenticated, service_role;
