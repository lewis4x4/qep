-- Service review remediation: transactional intake, field evidence, invoices and approved haul costs.
-- Rollback: stop new callers, revoke the new RPCs; retain operation/timecard evidence.
begin;
-- Enforce workspace-parent consistency for new writes without guessing how to repair legacy rows.
create unique index if not exists service_jobs_workspace_identity_841 on public.service_jobs(workspace_id,id);
create unique index if not exists service_quotes_workspace_identity_841 on public.service_quotes(workspace_id,id);
alter table public.service_quotes add constraint service_quotes_job_workspace_841 foreign key(workspace_id,job_id) references public.service_jobs(workspace_id,id) not valid;
alter table public.service_quote_lines add constraint service_quote_lines_quote_workspace_841 foreign key(workspace_id,quote_id) references public.service_quotes(workspace_id,id) not valid;
alter table public.customer_invoices add constraint service_invoice_job_workspace_841 foreign key(workspace_id,service_job_id) references public.service_jobs(workspace_id,id) not valid;

create table public.service_operation_receipts (
  workspace_id text not null,
  actor_id uuid not null references public.profiles(id),
  operation_id uuid not null,
  operation_kind text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, actor_id, operation_id)
);
alter table public.service_operation_receipts enable row level security;
create policy service_operation_receipts_read on public.service_operation_receipts for select to authenticated
  using (workspace_id = (select public.get_my_workspace()) and actor_id = (select auth.uid()));
revoke all on public.service_operation_receipts from anon, authenticated;
grant select on public.service_operation_receipts to authenticated;
grant all on public.service_operation_receipts to service_role;

