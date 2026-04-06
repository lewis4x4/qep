-- ============================================================================
-- Migration 127: Deal composite — full activity timeline
--
-- Prior RPC capped activities at 20; deal detail previously loaded all
-- activities via listDealActivities. Align composite with that behavior.
-- ============================================================================

create or replace function public.get_deal_composite(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_workspace text;
  v_deal jsonb;
  v_stage jsonb;
  v_contact jsonb;
  v_company jsonb;
  v_assessment jsonb;
  v_cadences jsonb;
  v_demos jsonb;
  v_deposit jsonb;
  v_activities jsonb;
  v_loss_fields jsonb;
begin
  v_workspace := public.get_my_workspace();

  select to_jsonb(d.*) into v_deal
  from public.crm_deals d
  where d.id = p_deal_id
    and d.workspace_id = v_workspace
    and d.deleted_at is null;

  if v_deal is null then
    return jsonb_build_object('error', 'Deal not found');
  end if;

  select to_jsonb(s.*) into v_stage
  from public.crm_deal_stages s
  where s.id = (v_deal ->> 'stage_id')::uuid;

  if v_deal ->> 'primary_contact_id' is not null then
    select to_jsonb(c.*) into v_contact
    from public.crm_contacts c
    where c.id = (v_deal ->> 'primary_contact_id')::uuid
      and c.workspace_id = v_workspace
      and c.deleted_at is null;
  end if;

  if v_deal ->> 'company_id' is not null then
    select to_jsonb(co.*) into v_company
    from public.crm_companies co
    where co.id = (v_deal ->> 'company_id')::uuid
      and co.workspace_id = v_workspace
      and co.deleted_at is null;
  end if;

  select to_jsonb(na.*) into v_assessment
  from public.needs_assessments na
  where na.deal_id = p_deal_id
  order by na.created_at desc
  limit 1;

  select coalesce(jsonb_agg(
    to_jsonb(fc.*) || jsonb_build_object(
      'touchpoints', (
        select coalesce(jsonb_agg(to_jsonb(tp.*) order by tp.scheduled_date), '[]'::jsonb)
        from public.follow_up_touchpoints tp
        where tp.cadence_id = fc.id
      )
    )
  ), '[]'::jsonb) into v_cadences
  from public.follow_up_cadences fc
  where fc.deal_id = p_deal_id;

  select coalesce(jsonb_agg(
    to_jsonb(dm.*) || jsonb_build_object(
      'inspections', (
        select coalesce(jsonb_agg(to_jsonb(di.*)), '[]'::jsonb)
        from public.demo_inspections di
        where di.demo_id = dm.id
      )
    )
  ), '[]'::jsonb) into v_demos
  from public.demos dm
  where dm.deal_id = p_deal_id;

  select to_jsonb(dep.*) into v_deposit
  from public.deposits dep
  where dep.deal_id = p_deal_id
    and dep.status not in ('refunded', 'refund_requested')
  order by dep.created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(a.*) order by a.occurred_at desc), '[]'::jsonb) into v_activities
  from (
    select * from public.crm_activities
    where deal_id = p_deal_id and deleted_at is null
    order by occurred_at desc
  ) a;

  v_loss_fields := jsonb_build_object(
    'loss_reason', v_deal ->> 'loss_reason',
    'competitor', v_deal ->> 'competitor'
  );

  return jsonb_build_object(
    'deal', v_deal,
    'stage', v_stage,
    'contact', v_contact,
    'company', v_company,
    'needs_assessment', v_assessment,
    'cadences', v_cadences,
    'demos', v_demos,
    'deposit', v_deposit,
    'activities', v_activities,
    'loss_fields', v_loss_fields
  );
end;
$$;

revoke execute on function public.get_deal_composite(uuid) from public;
grant execute on function public.get_deal_composite(uuid) to authenticated, service_role;
