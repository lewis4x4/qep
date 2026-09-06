-- 840: qualification, signature boundaries and atomic rental commands.
-- RPCs execute only for the authenticated edge service role; table triggers
-- remain the backstop for alternate staff/portal/compatibility writes.
begin;
alter table public.rental_contracts
 add column if not exists needs_assessment jsonb not null default '{}'::jsonb,
 add column if not exists origination_request_id uuid,
 add column if not exists origination_request_payload jsonb;
create unique index if not exists rental_contract_origination_request
 on public.rental_contracts(workspace_id, origination_request_id)
 where origination_request_id is not null;
alter table public.traffic_tickets add column if not exists rental_contract_id uuid
 references public.rental_contracts(id);
alter table public.traffic_tickets add column if not exists rental_signature_required boolean not null default false,
 add column if not exists rental_needs_assessment_snapshot jsonb;
update public.traffic_tickets set rental_signature_required=true where ticket_type in ('rental','re_rent') or rental_contract_id is not null;
create index if not exists traffic_rental_contract on public.traffic_tickets(rental_contract_id)
 where rental_contract_id is not null;

create or replace function public.rental_assessment_missing(p_assessment jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare key text; answer jsonb; missing text[] := '{}';
begin
 foreach key in array ARRAY['equipment_type','size_capacity_specs','attachments','desired_start_date','timeframe_flexibility','duration','desired_return_date','project_location','site_conditions','access_restrictions','delivery','pickup','delivery_hours','account_status','account_lookup','customer_name','company_name','email','jobsite_contact_name','jobsite_contact_phone','operator_training','budget','insurance','payment_method'] loop
  answer := p_assessment->'answers'->key;
  if answer is null or coalesce(answer->>'status','') not in ('answered','unknown','not_applicable')
   or (answer->>'status' = 'answered' and (jsonb_typeof(answer->'value') is distinct from 'string' or nullif(btrim(answer->>'value'),'') is null)) then
   missing := array_append(missing,key);
  end if;
 end loop;
 foreach key in array ARRAY['equipment_type','duration','delivery'] loop
  if p_assessment->'answers'->key->>'status' is distinct from 'answered'
   or nullif(btrim(p_assessment->'answers'->key->>'value'),'') is null then
   missing := array_append(missing,'confirm_'||key);
  end if;
 end loop;
 if p_assessment->'answers'->'delivery'->>'status' = 'answered' and p_assessment->'answers'->'delivery'->>'value' not in ('delivery','self_haul') then missing := array_append(missing,'delivery_choice'); end if;
 if p_assessment->>'reviewed' is distinct from 'true' then missing := array_append(missing,'advisor_review'); end if;
 return missing;
end $$;

-- Normalize compatibility status BEFORE every validation. A caller changing
-- both columns cannot smuggle an illegal lifecycle past the validator.
create or replace function public.rental_contract_sync_status()
returns trigger language plpgsql set search_path = '' as $$
declare mapped text;
begin
 mapped := case new.status when 'submitted' then 'draft' when 'reviewing' then 'draft'
 when 'approved' then 'reserved' when 'awaiting_payment' then 'reserved'
 when 'active' then 'on_rent' when 'completed' then 'returned' else new.status end;
 if TG_OP='INSERT' then
  if new.lifecycle_state='draft' then new.lifecycle_state:=mapped; end if;
 elsif new.status is distinct from old.status and new.lifecycle_state is not distinct from old.lifecycle_state then
  new.lifecycle_state:=mapped;
 elsif new.status is distinct from old.status and new.lifecycle_state is distinct from old.lifecycle_state
  and mapped<>new.lifecycle_state
  and not (new.status='active' and new.lifecycle_state='off_rent')
  and not (new.status='completed' and new.lifecycle_state='closed') then
  raise exception 'Conflicting rental status and lifecycle';
 end if;
 if new.portal_customer_id is not null then
  new.status := case new.lifecycle_state when 'draft' then 'reviewing' when 'reserved' then 'approved'
   when 'on_rent' then 'active' when 'off_rent' then 'active'
   when 'returned' then 'completed' when 'closed' then 'completed' else new.lifecycle_state end;
 else new.status:=new.lifecycle_state; end if;
 return new;
end $$;
drop trigger if exists trg_a_rental_contract_sync_status on public.rental_contracts;
drop trigger if exists trg_rental_contract_sync_status on public.rental_contracts;
drop trigger if exists trg_0_rental_contract_guard_transition on public.rental_contracts;
create trigger trg_00_rental_contract_sync_status before insert or update on public.rental_contracts
 for each row execute function public.rental_contract_sync_status();
-- Verify the signed rate evidence, not merely an unrelated valid signature ID.
-- Original dates/equipment may be superseded by recorded extension/exchange commands;
-- the frozen commercial rate remains anchored to the customer's signature.
create or replace function public.rental_signature_matches_rates(p_contract public.rental_contracts)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare terms jsonb; rate_key text; signed_rate jsonb;
begin
 select signed_snapshot->'rental_contract' into terms from public.rental_contract_signatures
 where id=p_contract.native_signature_id and rental_contract_id=p_contract.id
  and workspace_id=p_contract.workspace_id and is_valid;
 if not found or jsonb_typeof(terms) is distinct from 'object' then return false; end if;
 foreach rate_key in array array['daily','weekly','monthly'] loop
  if terms ? (rate_key||'_rate') then signed_rate:=terms->(rate_key||'_rate');
  elsif terms ? ('agreed_'||rate_key||'_rate') then signed_rate:=terms->('agreed_'||rate_key||'_rate');
  else return false; end if;
  if (signed_rate #>> '{}')::numeric is distinct from (to_jsonb(p_contract)->>('agreed_'||rate_key||'_rate'))::numeric then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function public.rental_signature_matches_rates(public.rental_contracts) from public,anon,authenticated;
grant execute on function public.rental_signature_matches_rates(public.rental_contracts) to service_role;

CREATE OR REPLACE FUNCTION public.rental_contract_guard_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    IF OLD.lifecycle_state IN ('closed', 'cancelled', 'declined', 'expired') THEN
      RAISE EXCEPTION 'rental contract % is % and cannot transition to %',
        OLD.id, OLD.lifecycle_state, NEW.lifecycle_state;
    END IF;

    IF true THEN
      allowed := CASE
        WHEN OLD.lifecycle_state = 'draft'    AND NEW.lifecycle_state IN ('quoted', 'reserved', 'cancelled', 'declined') THEN true
        WHEN OLD.lifecycle_state = 'quoted'   AND NEW.lifecycle_state IN ('reserved', 'cancelled', 'declined', 'expired') THEN true
        WHEN OLD.lifecycle_state = 'reserved' AND NEW.lifecycle_state IN ('on_rent', 'cancelled', 'declined', 'expired') THEN true
        WHEN OLD.lifecycle_state = 'on_rent'  AND NEW.lifecycle_state IN ('off_rent', 'returned') THEN true
        WHEN OLD.lifecycle_state = 'off_rent' AND NEW.lifecycle_state = 'returned' THEN true
        WHEN OLD.lifecycle_state = 'returned' AND NEW.lifecycle_state = 'closed' THEN true
        WHEN NEW.lifecycle_state = 'closed' AND NEW.hard_closed_at IS NOT NULL AND nullif(btrim(NEW.hard_close_reason),'') IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=NEW.hard_closed_by AND p.role::text IN ('manager','owner','admin')) THEN true
        ELSE false
      END;

      IF NOT allowed THEN
        RAISE EXCEPTION 'illegal rental lifecycle transition % -> % on contract %',
          OLD.lifecycle_state, NEW.lifecycle_state, OLD.id;
      END IF;

      IF NEW.lifecycle_state = 'reserved' AND NEW.portal_customer_id IS NULL AND NEW.qrm_company_id IS NULL THEN
        RAISE EXCEPTION 'rental contract % needs a customer anchor before reservation', OLD.id;
      END IF;

      IF NEW.lifecycle_state = 'on_rent' THEN
        IF NEW.equipment_id IS NULL OR NEW.assignment_status IS DISTINCT FROM 'assigned' THEN
          RAISE EXCEPTION 'rental contract % needs an assigned unit before going on rent', OLD.id;
        END IF;

        -- Check-out security (mig 770): deposit OR credit OR audited override.
        IF NEW.checkout_security_override_by IS NOT NULL THEN
          NEW.checkout_security_override_at := COALESCE(NEW.checkout_security_override_at, now());
        ELSIF NEW.qrm_company_id IS NOT NULL THEN
          IF COALESCE(NEW.deposit_status, '') = 'paid' THEN
            NULL;
          ELSIF NEW.deposit_required THEN
            RAISE EXCEPTION 'rental contract % requires its deposit posted (or a manager security override) before going on rent', OLD.id;
          ELSIF EXISTS (
            SELECT 1 FROM public.ar_credit_blocks b
            WHERE b.company_id = NEW.qrm_company_id
              AND b.status = 'active'
              AND b.cleared_at IS NULL
              AND (b.override_until IS NULL OR b.override_until < now())
          ) THEN
            RAISE EXCEPTION 'rental contract % is credit-held: post a deposit, clear/override the AR block, or record a manager security override', OLD.id;
          END IF;
        ELSIF COALESCE(NEW.deposit_status, 'not_required') NOT IN ('not_required', 'paid') THEN
          RAISE EXCEPTION 'rental contract % deposit must be settled (or not required) before going on rent', OLD.id;
        END IF;

        -- Check-out condition inspection (mig 773, opt-in per contract).
        IF NEW.checkout_inspection_required AND NOT EXISTS (
          SELECT 1 FROM public.inspection_runs ir
          WHERE ir.rental_contract_id = NEW.id AND ir.completed_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'rental contract % requires a completed check-out inspection before going on rent', OLD.id;
        END IF;

        IF NEW.coi_required AND NEW.coi_received_at IS NULL THEN
          RAISE EXCEPTION 'rental contract % requires a COI on file before going on rent', OLD.id;
        END IF;
        IF NOT public.rental_signature_matches_rates(NEW) THEN
          RAISE EXCEPTION 'rental contract % needs a valid signed contract matching its rates before going on rent', OLD.id;
        END IF;
      END IF;

      IF NEW.lifecycle_state = 'closed'
         AND OLD.lifecycle_state <> 'returned' AND NEW.hard_closed_at IS NULL THEN
        RAISE EXCEPTION 'rental contract % can only close after return or via audited hard close', OLD.id;
      END IF;
    END IF;

    IF NEW.lifecycle_state = 'on_rent' THEN
      NEW.on_rent_at := COALESCE(NEW.on_rent_at, now());
    ELSIF NEW.lifecycle_state = 'off_rent' THEN
      NEW.off_rent_at := COALESCE(NEW.off_rent_at, now());  -- billing clock stops here
    ELSIF NEW.lifecycle_state = 'returned' THEN
      NEW.returned_at := COALESCE(NEW.returned_at, now());
    ELSIF NEW.lifecycle_state = 'closed' THEN
      NEW.closed_at := COALESCE(NEW.closed_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


create trigger trg_01_rental_contract_guard_transition before insert or update on public.rental_contracts
 for each row execute function public.rental_contract_guard_transition();

create or replace function public.rental_qualification_guard()
returns trigger language plpgsql set search_path = '' as $$
declare missing text[];
begin
 if TG_OP='UPDATE' and old.native_signature_id is not null and new.needs_assessment is distinct from old.needs_assessment then raise exception 'Signed inquiry is immutable; create a new quote for changed requirements'; end if;
 if new.native_signature_id is not null and not exists(select 1 from public.rental_contract_signatures sig where sig.id=new.native_signature_id and sig.rental_contract_id=new.id and sig.workspace_id=new.workspace_id and sig.is_valid) then raise exception 'Signature must belong to this rental contract'; end if;
 if TG_OP='INSERT' and new.lifecycle_state not in ('draft') then
  raise exception 'New rentals must begin as drafts';
 end if;
 if new.lifecycle_state in ('quoted','reserved') and
  (TG_OP='INSERT' or new.lifecycle_state is distinct from old.lifecycle_state
   or new.needs_assessment is distinct from old.needs_assessment) then
  missing := public.rental_assessment_missing(new.needs_assessment);
  if cardinality(missing)>0 then raise exception 'Complete rental assessment before quoting: %',array_to_string(missing,', '); end if;
  if new.lifecycle_state='reserved' and (new.needs_assessment->>'return_date_confirmed' is distinct from 'true'
   or new.requested_end_date is null or new.needs_assessment->'answers'->'desired_return_date'->>'status' is distinct from 'answered'
   or new.needs_assessment->'answers'->'desired_return_date'->>'value' is distinct from new.requested_end_date::text) then raise exception 'Confirm return date at booking'; end if;
 end if;
 return new;
end $$;
create trigger trg_02_rental_qualification before insert or update on public.rental_contracts
 for each row execute function public.rental_qualification_guard();

create or replace function public.rental_transport_signature_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.rental_contracts;
begin
 if TG_OP='UPDATE' then new.rental_signature_required:=old.rental_signature_required or old.ticket_type in ('rental','re_rent') or old.rental_contract_id is not null; else new.rental_signature_required:=false; end if;
 new.rental_signature_required:=new.rental_signature_required or new.ticket_type in ('rental','re_rent') or new.rental_contract_id is not null;
 if new.rental_contract_id is not null then
  select * into c from public.rental_contracts where id=new.rental_contract_id and workspace_id=new.workspace_id;
  if not found then raise exception 'Rental transport contract does not belong to this workspace'; end if;
  if new.equipment_id is not null and new.equipment_id is distinct from c.equipment_id and not exists(select 1 from public.rental_contract_lines l where l.rental_contract_id=c.id and l.equipment_id=new.equipment_id and l.workspace_id=new.workspace_id and l.deleted_at is null) then raise exception 'Transport unit does not belong to the signed rental contract'; end if;
  if TG_OP='INSERT' then new.rental_needs_assessment_snapshot:=c.needs_assessment;
  elsif new.rental_contract_id is distinct from old.rental_contract_id or old.rental_needs_assessment_snapshot is null or (old.status='haul_pending' and new.status<>'haul_pending') then new.rental_needs_assessment_snapshot:=c.needs_assessment;
  else new.rental_needs_assessment_snapshot:=old.rental_needs_assessment_snapshot; end if;
 end if;
 if new.rental_signature_required then
  if new.status in ('scheduled','being_shipped','completed') then
   if c.id is null or not public.rental_signature_matches_rates(c) then
    raise exception 'Signed rental contract is required before delivery scheduling';
   end if;
  end if;
 end if;
 return new;
end $$;
create trigger rental_transport_signature_guard before insert or update on public.traffic_tickets
 for each row execute function public.rental_transport_signature_guard();

-- Private JSON insert utility preserves DEFAULT values for omitted columns.
-- Only fixed rental tables are allowed; it has no API execute grant.
create or replace function public.rental_insert_command_row(p_table text,p_row jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare cols text; result jsonb;
begin
 if p_table not in ('rental_contracts','rental_contract_lines','rental_contract_signatures') then raise exception 'Invalid rental command table'; end if;
 select string_agg(format('%I',key),',' order by key) into cols from jsonb_object_keys(p_row) key;
 execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) returning to_jsonb(%1$I.*)',p_table,cols)
 into result using p_row;
 return result;
end $$;
revoke all on function public.rental_insert_command_row(text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.rental_create_draft_atomic(p_workspace text,p_actor uuid,p_request_id uuid,p_request jsonb,p_contract jsonb,p_line jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.rental_contracts; result jsonb;
begin
 if p_request_id is null then raise exception 'Origination request ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace||p_request_id::text,0));
 select * into c from public.rental_contracts where workspace_id=p_workspace and origination_request_id=p_request_id;
 if found then
  if c.origination_request_payload is distinct from p_request then raise exception 'Origination retry payload changed'; end if;
  return to_jsonb(c);
 end if;
 if not exists(select 1 from public.qrm_companies where id=(p_contract->>'qrm_company_id')::uuid and workspace_id=p_workspace) then raise exception 'Customer outside workspace'; end if;
 if nullif(p_contract->>'qrm_contact_id','') is not null and not exists(select 1 from public.qrm_contacts where id=(p_contract->>'qrm_contact_id')::uuid and workspace_id=p_workspace) then raise exception 'Contact outside workspace'; end if;
 if nullif(p_contract->>'equipment_id','') is not null and not exists(select 1 from public.crm_equipment where id=(p_contract->>'equipment_id')::uuid and workspace_id=p_workspace and ownership='rental_fleet') then raise exception 'Unit outside rental workspace'; end if;
 result := public.rental_insert_command_row('rental_contracts',p_contract||jsonb_build_object('workspace_id',p_workspace,'originated_by',p_actor,'origination_request_id',p_request_id,'origination_request_payload',p_request,'lifecycle_state','draft','status','draft'));
 if p_line is not null then
  perform public.rental_insert_command_row('rental_contract_lines',p_line||jsonb_build_object('workspace_id',p_workspace,'rental_contract_id',result->>'id','line_number',1));
 end if;
 return result;
end $$;

create or replace function public.rental_checkout_atomic(p_workspace text,p_contract_id uuid,p_patch jsonb,p_meter numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.rental_contracts; desired public.rental_contracts; line_count integer; unit uuid;
begin
 select * into c from public.rental_contracts where id=p_contract_id and workspace_id=p_workspace and deleted_at is null for update;
 if not found then raise exception 'Rental contract not found'; end if;
 if c.lifecycle_state='on_rent' and exists(select 1 from public.rental_contract_lines where rental_contract_id=c.id and deleted_at is null)
  and not exists(select 1 from public.rental_contract_lines where rental_contract_id=c.id and deleted_at is null and status in ('quoted','reserved')) then
  if not public.rental_signature_matches_rates(c) then raise exception 'Signed rates require reconciliation before checkout replay'; end if;
  return to_jsonb(c); end if;
 if c.lifecycle_state not in ('reserved','on_rent') then raise exception 'Only reserved contracts can check out'; end if;
 desired:=jsonb_populate_record(c,p_patch);
 -- Also re-check a pre-840 partial checkout whose header is already on_rent.
 if not public.rental_signature_matches_rates(desired) then raise exception 'Valid rental signature matching its rates required'; end if;
 if desired.checkout_inspection_required and not exists(select 1 from public.inspection_runs where rental_contract_id=c.id and completed_at is not null) then raise exception 'Completed checkout inspection required'; end if;
 if desired.coi_required and desired.coi_received_at is null then raise exception 'COI required'; end if;
 if desired.checkout_security_override_by is not null and not exists(select 1 from public.profiles where id=desired.checkout_security_override_by and role::text in ('admin','manager','owner')) then raise exception 'Invalid checkout security override'; end if;
 if desired.checkout_security_override_by is null and coalesce(desired.deposit_status,'')<>'paid' then
  if desired.deposit_required then raise exception 'Deposit required before checkout'; end if;
  if exists(select 1 from public.ar_credit_blocks b where b.company_id=desired.qrm_company_id and b.status='active' and b.cleared_at is null and (b.override_until is null or b.override_until<now())) then raise exception 'Rental customer is credit-held'; end if;
 end if;
 if p_meter is null then select machine_hours into p_meter from public.inspection_runs where rental_contract_id=c.id and completed_at is not null order by completed_at desc limit 1; end if;
 if not exists(select 1 from public.crm_equipment where id=desired.equipment_id and workspace_id=p_workspace and ownership='rental_fleet') then raise exception 'Outgoing unit outside rental workspace'; end if;
 if exists(select 1 from public.rental_contract_lines l left join public.crm_equipment e on e.id=l.equipment_id and e.workspace_id=p_workspace where l.rental_contract_id=c.id and l.deleted_at is null and l.equipment_id is not null and e.id is null) then raise exception 'Line unit outside workspace'; end if;
 select count(*) into line_count from public.rental_contract_lines where rental_contract_id=c.id and deleted_at is null;
 if desired.equipment_id is distinct from c.equipment_id and line_count>1 then
  raise exception 'Assign each line separately before checking out a multi-line contract';
 end if;
 -- Lock every outgoing unit in a deterministic order, across contracts.
 for unit in select id from public.crm_equipment where id=desired.equipment_id or id in
  (select equipment_id from public.rental_contract_lines where rental_contract_id=c.id and deleted_at is null)
  order by id for update loop
  if exists(select 1 from public.rental_contract_lines l where l.equipment_id=unit
   and l.rental_contract_id<>c.id and l.status in ('active','held') and l.deleted_at is null) then
   raise exception 'Rental unit already active on another contract';
  end if;
 end loop;
 update public.rental_contracts set equipment_id=desired.equipment_id,assignment_status=desired.assignment_status,
  approved_start_date=desired.approved_start_date,approved_end_date=desired.approved_end_date,
  agreed_daily_rate=desired.agreed_daily_rate,agreed_weekly_rate=desired.agreed_weekly_rate,agreed_monthly_rate=desired.agreed_monthly_rate,
  deposit_status=desired.deposit_status,
  checkout_security_override_by=desired.checkout_security_override_by,checkout_security_override_at=desired.checkout_security_override_at,
  checkout_security_override_reason=desired.checkout_security_override_reason,lifecycle_state='on_rent'
 where id=c.id returning * into c;
 if line_count=0 then
  insert into public.rental_contract_lines(workspace_id,rental_contract_id,line_number,quantity,equipment_id,
    rental_start_at,rental_end_at,outbound_meter_hours,daily_rate_cents,weekly_rate_cents,monthly_rate_cents,status)
  values(p_workspace,c.id,1,1,c.equipment_id,now(),coalesce(c.approved_end_date,c.requested_end_date),p_meter,
    round(c.agreed_daily_rate*100),round(c.agreed_weekly_rate*100),round(c.agreed_monthly_rate*100),'active');
 else
  update public.rental_contract_lines set status='active',outbound_meter_hours=coalesce(outbound_meter_hours,p_meter),
   equipment_id=case when line_count=1 then c.equipment_id else equipment_id end
   where rental_contract_id=c.id and workspace_id=p_workspace and deleted_at is null and status in ('quoted','reserved');
 end if;
 return to_jsonb(c);
end $$;

create or replace function public.rental_exchange_atomic(p_workspace text,p_contract_id uuid,p_line_id uuid,p_new_line jsonb,p_return_meter numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.rental_contracts; old_line public.rental_contract_lines; existing public.rental_contract_lines; inserted jsonb; next_number integer; unit public.crm_equipment;
begin
 select * into c from public.rental_contracts where id=p_contract_id and workspace_id=p_workspace and deleted_at is null for update;
 if not found then raise exception 'Rental contract not found'; end if;
 select * into old_line from public.rental_contract_lines where id=p_line_id and rental_contract_id=c.id and workspace_id=p_workspace and deleted_at is null for update;
 if not found then raise exception 'Rental line not found'; end if;
 select * into existing from public.rental_contract_lines where exchange_parent_line_id=old_line.id and deleted_at is null order by created_at limit 1;
 if found then
  if existing.equipment_id::text is distinct from p_new_line->>'equipment_id'
   or existing.exchange_rate_continuous is distinct from (p_new_line->>'exchange_rate_continuous')::boolean then
   raise exception 'This line was already exchanged with different terms';
  end if;
  -- Repair a pre-840 partial exchange as well as replay a completed one.
  if old_line.status in ('active','held') then
   update public.rental_contract_lines set status='exchanged',return_code='exchange',actual_returned_at=coalesce(actual_returned_at,existing.rental_start_at),return_meter_hours=p_return_meter where id=old_line.id;
  end if;
  if c.equipment_id=old_line.equipment_id then update public.rental_contracts set equipment_id=existing.equipment_id where id=c.id; end if;
  return to_jsonb(existing);
 end if;
 if c.lifecycle_state<>'on_rent' or old_line.status not in ('active','held') then raise exception 'Only active or held on-rent lines can exchange'; end if;
 select * into unit from public.crm_equipment where id=(p_new_line->>'equipment_id')::uuid and workspace_id=p_workspace and ownership='rental_fleet' for update;
 if not found or unit.availability<>'available' then raise exception 'Replacement rental unit is unavailable'; end if;
 if exists(select 1 from public.rental_contract_lines where equipment_id=unit.id and status in ('active','held') and deleted_at is null) then raise exception 'Replacement already on rent'; end if;
 select coalesce(max(line_number),0)+1 into next_number from public.rental_contract_lines where rental_contract_id=c.id;
 inserted:=public.rental_insert_command_row('rental_contract_lines',p_new_line||jsonb_build_object('workspace_id',p_workspace,'rental_contract_id',c.id,'line_number',next_number,'exchange_parent_line_id',old_line.id,'status','active'));
 update public.rental_contract_lines set status='exchanged',return_code='exchange',actual_returned_at=now(),return_meter_hours=p_return_meter where id=old_line.id;
 if c.equipment_id=old_line.equipment_id then update public.rental_contracts set equipment_id=unit.id where id=c.id; end if;
 return inserted;
end $$;

create or replace function public.rental_sign_quote_atomic(p_contract_id uuid,p_token text,p_signature jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.rental_contracts; s public.rental_contract_signatures; terms jsonb; result jsonb;
begin
 select * into c from public.rental_contracts where id=p_contract_id and deleted_at is null and (
  (p_token is not null and share_token=p_token) or
  (p_token is null and p_signature->>'signed_via'='portal' and portal_customer_id=nullif(p_signature->>'portal_customer_id','')::uuid)
 ) for update;
 if not found then raise exception 'Rental quote not found'; end if;
 select * into s from public.rental_contract_signatures where rental_contract_id=c.id and workspace_id=c.workspace_id and is_valid for update;
 if c.native_signature_id is not null and not public.rental_signature_matches_rates(c) then raise exception 'Signed rates changed; finance reconciliation required'; end if;
 if c.lifecycle_state not in ('quoted','reserved') then
  if s.id is not null and c.native_signature_id=s.id then return jsonb_build_object('id',c.id,'contract_number',c.contract_number,'lifecycle_state',c.lifecycle_state,'signature_id',s.id,'native_signature',to_jsonb(s)); end if;
  raise exception 'Rental quote no longer open for signing';
 end if;
 if s.id is null then
  terms:=p_signature->'signed_snapshot'->'rental_contract';
  if (terms->>'requested_start_date')::date is distinct from c.requested_start_date
   or (terms->>'requested_end_date')::date is distinct from c.requested_end_date
   or (terms->>'daily_rate')::numeric is distinct from coalesce(c.agreed_daily_rate,c.estimate_daily_rate)
   or (terms->>'weekly_rate')::numeric is distinct from coalesce(c.agreed_weekly_rate,c.estimate_weekly_rate)
   or (terms->>'monthly_rate')::numeric is distinct from coalesce(c.agreed_monthly_rate,c.estimate_monthly_rate)
   or (terms ? 'equipment_id' and (terms->>'equipment_id')::uuid is distinct from c.equipment_id)
   or (terms ? 'delivery_mode' and terms->>'delivery_mode' is distinct from c.delivery_mode)
   or (terms ? 'deposit_amount' and (terms->>'deposit_amount')::numeric is distinct from c.deposit_amount)
   or (terms ? 'deposit_required' and (terms->>'deposit_required')::boolean is distinct from c.deposit_required) then
   raise exception 'Rental terms changed; reload before signing';
  end if;
  result:=public.rental_insert_command_row('rental_contract_signatures',p_signature||jsonb_build_object('workspace_id',c.workspace_id,'rental_contract_id',c.id,'is_valid',true));
  s:=jsonb_populate_record(null::public.rental_contract_signatures,result);
 end if;
 if c.native_signature_id is null and (
   (s.signed_snapshot->'rental_contract'->>'requested_start_date')::date is distinct from c.requested_start_date
   or (s.signed_snapshot->'rental_contract'->>'requested_end_date')::date is distinct from c.requested_end_date
   or coalesce(s.signed_snapshot->'rental_contract'->>'daily_rate',s.signed_snapshot->'rental_contract'->>'agreed_daily_rate')::numeric is distinct from coalesce(c.agreed_daily_rate,c.estimate_daily_rate)
   or coalesce(s.signed_snapshot->'rental_contract'->>'weekly_rate',s.signed_snapshot->'rental_contract'->>'agreed_weekly_rate')::numeric is distinct from coalesce(c.agreed_weekly_rate,c.estimate_weekly_rate)
   or coalesce(s.signed_snapshot->'rental_contract'->>'monthly_rate',s.signed_snapshot->'rental_contract'->>'agreed_monthly_rate')::numeric is distinct from coalesce(c.agreed_monthly_rate,c.estimate_monthly_rate)) then
  raise exception 'Recorded signature terms differ; dealership review required';
 end if;
 -- An orphan valid signature is completed, never merely reported successful.
 update public.rental_contracts set native_signature_id=s.id,native_signed_at=s.signed_at,native_signer_name=s.signer_name,
  agreed_daily_rate=coalesce(coalesce(s.signed_snapshot->'rental_contract'->>'daily_rate',s.signed_snapshot->'rental_contract'->>'agreed_daily_rate')::numeric,c.agreed_daily_rate,c.estimate_daily_rate),
  agreed_weekly_rate=coalesce(coalesce(s.signed_snapshot->'rental_contract'->>'weekly_rate',s.signed_snapshot->'rental_contract'->>'agreed_weekly_rate')::numeric,c.agreed_weekly_rate,c.estimate_weekly_rate),
  agreed_monthly_rate=coalesce(coalesce(s.signed_snapshot->'rental_contract'->>'monthly_rate',s.signed_snapshot->'rental_contract'->>'agreed_monthly_rate')::numeric,c.agreed_monthly_rate,c.estimate_monthly_rate),
  lifecycle_state='reserved' where id=c.id returning * into c;
 return jsonb_build_object('id',c.id,'contract_number',c.contract_number,'lifecycle_state',c.lifecycle_state,'signature_id',s.id,'native_signature',to_jsonb(s));
end $$;

revoke all on function public.rental_create_draft_atomic(text,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.rental_checkout_atomic(text,uuid,jsonb,numeric) from public,anon,authenticated;
revoke all on function public.rental_exchange_atomic(text,uuid,uuid,jsonb,numeric) from public,anon,authenticated;
revoke all on function public.rental_sign_quote_atomic(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rental_create_draft_atomic(text,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.rental_checkout_atomic(text,uuid,jsonb,numeric) to service_role;
grant execute on function public.rental_exchange_atomic(text,uuid,uuid,jsonb,numeric) to service_role;
grant execute on function public.rental_sign_quote_atomic(uuid,text,jsonb) to service_role;
-- All browser writes were traced: the rental desk reads tables and mutates via
-- rental-ops; portal-api, billing and Flow use the service role. Keep guarded
-- SECURITY DEFINER domain operations, but close direct table/column PATCH paths.
revoke insert,update,delete,truncate,references,trigger on public.rental_contracts,public.rental_contract_lines from public,anon,authenticated;
grant select on public.rental_contracts,public.rental_contract_lines to authenticated;
grant select,insert,update,delete on public.rental_contracts,public.rental_contract_lines to service_role;
do $$ declare table_name text; columns text; begin
 foreach table_name in array array['rental_contracts','rental_contract_lines'] loop
  select string_agg(format('%I',attname),',' order by attnum) into columns from pg_catalog.pg_attribute
  where attrelid=format('public.%I',table_name)::regclass and attnum>0 and not attisdropped;
  execute format('revoke insert (%1$s), update (%1$s), references (%1$s) on public.%2$I from public,anon,authenticated',columns,table_name);
 end loop;
 -- This legacy definer trusts supplied workspace/actor arguments. Its only UI
 -- caller is now the authorized rental-ops edge handler, so retain service only.
 if to_regprocedure('public.rental_close_contract(text,uuid,uuid,boolean,text)') is not null then
  execute 'revoke all on function public.rental_close_contract(text,uuid,uuid,boolean,text) from public,anon,authenticated';
  execute 'grant execute on function public.rental_close_contract(text,uuid,uuid,boolean,text) to service_role';
 end if;
end $$;
commit;