create or replace function public.service_create_intake(p_operation_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_ws text := public.get_my_workspace();
  v_job public.service_jobs; v_machine public.qrm_equipment; v_result jsonb; v_receipt public.service_operation_receipts;
  v_new jsonb := p_payload->'new_machine'; v_id uuid; v_customer uuid := nullif(p_payload->>'customer_id','')::uuid;
  v_key text;
begin
  if v_actor is null or public.get_my_role()::text not in ('rep','admin','manager','owner','service_writer','dispatch') then
    raise exception 'Service intake requires an authorized operator' using errcode='42501';
  end if;
  if p_operation_id is null then raise exception 'operation_id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_ws || v_actor::text || p_operation_id::text, 0));
  select * into v_receipt from public.service_operation_receipts where workspace_id=v_ws and actor_id=v_actor and operation_id=p_operation_id;
  if found then
    if v_receipt.operation_kind <> 'intake' or v_receipt.payload <> p_payload then raise exception 'Operation conflict: use a new operation for changed intake' using errcode='40001'; end if;
    return v_receipt.result;
  end if;
  if v_customer is not null and not exists(select 1 from public.qrm_companies where id=v_customer and workspace_id=v_ws and deleted_at is null) then
    raise exception 'Customer not found in this workspace' using errcode='42501';
  end if;
  v_id := nullif(p_payload->>'machine_id','')::uuid;
  if v_id is null then
    if v_customer is null then raise exception 'Link a customer before registering a first-seen machine'; end if;
    foreach v_key in array array['make','model','serial_number','year'] loop
      if nullif(btrim(v_new->>v_key),'') is null then raise exception 'New machine % required', v_key; end if;
    end loop;
    if (v_new->>'year')::int not between 1900 and 2100 then raise exception 'Invalid machine year'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_ws || ':machine:' || lower(btrim(v_new->>'serial_number')),0));
    if exists(select 1 from public.qrm_equipment where workspace_id=v_ws and lower(serial_number)=lower(btrim(v_new->>'serial_number')) and deleted_at is null) then
      raise exception 'Machine serial already exists; select the existing machine' using errcode='23505';
    end if;
    insert into public.qrm_equipment(workspace_id,name,make,model,serial_number,year,company_id)
    values(v_ws, btrim(v_new->>'make') || ' ' || btrim(v_new->>'model'),btrim(v_new->>'make'),btrim(v_new->>'model'),btrim(v_new->>'serial_number'),(v_new->>'year')::int,v_customer)
    returning * into v_machine;
  else
    select * into v_machine from public.qrm_equipment where id=v_id and workspace_id=v_ws and deleted_at is null for share;
    if not found then raise exception 'Machine not found in this workspace' using errcode='42501'; end if;
  end if;
  foreach v_key in array array['complaint','cause','correction','promised_at','hour_meter_reading'] loop
    if nullif(btrim(p_payload->>v_key),'') is null then raise exception 'Intake % required',v_key; end if;
  end loop;
  if (p_payload->>'hour_meter_reading')::numeric < 0 then raise exception 'Invalid hour meter'; end if;
  if nullif(v_machine.make,'') is null or nullif(v_machine.model,'') is null or nullif(v_machine.serial_number,'') is null or v_machine.year is null then raise exception 'Machine identity incomplete'; end if;
  if lower(coalesce(v_machine.name,'') || ' ' || coalesce(v_machine.category::text,'') || ' ' || coalesce(v_machine.metadata::text,'')) like '%grapple%' and nullif(p_payload->>'odometer_miles','') is null then raise exception 'Grapple truck miles required'; end if;
  if p_payload->>'shop_or_field'='field' then
    foreach v_key in array array['field_site_location','field_site_contact_name','field_site_contact_phone','field_site_conditions_access_notes'] loop
      if nullif(btrim(p_payload->>v_key),'') is null then raise exception 'Field % required',v_key; end if;
    end loop;
  end if;
  if nullif(p_payload->>'selected_job_code_id','') is not null and not exists(select 1 from public.job_codes where id=(p_payload->>'selected_job_code_id')::uuid and workspace_id=v_ws) then raise exception 'Job code not found in workspace' using errcode='42501'; end if;
  if nullif(p_payload->>'contact_id','') is not null and not exists(select 1 from public.qrm_contacts where id=(p_payload->>'contact_id')::uuid and workspace_id=v_ws and deleted_at is null) then raise exception 'Contact not found in workspace' using errcode='42501'; end if;
  foreach v_key in array array['advisor_id','service_manager_id'] loop
    if nullif(p_payload->>v_key,'') is not null and not exists(select 1 from public.profile_workspaces where profile_id=(p_payload->>v_key)::uuid and workspace_id=v_ws) then raise exception 'Assignee not found in workspace' using errcode='42501'; end if;
  end loop;
  if nullif(p_payload->>'portal_request_id','') is not null and not exists(select 1 from public.service_requests where id=(p_payload->>'portal_request_id')::uuid and workspace_id=v_ws) then raise exception 'Portal request not found in workspace' using errcode='42501'; end if;
  insert into public.service_jobs(id,workspace_id,customer_id,machine_id,source_type,request_type,priority,current_stage,advisor_id,
    customer_problem_summary,haul_required,shop_or_field,hour_meter_reading,odometer_miles,machine_make,machine_model,machine_serial_number,machine_year,
    complaint,cause,correction,promised_at,field_site_location,field_site_contact_name,field_site_contact_phone,field_site_conditions_access_notes,
    selected_job_code_id,status_flags,estimate_authorization_required,estimate_authorization_status,estimate_reauth_threshold_pct)
  values(p_operation_id,v_ws,v_customer,v_machine.id,(p_payload->>'source_type')::public.service_source_type,(p_payload->>'request_type')::public.service_request_type,(p_payload->>'priority')::public.service_priority,'request_received',v_actor,
    p_payload->>'complaint',coalesce((p_payload->>'haul_required')::boolean,false),p_payload->>'shop_or_field',(p_payload->>'hour_meter_reading')::numeric,
    nullif(p_payload->>'odometer_miles','')::numeric,v_machine.make,v_machine.model,v_machine.serial_number,v_machine.year,
    p_payload->>'complaint',p_payload->>'cause',p_payload->>'correction',(p_payload->>'promised_at')::timestamptz,
    p_payload->>'field_site_location',p_payload->>'field_site_contact_name',p_payload->>'field_site_contact_phone',p_payload->>'field_site_conditions_access_notes',
    nullif(p_payload->>'selected_job_code_id','')::uuid,coalesce(array(select jsonb_array_elements_text(p_payload->'status_flags')),'{}')::public.service_status_flag[],true,'pending',10)
  returning * into v_job;
  update public.service_jobs set
    contact_id=nullif(p_payload->>'contact_id','')::uuid,
    branch_id=nullif(p_payload->>'branch_id',''),
    advisor_id=coalesce(nullif(p_payload->>'advisor_id','')::uuid,v_actor),
    service_manager_id=nullif(p_payload->>'service_manager_id','')::uuid,
    requested_by_name=nullif(p_payload->>'requested_by_name',''),
    scheduled_start_at=nullif(p_payload->>'scheduled_start_at','')::timestamptz,
    scheduled_end_at=nullif(p_payload->>'scheduled_end_at','')::timestamptz,
    portal_request_id=nullif(p_payload->>'portal_request_id','')::uuid,
    ai_diagnosis_summary=nullif(p_payload->>'ai_diagnosis_summary','')
  where id=v_job.id returning * into v_job;
  insert into public.service_job_events(workspace_id,job_id,event_type,actor_id,new_stage,metadata)
  values(v_ws,v_job.id,'created',v_actor,'request_received',jsonb_build_object('first_seen_machine',v_id is null));
  insert into public.service_job_segments(workspace_id,service_job_id,segment_number,description,status)
  values(v_ws,v_job.id,1,v_job.complaint,'open');
  v_result := jsonb_build_object('job',to_jsonb(v_job));
  insert into public.service_operation_receipts values(v_ws,v_actor,p_operation_id,'intake',p_payload,v_result,now());
  return v_result;
