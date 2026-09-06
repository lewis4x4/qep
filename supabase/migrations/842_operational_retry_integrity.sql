-- DATA-007 / ADD-001 / ADD-002: auditable domain commands, not partial writes.
-- Rollback: retain picks/evidence; remove new RPC grants/triggers before replacing callers.
begin;
create table public.parts_order_picks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  parts_order_id uuid not null references public.parts_orders(id),
  parts_order_line_id uuid not null unique references public.parts_order_lines(id),
  part_number text not null, branch_id text not null, quantity integer not null check(quantity>0),
  picked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.parts_order_picks enable row level security;
create policy parts_order_picks_read on public.parts_order_picks for select to authenticated
using(workspace_id=(select public.get_my_workspace()) and (select public.get_my_role())::text in ('rep','admin','manager','owner','service_writer','dispatch','parts_counter'));
grant select on public.parts_order_picks to authenticated;
-- Backfill only exact, durable prior pick evidence; never adjust historical stock.
insert into public.parts_order_picks(workspace_id,parts_order_id,parts_order_line_id,part_number,branch_id,quantity,picked_by,created_at)
select distinct on(l.id) o.workspace_id,o.id,l.id,l.part_number,e.metadata->>'branch_id',l.quantity::integer,e.actor_id,e.created_at
from public.parts_order_events e join public.parts_order_lines l on e.metadata->>'line_id'=l.id::text
join public.parts_orders o on o.id=l.parts_order_id and o.id=e.parts_order_id
where e.event_type='pick_completed' and nullif(e.metadata->>'branch_id','') is not null
  and l.quantity>0 and l.quantity=trunc(l.quantity) and e.workspace_id=o.workspace_id
  and e.metadata->>'part_number'=l.part_number
  and case when e.metadata->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (e.metadata->>'quantity')::numeric=l.quantity else false end
order by l.id,e.created_at;

