-- NAV-004/006 and BUS-003. Preserve legacy diagnostics; supply authoritative operational facts.
-- Rollback: restore frontend before removing new RPCs; appended view columns may remain.
begin;
create or replace view public.v_rep_pipeline with (security_barrier = true, security_invoker = true) as
select
  d.id as deal_id,
  d.company_id,
  co.name as customer_name,
  ct.first_name || ' ' || ct.last_name as primary_contact_name,
  ct.phone as primary_contact_phone,
  s.name as stage,
  s.sort_order as stage_sort,
  d.amount,
  d.name as deal_name,
  d.created_at,
  d.updated_at,
  d.expected_close_on,
  d.last_activity_at,
  d.next_follow_up_at,
  extract(day from now() - d.last_activity_at) as days_since_activity,
  case
    when extract(day from now() - d.last_activity_at) > 14 then 'cold'
    when extract(day from now() - d.last_activity_at) > 7 then 'cooling'
    else 'warm'
  end as heat_status,
  d.deal_score,
  d.stage_id,
  s.probability as stage_probability
from public.crm_deals d
join public.crm_companies co on co.id = d.company_id
join public.crm_deal_stages s on s.id = d.stage_id
left join public.crm_contacts ct on ct.id = d.primary_contact_id
where d.deleted_at is null
  and d.assigned_rep_id = auth.uid()
  and d.closed_at is null
order by
  s.sort_order asc,
  d.last_activity_at desc nulls last;

grant select on public.v_rep_pipeline to authenticated;
create or replace function public.select_equipment_invoice_candidates(p_limit integer default 50)
returns table(deal_id uuid) language plpgsql security definer set search_path=''
as $$ begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 return query select d.id from public.crm_deals d join public.crm_deal_stages s on s.id=d.stage_id
 where d.deleted_at is null and (s.name in ('Delivery Completed','Invoice Closed') or s.is_closed_won)
 and exists(select 1 from public.quote_packages q where q.deal_id=d.id and q.workspace_id=d.workspace_id and q.status in ('accepted','converted_to_deal'))
 and not exists(select 1 from public.customer_invoices i where i.deal_id=d.id and i.workspace_id=d.workspace_id and i.invoice_type='equipment' and i.reversal_of_invoice_id is null)
 order by d.updated_at,d.id limit greatest(1,least(coalesce(p_limit,50),50));
end;$$;
revoke all on function public.select_equipment_invoice_candidates(integer) from public,anon,authenticated;
grant execute on function public.select_equipment_invoice_candidates(integer) to service_role;