end $$;
revoke all on function public.service_create_intake(uuid,jsonb) from public,anon;
grant execute on function public.service_create_intake(uuid,jsonb) to authenticated;

create or replace function public.service_record_field_packet(p_operation_id uuid,p_job_id uuid,p_packet jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_ws text := public.get_my_workspace(); v_role text := public.get_my_role()::text;
  v_job public.service_jobs; v_receipt public.service_operation_receipts; v_payload jsonb := jsonb_build_object('job_id',p_job_id,'packet',p_packet);
  v_fields jsonb := coalesce(p_packet->'fields','{}'); v_base jsonb := p_packet->'base'; v_key text; v_result jsonb;
  v_card public.service_timecards; v_session uuid; v_at timestamptz; v_segment uuid; v_kind text := p_packet->>'kind';
begin
  if v_actor is null or v_role not in ('rep','admin','manager','owner','service_writer','dispatch','technician') then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'operation_id required'; end if;
  if p_packet ? 'captured_by' and nullif(p_packet->>'captured_by','')::uuid is distinct from v_actor then raise exception 'Field packet belongs to a different operator' using errcode='42501';end if;
  if p_packet ? 'captured_workspace_id' and p_packet->>'captured_workspace_id' is distinct from v_ws then raise exception 'Field packet belongs to a different workspace' using errcode='42501';end if;

  perform pg_advisory_xact_lock(hashtextextended(v_ws || ':field:' || v_actor::text,0));
  select * into v_job from public.service_jobs where id=p_job_id and workspace_id=v_ws and deleted_at is null for update;
  if not found then raise exception 'Job not found' using errcode='42501'; end if;
  if v_role='technician' and v_job.technician_id is distinct from v_actor and not exists(select 1 from public.service_job_segments where service_job_id=p_job_id and technician_id=v_actor and deleted_at is null) then raise exception 'Job is not assigned to this technician' using errcode='42501'; end if;
  select * into v_receipt from public.service_operation_receipts where workspace_id=v_ws and actor_id=v_actor and operation_id=p_operation_id;
  if found then
    if v_receipt.operation_kind <> 'field' or v_receipt.payload <> v_payload then raise exception 'Operation payload conflict' using errcode='40001'; end if;
    return v_receipt.result;
  end if;
  if v_job.closed_at is not null then raise exception 'Closed job cannot accept field work'; end if;
  if v_kind='job_update' then
    for v_key in select jsonb_object_keys(v_fields) loop
      if v_key not in ('hour_meter_reading','complaint','cause','correction') then raise exception 'Protected field %',v_key using errcode='42501'; end if;
      if v_key in ('complaint','cause','correction') and nullif(btrim(v_fields->>v_key),'') is null then raise exception 'Field % cannot be cleared',v_key;end if;
      if v_base ? v_key and (to_jsonb(v_job)->v_key) is distinct from (v_base->v_key) and (to_jsonb(v_job)->v_key) is distinct from (v_fields->v_key) then
        raise exception 'Conflict: % changed since capture; review current work order before retry',v_key using errcode='40001';
      end if;
    end loop;
    if v_fields ? 'hour_meter_reading' and ((v_fields->>'hour_meter_reading') is null or (v_fields->>'hour_meter_reading')::numeric < 0) then raise exception 'A non-negative hour reading is required'; end if;
    update public.service_jobs set
      hour_meter_reading=case when v_fields ? 'hour_meter_reading' then (v_fields->>'hour_meter_reading')::numeric else hour_meter_reading end,
      complaint=case when v_fields ? 'complaint' then v_fields->>'complaint' else complaint end,
      cause=case when v_fields ? 'cause' then v_fields->>'cause' else cause end,
      correction=case when v_fields ? 'correction' then v_fields->>'correction' else correction end
    where id=p_job_id returning * into v_job;
  elsif v_kind='segment_photo' then
    v_segment:=(p_packet->>'segment_id')::uuid;
    if not exists(select 1 from public.service_job_segments where id=v_segment and service_job_id=p_job_id and deleted_at is null) then raise exception 'Photo segment does not belong to job';end if;
    if p_packet->>'phase' not in ('before','during','after') or p_packet->>'storage_path' not like (v_ws || '/service-jobs/' || p_job_id || '/segments/' || v_segment || '/%') then raise exception 'Invalid photo evidence path or phase';end if;
    if not exists(select 1 from storage.objects where bucket_id='portal-service-photos' and name=p_packet->>'storage_path') then raise exception 'Photo upload not found; retry upload';end if;
    insert into public.service_job_segment_photos(workspace_id,service_job_id,service_job_segment_id,phase,category,storage_bucket,storage_path,caption,content_type,uploaded_by)
    values(v_ws,p_job_id,v_segment,p_packet->>'phase',p_packet->>'category','portal-service-photos',p_packet->>'storage_path',p_packet->>'caption',p_packet->>'content_type',v_actor);
  elsif v_kind in ('clock_start','clock_stop') then
    v_session := (p_packet->>'session_id')::uuid; v_at := (p_packet->>'occurred_at')::timestamptz;
    v_segment := nullif(p_packet->>'segment_id','')::uuid;
    if v_session is null or v_at is null or v_at>now()+interval '5 minutes' then raise exception 'Invalid clock event'; end if;
    if v_segment is not null and not exists(select 1 from public.service_job_segments where id=v_segment and service_job_id=p_job_id and deleted_at is null) then raise exception 'Segment does not belong to job'; end if;
    select * into v_card from public.service_timecards where id=v_session for update;
    if v_kind='clock_start' then
      if found then
        if v_card.technician_id<>v_actor or v_card.service_job_id<>p_job_id or v_card.clocked_in_at<>v_at then raise exception 'Clock session conflict' using errcode='40001'; end if;
      else
        if exists(select 1 from public.service_timecards where technician_id=v_actor and clocked_out_at is null) then raise exception 'Stop the active clock before starting another job'; end if;
        insert into public.service_timecards(id,workspace_id,service_job_id,technician_id,segment_id,clocked_in_at)
        values(v_session,v_ws,p_job_id,v_actor,v_segment,v_at) returning * into v_card;
      end if;
    else
      if not found or v_card.technician_id<>v_actor or v_card.service_job_id<>p_job_id then raise exception 'Clock start has not synchronized yet'; end if;
      if v_at<v_card.clocked_in_at then raise exception 'Clock stop precedes start'; end if;
      if exists(select 1 from public.service_timecards t where t.technician_id=v_actor and t.id<>v_session and tstzrange(t.clocked_in_at,t.clocked_out_at,'[)') && tstzrange(v_card.clocked_in_at,v_at,'[)')) then raise exception 'Clock interval conflicts with another job; supervisor review required' using errcode='40001'; end if;
      if v_card.clocked_out_at is not null and v_card.clocked_out_at<>v_at then raise exception 'Clock already stopped with another time' using errcode='40001'; end if;
      update public.service_timecards set clocked_out_at=v_at where id=v_session returning * into v_card;
      insert into public.service_labor_ledger(workspace_id,service_job_id,service_job_segment_id,service_timecard_id,employee_id,technician_id,labor_date,started_at,ended_at,actual_hours,source_system,source_key,notes)
      select v_ws,p_job_id,v_card.segment_id,v_card.id,
        (select id from public.employees where workspace_id=v_ws and profile_id=v_actor and deleted_at is null limit 1),
        v_actor,(v_card.clocked_in_at at time zone 'America/New_York')::date,v_card.clocked_in_at,v_card.clocked_out_at,v_card.hours,'qep_timeclock',v_card.id::text,'Clock evidence; billable hours and payroll approval remain separate.'
      where not exists(select 1 from public.service_labor_ledger where service_timecard_id=v_card.id and source_system='qep_timeclock' and deleted_at is null);

      if v_card.segment_id is not null then
        update public.service_job_segments set hours_actual=(select coalesce(sum(hours),0) from public.service_timecards where segment_id=v_card.segment_id) where id=v_card.segment_id;
      end if;
    end if;
  else raise exception 'Unknown field packet kind'; end if;
  insert into public.service_job_events(workspace_id,job_id,event_type,actor_id,metadata)
  values(v_ws,p_job_id,'field_packet',v_actor,jsonb_build_object('kind',v_kind,'operation_id',p_operation_id,'clock_session',to_jsonb(v_card)));
  v_result:=jsonb_build_object('job',to_jsonb(v_job),'timecard',to_jsonb(v_card));
  insert into public.service_operation_receipts values(v_ws,v_actor,p_operation_id,'field',v_payload,v_result,now());
  return v_result;
end $$;
revoke all on function public.service_record_field_packet(uuid,uuid,jsonb) from public,anon;
grant execute on function public.service_record_field_packet(uuid,uuid,jsonb) to authenticated;

-- Time evidence changes only through the constrained clock command or trusted import/admin SQL.
create or replace function public.guard_service_clock_evidence()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_command_owner name;
begin
 select r.rolname into v_command_owner from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
 where p.oid='public.service_record_field_packet(uuid,uuid,jsonb)'::regprocedure;
 if current_user not in (v_command_owner, 'service_role') then
   if tg_op in ('INSERT','DELETE') then raise exception 'Use the service clock command; time evidence cannot be inserted or deleted directly' using errcode='42501';end if;
   if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.technician_id is distinct from old.technician_id or new.service_job_id is distinct from old.service_job_id or new.segment_id is distinct from old.segment_id or new.clocked_in_at is distinct from old.clocked_in_at or new.clocked_out_at is distinct from old.clocked_out_at then
     raise exception 'Clock evidence is immutable outside the service clock command; request a documented supervisor correction' using errcode='42501';
   end if;
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function public.guard_service_clock_evidence() from public,anon,authenticated;
create trigger guard_service_clock_evidence before insert or update or delete on public.service_timecards
 for each row execute function public.guard_service_clock_evidence();

-- Approved internal transport schedule; retail stays provisional pending owner reconciliation.
alter table public.service_haul_rate_sheets add column if not exists maximum_load_lbs integer;
update public.service_haul_rate_sheets set active=false where truck_class='standard' and per_mile_rate_cents=0 and per_haul_minimum_cents=50000;
insert into public.service_haul_rate_sheets(workspace_id,rate_type,truck_class,mileage_band_min,mileage_band_max,base_rate_cents,per_mile_rate_cents,round_trip_minimum_miles,per_haul_minimum_cents,maximum_load_lbs,notes)
select w.id,'internal',r.truck_class,b.min_miles,b.max_miles,0,
 case b.band when 1 then r.rate1 when 2 then r.rate2 else r.rate3 end,0,r.minimum,r.capacity,
 'President Service Discovery v1.1 confirmed internal sheet; round-trip miles. Retail remains provisional.'
from (select distinct workspace_id as id from public.profile_workspaces union select 'default') w cross join (values
 ('flatbed_tilt_deck',7500,12000,300,250,200),('flatbed_gooseneck',7500,19000,300,250,200),
 ('peterbilt_landoll',15000,36000,375,350,325),('peterbilt_fontaine',20000,115000,375,350,325),('peterbilt_oversize',25000,135000,450,400,350)
) r(truck_class,minimum,capacity,rate1,rate2,rate3)
cross join (values (1,0::numeric,50::numeric),(2,50.01::numeric,100::numeric),(3,100.01::numeric,null::numeric)) b(band,min_miles,max_miles)
where not exists(select 1 from public.service_haul_rate_sheets s where s.workspace_id=w.id and s.rate_type='internal' and s.truck_class=r.truck_class and s.mileage_band_min=b.min_miles);

create or replace function public.service_calculate_haul_charge(p_workspace_id text,p_truck_class text,p_mileage_one_way numeric,p_rate_type text default 'customer')
returns table(rate_sheet_id uuid,truck_class text,rate_type text,one_way_miles numeric,round_trip_miles numeric,billable_miles numeric,base_rate_cents bigint,per_mile_rate_cents bigint,per_haul_minimum_cents bigint,total_cents bigint,rate_source text,calculation jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare v_rate public.service_haul_rate_sheets; v_miles numeric := round(p_mileage_one_way*2,2);
begin
 if p_workspace_id is distinct from public.get_my_workspace() and (select auth.role())<>'service_role' then raise exception 'Workspace mismatch' using errcode='42501'; end if;
 if p_mileage_one_way is null or p_mileage_one_way<0 then raise exception 'Valid one-way mileage required'; end if;
 select * into v_rate from public.service_haul_rate_sheets s where s.workspace_id=p_workspace_id and s.rate_type=p_rate_type and lower(s.truck_class)=lower(p_truck_class)
 and s.active and s.effective_date<=current_date and (s.expiration_date is null or s.expiration_date>=current_date)
 and s.mileage_band_min<=v_miles and (s.mileage_band_max is null or s.mileage_band_max>=v_miles)
 order by s.mileage_band_min desc,s.effective_date desc,s.created_at desc limit 1;
 if not found then raise exception 'No approved haul rate for this truck and mileage. Confirm pricing; no charge has been invented.' using errcode='P0001'; end if;
 return query select v_rate.id,v_rate.truck_class,v_rate.rate_type,p_mileage_one_way,v_miles,greatest(v_miles,v_rate.round_trip_minimum_miles),v_rate.base_rate_cents,v_rate.per_mile_rate_cents,v_rate.per_haul_minimum_cents,
 greatest(v_rate.per_haul_minimum_cents,round(v_rate.base_rate_cents+greatest(v_miles,v_rate.round_trip_minimum_miles)*v_rate.per_mile_rate_cents)::bigint),'configured_rate_sheet'::text,
 jsonb_build_object('round_trip_miles',v_miles,'maximum_load_lbs',v_rate.maximum_load_lbs,'source','approved_rate_sheet');
end $$;

-- The job lock serializes invoice identity; header + all classified lines + sync intent commit together.
create or replace function public.service_generate_invoice_atomic(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_job public.service_jobs; v_invoice public.customer_invoices; v_quote public.service_quotes;
 v_ws text := public.get_my_workspace(); v_pc uuid; v_total numeric := 0; v_line_count int; v_existing_count int; v_lines jsonb; v_expected_lines jsonb; v_stored_lines jsonb;
begin
 if auth.uid() is null or public.get_my_role()::text not in ('rep','admin','manager','owner','service_writer','finance_admin') then raise exception 'Invoice generation forbidden' using errcode='42501'; end if;
 select * into v_job from public.service_jobs where id=p_job_id and workspace_id=v_ws and deleted_at is null for update;
 if not found then raise exception 'Job not found' using errcode='42501'; end if;
 if v_job.customer_id is not null and not exists(select 1 from public.qrm_companies where id=v_job.customer_id and workspace_id=v_ws and deleted_at is null) then raise exception 'Job customer belongs to another workspace' using errcode='42501';end if;
 if v_job.comeback_no_rebill or v_job.service_internal_work_class='rental_fleet_maintenance' or (v_job.request_type::text='internal' and not coalesce(v_job.renter_fault_billable,false)) then
  return jsonb_build_object('invoice_id',null,'not_applicable',true);
 end if;
 select * into v_quote from public.service_quotes where workspace_id=v_ws and job_id=p_job_id and status='approved' order by version desc limit 1 for share;
 if found then
  select coalesce(jsonb_agg(to_jsonb(l) order by sort_order,id),'[]') into v_lines from public.service_quote_lines l
  where workspace_id=v_ws and quote_id=v_quote.id and coalesce(payer_type,'customer')='customer';
  select count(*),coalesce(sum((l->>'extended_price')::numeric),0) into v_line_count,v_total from jsonb_array_elements(v_lines) l;
  if v_line_count=0 then return jsonb_build_object('invoice_id',null,'not_applicable',true); end if;
 else
  raise exception 'Approved written estimate required before invoice generation';
 end if;
 if v_total<=0 then raise exception 'Customer invoice requires a positive total'; end if;
 select jsonb_agg(jsonb_build_object('line_number',line_number,'description',description,'quantity',quantity,'unit_price',unit_price,'finance_department',finance_department,'finance_segment','customer','finance_category',finance_category) order by line_number)
 into v_expected_lines from (
   select row_number() over(order by sort_order,id) as line_number,description,quantity,
     round(case when quantity>0 then extended_price/quantity else unit_price end,2) as unit_price,
     case when line_type='part' then 'parts' else 'service' end as finance_department,
     case when line_type='optional' then 'misc' else line_type end as finance_category
   from jsonb_to_recordset(v_lines) as line(id uuid,description text,quantity numeric,unit_price numeric,extended_price numeric,line_type text,sort_order integer)
 ) canonical;
 select * into v_invoice from public.customer_invoices where workspace_id=v_ws and service_job_id=p_job_id order by created_at limit 1 for update;
 if found then
  if v_invoice.crm_company_id is not null and v_invoice.crm_company_id is distinct from v_job.customer_id then raise exception 'Existing invoice customer differs from job customer' using errcode='42501';end if;
  if v_invoice.portal_customer_id is not null and not exists(select 1 from public.portal_customers where id=v_invoice.portal_customer_id and workspace_id=v_ws and crm_company_id=v_job.customer_id) then raise exception 'Existing invoice portal customer differs from job customer' using errcode='42501';end if;
  select count(*), jsonb_agg(jsonb_build_object('line_number',line_number,'description',description,'quantity',quantity,'unit_price',unit_price,'finance_department',finance_department,'finance_segment',finance_segment,'finance_category',finance_category) order by line_number)
  into v_existing_count,v_stored_lines from public.customer_invoice_line_items where workspace_id=v_ws and invoice_id=v_invoice.id;
  if v_stored_lines=v_expected_lines and v_invoice.total=v_total then return jsonb_build_object('invoice_id',v_invoice.id);end if;
  if v_invoice.status not in ('pending','draft') or coalesce(v_invoice.amount_paid,0)>0 or v_invoice.native_signature_id is not null or coalesce(v_invoice.tax,0)<>0 then
   raise exception 'Finalized or signed service invoice differs from approved line content/classification; finance reconciliation required' using errcode='40001';
  end if;
  delete from public.customer_invoice_line_items where workspace_id=v_ws and invoice_id=v_invoice.id;
  update public.customer_invoices set amount=v_total,total=v_total where workspace_id=v_ws and id=v_invoice.id;
 else
  select id into v_pc from public.portal_customers where crm_company_id=v_job.customer_id and workspace_id=v_ws limit 1;
  insert into public.customer_invoices(workspace_id,portal_customer_id,crm_company_id,invoice_number,invoice_date,due_date,description,amount,tax,total,status,invoice_type,service_job_id)
  values(v_ws,v_pc,v_job.customer_id,'SRV-' || upper(p_job_id::text),current_date,current_date+30,'Service job ' || p_job_id,v_total,0,v_total,'pending','service',p_job_id)
  returning * into v_invoice;
 end if;
 insert into public.customer_invoice_line_items(workspace_id,invoice_id,line_number,description,quantity,unit_price,finance_department,finance_segment,finance_category,finance_classification_source,finance_classified_at)
 select v_ws,v_invoice.id,row_number() over(order by sort_order,id),description,quantity,
 round(case when quantity>0 then extended_price/quantity else unit_price end,2),
 case when line_type='part' then 'parts' else 'service' end,'customer',case when line_type='optional' then 'misc' else line_type end,'service_quote_line_type',now()
 from jsonb_to_recordset(v_lines) as line(id uuid,description text,quantity numeric,unit_price numeric,extended_price numeric,line_type text,sort_order integer);
 insert into public.quickbooks_gl_sync_jobs(workspace_id,invoice_id,source_type,posting_mode,status)
 values(v_ws,v_invoice.id,'customer_invoice','journal_entry','queued') on conflict(invoice_id) do nothing;
 update public.customer_invoices set quickbooks_gl_status='queued',quickbooks_gl_last_error=null where workspace_id=v_ws and id=v_invoice.id;
 return jsonb_build_object('invoice_id',v_invoice.id);
end $$;
revoke all on function public.service_generate_invoice_atomic(uuid) from public,anon;
grant execute on function public.service_generate_invoice_atomic(uuid) to authenticated;

-- Agreement activation and enrollment are one operation; a failed enrollment stays draft.
create or replace function public.service_enroll_agreement(p_agreement_id uuid,p_program_id uuid,p_enrolled_on date,p_baseline_hours numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ws text:=public.get_my_workspace(); v_actor uuid:=auth.uid(); v_program public.service_agreement_programs; v_result jsonb;
begin
 if v_actor is null or public.get_my_role()::text not in ('admin','manager','owner') then raise exception 'Enrollment requires a manager' using errcode='42501'; end if;
 select * into v_program from public.service_agreement_programs where id=p_program_id and workspace_id=v_ws and is_active and not is_provisional and review_status='reviewed' and deleted_at is null for share;
 if not found then raise exception 'Choose a reviewed active program'; end if;
 perform 1 from public.service_agreements where id=p_agreement_id and workspace_id=v_ws and deleted_at is null for update;
 if not found then raise exception 'Agreement not found' using errcode='42501'; end if;
 update public.service_agreements set program_id=p_program_id,program_name=v_program.name,status='active' where id=p_agreement_id;
 select to_jsonb(e) into v_result from public.service_plan_enroll_equipment(v_ws,p_agreement_id,p_enrolled_on,p_baseline_hours,v_actor) e;
 return v_result;
end $$;
revoke all on function public.service_enroll_agreement(uuid,uuid,date,numeric) from public,anon;
grant execute on function public.service_enroll_agreement(uuid,uuid,date,numeric) to authenticated;

-- An assigned technician may read the machine's prior repair story without broadening job-list RLS.
create or replace function public.service_machine_history(p_job_id uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_job public.service_jobs; v_actor uuid:=auth.uid(); v_ws text:=public.get_my_workspace();v_role text:=public.get_my_role()::text;v_rows jsonb;
begin
 if v_actor is null or v_role not in ('rep','admin','manager','owner','service_writer','dispatch','technician','parts_counter','finance_admin') then raise exception 'Forbidden' using errcode='42501';end if;
 select * into v_job from public.service_jobs where id=p_job_id and workspace_id=v_ws and deleted_at is null;
 if not found then raise exception 'Job not found' using errcode='42501';end if;
 if v_role='technician' and v_job.technician_id is distinct from v_actor and not exists(select 1 from public.service_job_segments where service_job_id=p_job_id and technician_id=v_actor and deleted_at is null) then raise exception 'Job is not assigned to this technician' using errcode='42501';end if;
 if p_offset<0 then raise exception 'Invalid history offset';end if;
 select coalesce(jsonb_agg(to_jsonb(history)),'[]') into v_rows from (
  select id,workspace_id,machine_id,current_stage,created_at,complaint,cause,correction,hour_meter_reading
  from public.service_jobs where workspace_id=v_ws and machine_id=v_job.machine_id and deleted_at is null
  order by created_at desc,id limit 500 offset p_offset
 ) history;
 return jsonb_build_object('history',v_rows);
end $$;
revoke all on function public.service_machine_history(uuid,integer) from public,anon;
grant execute on function public.service_machine_history(uuid,integer) to authenticated;
commit;