create or replace function public.pick_parts_order_line_once(p_order_id uuid,p_line_id uuid,p_branch_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare o public.parts_orders; l public.parts_order_lines; picked public.parts_order_picks;
begin
  if auth.uid() is null or public.get_my_role()::text not in ('rep','admin','manager','owner','service_writer','dispatch','parts_counter') then
    raise exception 'Parts pick requires an authorized operator' using errcode='42501';
  end if;
  select * into o from public.parts_orders where id=p_order_id and workspace_id=public.get_my_workspace() for update;
  if not found then raise exception 'Order not found in workspace' using errcode='42501';end if;
  select * into l from public.parts_order_lines where id=p_line_id and parts_order_id=o.id for update;
  if not found then raise exception 'Order line not found';end if;
  select * into picked from public.parts_order_picks where parts_order_line_id=l.id;
  if found then
    if picked.part_number is distinct from l.part_number or picked.quantity is distinct from l.quantity then raise exception 'Order line changed after picking; reconcile the recorded pick first';end if;
    if picked.branch_id is distinct from p_branch_id then raise exception 'Line already picked from another branch';end if;
    return jsonb_build_object('picked',to_jsonb(picked),'already_picked',true);
  end if;
  if exists(select 1 from public.parts_order_events e where e.parts_order_id=o.id and e.event_type='pick_completed' and e.metadata->>'line_id'=l.id::text) then raise exception 'Historical pick evidence requires reconciliation before another stock movement';end if;
  if o.status not in ('confirmed','processing') then raise exception 'Pick requires confirmed or processing order';end if;
  if coalesce(o.order_source,'portal')<>'portal' then
    if coalesce(o.payment_classification,'cash')='cash' and coalesce(o.payment_status,'unpaid')<>'paid' then
      raise exception 'Cash counter ticket must be paid before release';
    elsif o.payment_classification='charge' and coalesce(o.charge_authorization_status,'') not in ('approved_credit','exec_approved') then
      raise exception 'Charge ticket requires credit authorization';
    end if;
  end if;
  if l.quantity<=0 or l.quantity<>trunc(l.quantity) or nullif(trim(p_branch_id),'') is null then raise exception 'Valid whole quantity and branch required';end if;
  perform public.adjust_parts_inventory_delta_strict(o.workspace_id,p_branch_id,l.part_number,-l.quantity::integer);
  insert into public.parts_order_picks(workspace_id,parts_order_id,parts_order_line_id,part_number,branch_id,quantity,picked_by)
  values(o.workspace_id,o.id,l.id,l.part_number,p_branch_id,l.quantity::integer,auth.uid()) returning * into picked;
  update public.parts_orders set status='processing',updated_at=now() where id=o.id;
  if o.fulfillment_run_id is not null then
    insert into public.parts_fulfillment_events(workspace_id,fulfillment_run_id,event_type,payload)
    values(o.workspace_id,o.fulfillment_run_id,'counter_order_picked',jsonb_build_object('parts_order_id',o.id,'parts_order_line_id',l.id,'part_number',l.part_number,'quantity',l.quantity,'branch_id',p_branch_id,'picked_by',auth.uid()));
  end if;
  insert into public.parts_order_events(workspace_id,parts_order_id,event_type,source,actor_id,metadata)
  values(o.workspace_id,o.id,'pick_completed','manual',auth.uid(),jsonb_build_object('line_id',l.id,'part_number',l.part_number,'quantity',l.quantity,'branch_id',p_branch_id));
  return jsonb_build_object('picked',to_jsonb(picked),'already_picked',false);
end;$$;
revoke all on function public.pick_parts_order_line_once(uuid,uuid,text) from public,anon;
grant execute on function public.pick_parts_order_line_once(uuid,uuid,text) to authenticated;

-- Historical duplicates are preserved as evidence. Completion is evaluated by
-- distinct template steps, never by number of completion records.
alter table public.sop_step_completions add column if not exists updated_at timestamptz not null default now();
create or replace function public.sop_step_is_resolved(p_execution_id uuid,p_step_id uuid)
returns boolean language sql volatile security definer set search_path=''
as $$ select coalesce((select completion_state='completed' or (completion_state in ('not_applicable','satisfied_elsewhere') and length(trim(coalesce(notes,'')))>0)
 from public.sop_step_completions where sop_execution_id=p_execution_id and sop_step_id=p_step_id
 order by updated_at desc,completed_at desc,id desc limit 1),false) $$;
revoke all on function public.sop_step_is_resolved(uuid,uuid) from public,anon,authenticated;
create or replace function public.sop_execution_has_unresolved_steps(p_execution_id uuid)
returns boolean language sql volatile security definer set search_path=''
as $$ select exists(select 1 from public.sop_executions e join public.sop_steps s on s.sop_template_id=e.sop_template_id
 where e.id=p_execution_id and not public.sop_step_is_resolved(e.id,s.id)) $$;
revoke all on function public.sop_execution_has_unresolved_steps(uuid) from public,anon,authenticated;
create or replace function public.guard_sop_execution_completion()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
 if tg_op='INSERT' and new.status='completed' then raise exception 'Create an open SOP execution before completing steps' using errcode='23514';end if;
 if new.status='completed' and exists(select 1 from public.sop_steps step where step.sop_template_id=new.sop_template_id and not public.sop_step_is_resolved(new.id,step.id)) then
  raise exception 'Unresolved SOP steps remain; complete or explicitly resolve each step first' using errcode='23514';end if;
 return new;end;$$;
create trigger sop_execution_completion_guard before insert or update of status,sop_template_id on public.sop_executions for each row execute function public.guard_sop_execution_completion();
revoke all on function public.guard_sop_execution_completion() from public,anon,authenticated;
create or replace function public.prepare_sop_resolution_evidence()
returns trigger language plpgsql security definer set search_path=''
as $$ declare workspace text;begin
 if tg_op='UPDATE' and (new.sop_execution_id is distinct from old.sop_execution_id or new.sop_step_id is distinct from old.sop_step_id or new.completed_by is distinct from old.completed_by) then
  raise exception 'Resolution evidence identity is immutable; append a correction';end if;
 select e.workspace_id into workspace from public.sop_executions e join public.sop_steps s on s.sop_template_id=e.sop_template_id where e.id=new.sop_execution_id and s.id=new.sop_step_id;
 if not found then raise exception 'Resolution step does not belong to the execution';end if;
 if auth.role() is distinct from 'service_role' and workspace is distinct from public.get_my_workspace() then raise exception 'Resolution outside workspace' using errcode='42501';end if;
 new.workspace_id:=workspace;new.updated_at:=clock_timestamp();
 if tg_op='INSERT' and auth.role() is distinct from 'service_role' then new.completed_by:=auth.uid();end if;
 return new;end;$$;
create trigger sop_resolution_identity before insert or update on public.sop_step_completions for each row execute function public.prepare_sop_resolution_evidence();
revoke all on function public.prepare_sop_resolution_evidence() from public,anon,authenticated;
create or replace function public.reconcile_sop_completion_state()
returns trigger language plpgsql security definer set search_path=''
as $$ declare execution_id uuid;begin
 execution_id:=case when tg_op='DELETE' then old.sop_execution_id else new.sop_execution_id end;
 perform 1 from public.sop_executions where id=execution_id for update;
 if public.sop_execution_has_unresolved_steps(execution_id) then
  update public.sop_executions set status='blocked',completed_at=null where id=execution_id and status='completed';
 end if;
 if tg_op='DELETE' then return old;end if;return new;end;$$;
create trigger sop_resolution_reconcile after insert or update or delete on public.sop_step_completions for each row execute function public.reconcile_sop_completion_state();
revoke all on function public.reconcile_sop_completion_state() from public,anon,authenticated;

create or replace function public.complete_sop_step_once(p_execution_id uuid,p_step_id uuid,p_details jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare e public.sop_executions; s public.sop_steps; c public.sop_step_completions; desired text;
begin
 select * into e from public.sop_executions where id=p_execution_id and workspace_id=public.get_my_workspace() for update;
 if not found or auth.uid() is null then raise exception 'SOP execution not visible' using errcode='42501';end if;
 select * into s from public.sop_steps where id=p_step_id and sop_template_id=e.sop_template_id;
 if not found then raise exception 'Step does not belong to execution template' using errcode='23514';end if;
 select * into c from public.sop_step_completions where sop_execution_id=e.id and sop_step_id=s.id order by updated_at desc,completed_at desc,id desc limit 1;
 if found and public.sop_step_is_resolved(e.id,s.id) then return to_jsonb(c);end if;
 if e.status not in ('in_progress','blocked') then raise exception 'Execution is not open';end if;
 desired:=coalesce(p_details->>'completion_state','completed');
 if desired not in ('completed','deferred','satisfied_elsewhere','not_applicable') then raise exception 'Invalid completion state';end if;
 if desired in ('satisfied_elsewhere','not_applicable') and nullif(trim(p_details->>'notes'),'') is null then raise exception 'Reason required for explicit step resolution';end if;
 insert into public.sop_step_completions(workspace_id,sop_execution_id,sop_step_id,completed_by,decision_taken,notes,evidence_urls,duration_minutes,completion_state)
 values(e.workspace_id,e.id,s.id,auth.uid(),p_details->>'decision_taken',p_details->>'notes',coalesce(p_details->'evidence_urls','[]'),nullif(p_details->>'duration_minutes','')::integer,desired) returning * into c;
 if not public.sop_execution_has_unresolved_steps(e.id) then
   update public.sop_executions set status='completed',completed_at=now() where id=e.id;
 end if;
 return to_jsonb(c);
end;$$;
revoke all on function public.complete_sop_step_once(uuid,uuid,jsonb) from public,anon;
grant execute on function public.complete_sop_step_once(uuid,uuid,jsonb) to authenticated;

create or replace function public.flow_resume_run(p_run_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare r public.flow_workflow_runs; e public.analytics_events; new_event uuid;
begin
 select * into r from public.flow_workflow_runs where id=p_run_id for update;
 if not found then raise exception 'Workflow run not found';end if;
 if r.metadata->>'resumed_as_event' is not null then return (r.metadata->>'resumed_as_event')::uuid;end if;
 select * into e from public.analytics_events where event_id=r.event_id and workspace_id=r.workspace_id;
 if not found or e.flow_event_type is null then raise exception 'Original workflow event is unavailable; reconcile before replay';end if;
 if not exists(select 1 from public.flow_workflow_definitions d where d.id=r.workflow_id and d.workspace_id=r.workspace_id and d.enabled) then raise exception 'Enable the original workflow before replay';end if;
 insert into public.analytics_events(event_name,source,role,workspace_id,project_id,entity_type,entity_id,properties,flow_event_type,source_module,correlation_id,parent_event_id)
 values('workflow.resume','edge_function','system',r.workspace_id,'qep',e.entity_type,e.entity_id,
  coalesce(e.properties,'{}')||jsonb_build_object('resumed_from_run',r.id,'resumed_workflow_slug',r.workflow_slug,'effect_event_id',coalesce(r.metadata->>'effect_event_id',r.event_id::text)),
  e.flow_event_type,'system',coalesce(e.correlation_id,gen_random_uuid()),e.event_id) returning event_id into new_event;
 update public.flow_workflow_runs set status='cancelled',finished_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('resumed_as_event',new_event) where id=r.id;
 perform pg_notify('flow_event',new_event::text);return new_event;
end;$$;
revoke all on function public.flow_resume_run(uuid) from public,anon,authenticated;
grant execute on function public.flow_resume_run(uuid) to service_role;

create or replace function public.replay_workflow_dead_letter(p_exception_id uuid,p_run_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare ex public.exception_queue; run public.flow_workflow_runs; event_id uuid;
begin
 if auth.uid() is null or public.get_my_role()::text not in ('admin','owner') then raise exception 'Replay requires an administrator' using errcode='42501';end if;
 select * into ex from public.exception_queue where id=p_exception_id and workspace_id=public.get_my_workspace() and source='workflow_dead_letter' for update;
 if not found then raise exception 'Dead letter not found in workspace' using errcode='42501';end if;
 select * into run from public.flow_workflow_runs where id=p_run_id and workspace_id=ex.workspace_id for update;
 if not found or (coalesce(ex.payload->>'run_id',ex.payload->>'workflow_run_id') is distinct from p_run_id::text and run.dead_letter_id is distinct from ex.id) then raise exception 'Dead letter does not belong to run';end if;
 if run.metadata->>'resumed_as_event' is not null then return (run.metadata->>'resumed_as_event')::uuid;end if;
 if ex.status='resolved' then raise exception 'Dead letter already resolved without a replay';end if;
 event_id:=public.flow_resume_run(p_run_id);
 update public.exception_queue set status='resolved',resolved_at=now(),resolution_reason='Workflow replay queued' where id=ex.id;
 return event_id;
end;$$;
revoke all on function public.replay_workflow_dead_letter(uuid,uuid) from public,anon;
grant execute on function public.replay_workflow_dead_letter(uuid,uuid) to authenticated;
-- DATA-003/011: every queued action has a durable, actor-bound receipt in the
-- same transaction as its business effect. Response loss cannot duplicate work.
create table public.sales_offline_action_receipts(
 workspace_id text not null,user_id uuid not null references public.profiles(id),action_id uuid not null,
 action_type text not null,payload jsonb not null,queued_at timestamptz not null,
 result jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(workspace_id,user_id,action_id)
);
alter table public.sales_offline_action_receipts enable row level security;
create policy sales_offline_receipts_own on public.sales_offline_action_receipts for select to authenticated
 using(user_id=(select auth.uid()) and workspace_id=(select public.get_my_workspace()));
grant select on public.sales_offline_action_receipts to authenticated;
create or replace function public.apply_sales_offline_action(p_workspace_id text,p_user_id uuid,p_action_id uuid,p_action_type text,p_payload jsonb,p_queued_at timestamptz)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare receipt public.sales_offline_action_receipts; deal public.crm_deals; company uuid; deal_id uuid; text_body text; activity text; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_user_id is null or p_action_id is null or nullif(p_workspace_id,'') is null or p_queued_at is null or p_queued_at>now() or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid offline action';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id||':'||p_user_id::text||':'||p_action_id::text,0));
 select * into receipt from public.sales_offline_action_receipts where workspace_id=p_workspace_id and user_id=p_user_id and action_id=p_action_id;
 if found then
  if receipt.action_type is distinct from p_action_type or receipt.payload is distinct from p_payload or receipt.queued_at is distinct from p_queued_at then raise exception 'Offline action ID conflicts with previously saved content' using errcode='40001';end if;
  return receipt.result;
 end if;
 company:=nullif(p_payload->>'company_id','')::uuid;deal_id:=nullif(p_payload->>'deal_id','')::uuid;
 if company is not null or deal_id is not null then
  select * into deal from public.crm_deals d where d.workspace_id=p_workspace_id and d.assigned_rep_id=p_user_id and d.deleted_at is null
    and (deal_id is null or d.id=deal_id) and (company is null or d.company_id=company) order by d.id limit 1 for update;
  if not found then raise exception 'Deal or company not found or not assigned to operator' using errcode='42501';end if;
  deal_id:=deal.id;company:=deal.company_id;
 end if;
 if p_action_type='log_visit' then
  if company is null or nullif(p_payload->>'outcome','') is null then raise exception 'company_id and outcome required';end if;
  activity:='meeting';text_body:=concat_ws(E'\n','Visit outcome: '||(p_payload->>'outcome'),case when nullif(p_payload->>'notes','') is not null then 'Notes: '||(p_payload->>'notes') end,case when nullif(p_payload->>'next_action','') is not null then 'Next action: '||(p_payload->>'next_action') end);
 elsif p_action_type='create_note' then
  activity:='note';text_body:=nullif(p_payload->>'text','');if text_body is null then raise exception 'text required';end if;
 elsif p_action_type='advance_stage' then
  if deal.id is null or not exists(select 1 from public.crm_deal_stages where id=nullif(p_payload->>'new_stage_id','')::uuid and workspace_id=p_workspace_id) then raise exception 'Valid owned deal and workspace stage required';end if;
  if p_payload ? 'expected_stage_id' and deal.stage_id is distinct from nullif(p_payload->>'expected_stage_id','')::uuid then raise exception 'Stage changed while offline' using errcode='40001';end if;
  update public.crm_deals set stage_id=(p_payload->>'new_stage_id')::uuid,updated_at=now() where id=deal.id;
 elsif p_action_type='schedule_followup' then
  if deal.id is null or nullif(p_payload->>'follow_up_date','') is null then raise exception 'Owned deal and follow-up date required';end if;
  update public.crm_deals set next_follow_up_at=(p_payload->>'follow_up_date')::timestamptz,updated_at=now() where id=deal.id;
  if nullif(p_payload->>'note','') is not null then activity:='note';text_body:='Follow-up scheduled for '||(p_payload->>'follow_up_date')||': '||(p_payload->>'note');end if;
 else raise exception 'Unknown offline action type';end if;
 if activity is not null then
  insert into public.crm_activities(id,workspace_id,activity_type,body,occurred_at,company_id,deal_id,created_by,metadata)
  values(p_action_id,p_workspace_id,activity,text_body,p_queued_at,company,deal_id,p_user_id,jsonb_build_object('source','sales_companion_offline','offline_action_id',p_action_id,'outcome',p_payload->>'outcome','next_action',p_payload->>'next_action'));
 end if;
 result:=jsonb_build_object('id',p_action_id,'status','synced');
 insert into public.sales_offline_action_receipts(workspace_id,user_id,action_id,action_type,payload,queued_at,result)
 values(p_workspace_id,p_user_id,p_action_id,p_action_type,p_payload,p_queued_at,result);
 update public.offline_sync_queue set sync_status='synced',synced_at=now(),error_message=null where id=p_action_id and user_id=p_user_id;
 return result;
end;$$;
revoke all on function public.apply_sales_offline_action(text,uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_sales_offline_action(text,uuid,uuid,text,jsonb,timestamptz) to service_role;

commit;