create or replace function public.service_owner_metrics(p_workspace_id text default null)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare result jsonb; w text:=coalesce(p_workspace_id,public.get_my_workspace());
begin
 if not public.service_can_view_metrics() or (auth.role() is distinct from 'service_role' and w is distinct from public.get_my_workspace()) then
  raise exception 'Service metrics access denied' using errcode='42501';
 end if;
 with jobs as (
  select * from public.service_jobs where workspace_id=w and deleted_at is null
 ), closed_jobs as (
  select * from jobs where closed_at>=now()-interval '30 days' and closed_at>=coalesce(opened_at,created_at)
 ), facts as (
  select j.id job_id,j.request_type::text request_type,l.customer_invoice_id,
    l.labor_sale_cents::numeric revenue,case when l.labor_cost_rate_cents is not null or l.labor_cost_cents>0 then l.labor_cost_cents::numeric else null end cost,true labor
  from jobs j join public.service_labor_ledger l on l.service_job_id=j.id and l.workspace_id=w
  where l.deleted_at is null and l.billed_status::text in ('billed','paid')
  union all
  select j.id,j.request_type::text,b.customer_invoice_id,b.extended_price_cents::numeric,case when b.unit_cost_cents is not null or b.extended_cost_cents>0 then b.extended_cost_cents::numeric else null end,false
  from jobs j join public.service_billing_rows b on b.service_job_id=j.id and b.workspace_id=w
  where b.deleted_at is null and b.billed_status::text in ('billed','paid') and b.row_type::text<>'labor'
 ), margins as (
  select w workspace_id,request_type,count(distinct job_id)::integer job_count,count(distinct customer_invoice_id)::integer quote_count,
    count(cost)::integer marginable_line_count,
    count(*) filter(where cost is null)::integer missing_cost_line_count,
    count(*) filter(where labor and revenue>0 and (revenue-cost)/revenue<0.35)::integer below_floor_line_count,
    count(*) filter(where labor and revenue>0 and (revenue-cost)/revenue>=0.55)::integer target_met_line_count,
    round(sum(revenue)/100,2) total_revenue,round(sum(cost)/100,2) total_margin_cost_basis,
    case when count(*) filter(where cost is null)>0 then null else round(sum(revenue-cost)/100,2) end total_margin_amount,
    case when count(*) filter(where cost is null)>0 then null else round(100*sum(revenue-cost)/nullif(sum(revenue),0),2) end margin_pct,
    null::timestamptz latest_quote_created_at
  from facts group by request_type
 ), cycles as (
  select w workspace_id,request_type::text segment_name,
    count(*) filter(where closed_at is null)::integer open_segment_count,
    count(*) filter(where closed_at>=now()-interval '30 days')::integer completed_segment_count,
    round(avg(extract(epoch from(closed_at-coalesce(opened_at,created_at)))/3600) filter(where closed_at>=now()-interval '30 days' and closed_at>=coalesce(opened_at,created_at)),2) avg_actual_duration_hours,
    null::numeric avg_target_duration_hours,null::numeric on_time_pct,max(closed_at) latest_completed_at
  from jobs group by request_type
 ), labor_hours as (
  select j.shop_or_field,coalesce(tc.hours,0)::numeric hours
  from jobs j join public.service_timecards tc on tc.service_job_id=j.id and tc.workspace_id=w
  where tc.clocked_in_at>=now()-interval '30 days'
  union all
  select j.shop_or_field,coalesce(l.actual_hours,0)::numeric
  from jobs j join public.service_labor_ledger l on l.service_job_id=j.id and l.workspace_id=w
  where l.deleted_at is null and l.service_timecard_id is null and coalesce(l.labor_date::timestamptz,l.created_at)>=now()-interval '30 days'
 ), warranty as (
  select count(*)::integer filed_count,coalesce(sum(requested_amount_cents),0)::numeric requested,
   coalesce(sum(paid_amount_cents),0)::numeric paid,
   coalesce(sum(greatest(coalesce(approved_amount_cents,requested_amount_cents)-coalesce(paid_amount_cents,0),0)) filter(where status not in ('denied','cancelled')),0)::numeric outstanding
  from public.service_warranty_claims where workspace_id=w and deleted_at is null and submitted_at is not null
 ), hour_summary as (
  select coalesce(sum(hours) filter(where shop_or_field='shop'),0) shop_hours,
   coalesce(sum(hours) filter(where shop_or_field='field'),0) field_hours from labor_hours
 )
 select jsonb_build_object(
  'margin_by_type',coalesce((select jsonb_agg(to_jsonb(m)) from margins m),'[]'::jsonb),
  'cycle_by_type',coalesce((select jsonb_agg(to_jsonb(c)) from cycles c),'[]'::jsonb),
  'owner_summary',jsonb_build_object(
   'workspace_id',w,
   'avg_cycle_time_hours',(select round(avg(extract(epoch from(closed_at-coalesce(opened_at,created_at)))/3600),2) from closed_jobs),
   'completed_tat_count',(select count(*) from closed_jobs),
   'avg_technician_efficiency_pct',null,'attendance_source_status','awaiting_owner_source','avg_cycle_target_hours',null,'tat_on_time_pct',null,
   'shop_hours_30d',h.shop_hours,'field_hours_30d',h.field_hours,
   'field_mix_pct',round(100*h.field_hours/nullif(h.shop_hours+h.field_hours,0),2),
   'warranty_revenue_cents',c.paid,'warranty_cost_cents',c.requested,
   'warranty_filed_count',c.filed_count,'warranty_outstanding_cents',c.outstanding,
   'warranty_recovery_pct',round(100*c.paid/nullif(c.requested,0),2),'computed_at',now()
  )) into result from warranty c cross join hour_summary h;
 return result;
end;$$;
revoke all on function public.service_owner_metrics(text) from public,anon;
grant execute on function public.service_owner_metrics(text) to authenticated,service_role;
comment on function public.service_owner_metrics(text) is
 'NAV-004: completed-WO duration and type cohorts, recorded labor-hour mix, filed/paid/outstanding OEM claims, posted whole-job contribution including Parts lines. Department posting remains unchanged; quote estimates remain separately available.';
commit;
