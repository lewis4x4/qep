import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { withScratchPostgres, hasScratchPostgres } from "../../scripts/testing/scratch-postgres";
import { emptyRentalAssessment, RENTAL_ASSESSMENT_FIELDS } from "../../shared/rental-needs-assessment";
const migration = readFileSync(new URL("./840_rental_qualification_and_atomic_commands.sql", import.meta.url), "utf8");
const assessment = emptyRentalAssessment();
for (const [key] of RENTAL_ASSESSMENT_FIELDS) assessment.answers[key] = { status: "unknown", value: "" };
for (const key of ["equipment_type", "duration", "delivery"]) assessment.answers[key] = { status: "answered", value: "confirmed" };
assessment.answers.delivery = { status: "answered", value: "self_haul" };
assessment.answers.desired_return_date = { status: "answered", value: "2026-10-06" };
assessment.reviewed = true; assessment.return_date_confirmed = true;
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const fixture = `
create role authenticated; create role anon; create role service_role bypassrls;
create table profiles(id uuid primary key,role text);
create table qrm_companies(id uuid primary key, workspace_id text);
create table qrm_contacts(id uuid primary key, workspace_id text);
create table crm_equipment(id uuid primary key,workspace_id text,ownership text,availability text);
create table ar_credit_blocks(company_id uuid,status text,cleared_at timestamptz,override_until timestamptz);
create table inspection_runs(id uuid primary key,rental_contract_id uuid,completed_at timestamptz,machine_hours numeric);
create table rental_contracts(id uuid primary key default gen_random_uuid(),workspace_id text not null,contract_number text default 'RC-test',
 qrm_company_id uuid,portal_customer_id uuid,qrm_contact_id uuid,originated_by uuid,equipment_id uuid,assignment_status text default 'assigned',
 lifecycle_state text default 'draft',status text default 'draft',share_token text,deleted_at timestamptz,created_at timestamptz default now(),
 requested_start_date date,requested_end_date date,approved_start_date date,approved_end_date date,
 estimate_daily_rate numeric,estimate_weekly_rate numeric,estimate_monthly_rate numeric,agreed_daily_rate numeric,agreed_weekly_rate numeric,agreed_monthly_rate numeric,
 delivery_mode text,deposit_amount numeric,deposit_status text,deposit_required boolean default false,checkout_security_override_by uuid,checkout_security_override_at timestamptz,checkout_security_override_reason text,
 rate_override_approved_by uuid,checkout_inspection_required boolean default false,coi_required boolean default false,coi_received_at timestamptz,native_signature_id uuid,native_signed_at timestamptz,native_signer_name text,
 hard_closed_at timestamptz,hard_closed_by uuid,hard_close_reason text,on_rent_at timestamptz,off_rent_at timestamptz,returned_at timestamptz,closed_at timestamptz);
create table rental_contract_lines(id uuid primary key default gen_random_uuid(),workspace_id text,rental_contract_id uuid references rental_contracts,
 line_number integer,quantity numeric check(quantity>0),equipment_id uuid,status text,deleted_at timestamptz,created_at timestamptz default now(),
 rental_start_at timestamptz,rental_end_at timestamptz,outbound_meter_hours numeric,return_meter_hours numeric,actual_returned_at timestamptz,return_code text,
 daily_rate_cents bigint,weekly_rate_cents bigint,monthly_rate_cents bigint,hourly_rate_cents bigint,
 exchange_parent_line_id uuid,exchange_rate_continuous boolean,substitution_reason text,
 unique(rental_contract_id,line_number));
create table rental_contract_signatures(id uuid primary key default gen_random_uuid(),workspace_id text,rental_contract_id uuid references rental_contracts,
 portal_customer_id uuid,signer_name text,signature_image_url text,signer_ip text,signer_user_agent text,signed_snapshot jsonb,
 signed_via text,document_hash text,is_valid boolean default true,signed_at timestamptz default now());
create unique index one_valid_signature on rental_contract_signatures(rental_contract_id) where is_valid;
create table traffic_tickets(id uuid primary key default gen_random_uuid(),workspace_id text,equipment_id uuid,ticket_type text,status text);
grant usage on schema public to authenticated,service_role,anon;
grant select,insert,update on all tables in schema public to authenticated,service_role;
insert into qrm_companies values('${id(1)}','w');
insert into profiles values('${id(2)}','rep');
insert into crm_equipment values('${id(3)}','w','rental_fleet','available'),('${id(4)}','w','rental_fleet','available');
create function test_line_failure() returns trigger language plpgsql as $$begin
 if current_setting('test.fail',true)='checkout' and new.status='active' then raise exception 'injected checkout failure'; end if;
 if current_setting('test.fail',true)='exchange' and new.status='exchanged' then raise exception 'injected exchange failure'; end if;
 return new; end$$;
create trigger line_failure before insert or update on rental_contract_lines for each row execute function test_line_failure();
create function test_contract_failure() returns trigger language plpgsql as $$begin
 if current_setting('test.fail',true)='signature' and new.lifecycle_state='reserved' then raise exception 'injected reservation failure'; end if;
 return new; end$$;
create trigger zz_contract_failure before update on rental_contracts for each row execute function test_contract_failure();
`;
function draft(n: number) { return `insert into rental_contracts(id,workspace_id,qrm_company_id,equipment_id,needs_assessment,requested_start_date,requested_end_date,estimate_daily_rate,share_token) values('${id(n)}','w','${id(1)}','${id(3)}',${json(assessment)},'2026-09-06','2026-10-06',10,'token-${n}');`; }
function proof(n: number) { return `insert into rental_contract_signatures(id,workspace_id,rental_contract_id,is_valid,signed_snapshot) values('${id(n+100)}','w','${id(n)}',true,'{"rental_contract":{"daily_rate":null,"weekly_rate":null,"monthly_rate":null}}'); update rental_contracts set native_signature_id='${id(n+100)}' where id='${id(n)}';`; }
(hasScratchPostgres ? describe : describe.skip)("rental qualification and atomic commands", () => {
 it("blocks legacy/dual-column lifecycle bypasses and requires assessment and actual signature before scheduling", () => withScratchPostgres(query => {
  query(fixture); query(migration); query(draft(10));
  expect(() => query(`set role authenticated; update rental_contracts set status='active' where id='${id(10)}'`)).toThrow("permission denied");
  expect(() => query(`set role authenticated; update rental_contracts set status='active',lifecycle_state='on_rent' where id='${id(10)}'`)).toThrow("permission denied");
  query(`update rental_contracts set needs_assessment='{}' where id='${id(10)}';`);
  expect(() => query(`update rental_contracts set status='quoted' where id='${id(10)}'`)).toThrow("Complete rental assessment");
  query(`update rental_contracts set needs_assessment=${json(assessment)},lifecycle_state='quoted' where id='${id(10)}'; update rental_contracts set lifecycle_state='reserved' where id='${id(10)}';`);
  query(`update rental_contracts set rate_override_approved_by='${id(2)}' where id='${id(10)}';`);
  expect(() => query(`update rental_contracts set status='active' where id='${id(10)}'`)).toThrow("valid signed contract");
  expect(() => query(`insert into traffic_tickets(workspace_id,ticket_type,status,rental_contract_id) values('w','rental','scheduled','${id(10)}')`)).toThrow("Signed rental contract");
  query(`insert into traffic_tickets(id,workspace_id,ticket_type,status) values('${id(600)}','w','rental','haul_pending'); update traffic_tickets set ticket_type='sale',rental_signature_required=false where id='${id(600)}';`);
  expect(() => query(`update traffic_tickets set status='scheduled' where id='${id(600)}'`)).toThrow("Signed rental contract");
  query(proof(10));
  query(`update rental_contracts set coi_required=true,checkout_inspection_required=true where id='${id(10)}';`);
  expect(() => query(`update rental_contracts set lifecycle_state='on_rent' where id='${id(10)}'`)).toThrow("completed check-out inspection");
  query(`insert into inspection_runs values('${id(500)}','${id(10)}',now(),20);`);
  expect(() => query(`update rental_contracts set lifecycle_state='on_rent' where id='${id(10)}'`)).toThrow("COI");
  query(`update rental_contracts set coi_received_at=now() where id='${id(10)}'; insert into ar_credit_blocks values('${id(1)}','active',null,null);`);
  expect(() => query(`update rental_contracts set lifecycle_state='on_rent' where id='${id(10)}'`)).toThrow("credit-held");
  query(`update rental_contracts set deposit_status='paid' where id='${id(10)}';`);

  expect(query(`insert into traffic_tickets(workspace_id,ticket_type,status,rental_contract_id) values('w','rental','scheduled','${id(10)}'); select count(*) from traffic_tickets where status='scheduled';`)).toContain("1");
 }), 30000);
 it("rolls back draft plus line together and replays the same origination once", () => withScratchPostgres(query => {
  query(fixture); query(migration);
  const contract = { qrm_company_id:id(1), equipment_id:id(3), needs_assessment:assessment };
  const call=(quantity:number) => `select rental_create_draft_atomic('w','${id(2)}','${id(20)}','{}',${json(contract)},${json({quantity,status:'quoted',equipment_id:id(3)})});`;
  expect(() => query(call(-1))).toThrow(); expect(query("select count(*) from rental_contracts")).toBe("0");
  query(call(1)); query(call(1)); expect(query("select count(*) from rental_contracts")).toBe("1"); expect(query("select count(*) from rental_contract_lines")).toBe("1");
  expect(() => query(`set role authenticated; ${call(1)}`)).toThrow("permission denied");
 }), 30000);
 it("keeps checkout header and all lines atomic and confirms idempotent replay", () => withScratchPostgres(query => {
  query(fixture); query(migration); query(draft(30)+proof(30));
  query(`update rental_contracts set lifecycle_state='reserved' where id='${id(30)}'; insert into rental_contract_lines(workspace_id,rental_contract_id,line_number,quantity,equipment_id,status) values('w','${id(30)}',1,1,'${id(3)}','reserved'),('w','${id(30)}',2,1,'${id(4)}','reserved');`);
  const call=`select rental_checkout_atomic('w','${id(30)}','{}',100);`;
  expect(() => query(`set test.fail='checkout'; ${call}`)).toThrow("injected checkout");
  expect(query(`select lifecycle_state from rental_contracts where id='${id(30)}'`)).toBe("reserved");
  expect(query("select count(*) from rental_contract_lines where status='reserved'")).toBe("2");
  query(call); query(`update rental_contract_lines set status='reserved' where line_number=2;`); query(call); expect(query("select count(*) from rental_contract_lines where status='active'")).toBe("2");
 }), 30000);
 it("rolls exchange back when closing old line fails and safely replays completed exchange", () => withScratchPostgres(query => {
  query(fixture); query(migration); query(draft(40)+proof(40));
  query(`update rental_contracts set lifecycle_state='reserved' where id='${id(40)}'; select rental_checkout_atomic('w','${id(40)}','{}',1); update rental_contract_lines set id='${id(41)}';`);
  const replacement={equipment_id:id(4),quantity:1,exchange_rate_continuous:true,rental_start_at:'2026-09-07T00:00:00Z'};
  const call=`select rental_exchange_atomic('w','${id(40)}','${id(41)}',${json(replacement)},11);`;
  expect(() => query(`set test.fail='exchange'; ${call}`)).toThrow("injected exchange");
  expect(query("select count(*) from rental_contract_lines")).toBe("1");
  query(call); query(call); expect(query("select count(*) from rental_contract_lines")).toBe("2");
  expect(query(`select status from rental_contract_lines where id='${id(41)}'`)).toBe("exchanged");
  expect(query(`select equipment_id from rental_contracts where id='${id(40)}'`)).toBe(id(4));
 }), 30000);
 it("rolls signature and reservation back together and repairs an existing valid orphan", () => withScratchPostgres(query => {
  query(fixture); query(migration); query(draft(50)); query(`update rental_contracts set lifecycle_state='quoted' where id='${id(50)}';`);
  const signature={signer_name:'Customer',signed_snapshot:{rental_contract:{requested_start_date:'2026-09-06',requested_end_date:'2026-10-06',daily_rate:10,weekly_rate:null,monthly_rate:null}}};
  const call=`select rental_sign_quote_atomic('${id(50)}','token-50',${json(signature)});`;
  expect(() => query(`set test.fail='signature'; ${call}`)).toThrow("injected reservation"); expect(query("select count(*) from rental_contract_signatures")).toBe("0");
  query(`insert into rental_contract_signatures(workspace_id,rental_contract_id,signer_name,signed_snapshot) values('w','${id(50)}','Customer',${json(signature.signed_snapshot)});`);
  query(call); query(call); expect(query("select count(*) from rental_contract_signatures")).toBe("1");
  expect(query(`select lifecycle_state||':'||(native_signature_id is not null)::text from rental_contracts where id='${id(50)}'`)).toBe("reserved:true");
 }), 30000);
 it("rejects native table and column PATCH forgery while retaining controlled extensions and signed prices", () => withScratchPostgres(query => {
  query(fixture);
  const legacyClose = readFileSync(new URL("./819_rental_worldclass_desk_money.sql", import.meta.url), "utf8").match(/create or replace function public\.rental_close_contract\([\s\S]*?\$\$;/i)![0];
  query(legacyClose);
  query(`insert into profiles values('${id(6)}','manager');`);
  query("grant execute on function rental_close_contract(text,uuid,uuid,boolean,text) to authenticated,service_role; grant update(agreed_daily_rate,deposit_status),insert(workspace_id) on rental_contracts to authenticated; alter table rental_contracts enable row level security; create policy permissive_staff on rental_contracts for all to authenticated using(true) with check(true);");
  query(migration); query(draft(60));
  query(`update rental_contracts set agreed_daily_rate=10 where id='${id(60)}'; insert into rental_contract_signatures(id,workspace_id,rental_contract_id,signed_snapshot) values('${id(160)}','w','${id(60)}','{"rental_contract":{"daily_rate":10,"weekly_rate":null,"monthly_rate":null}}'); update rental_contracts set native_signature_id='${id(160)}',lifecycle_state='reserved' where id='${id(60)}';`);
  for (const patch of ["checkout_security_override_by='"+id(6)+"'", "deposit_status='paid'", "coi_received_at=now()", "agreed_daily_rate=1", "status='active'"]) {
    expect(() => query(`set role authenticated; update rental_contracts set ${patch} where id='${id(60)}';`)).toThrow("permission denied");
  }
  expect(() => query("set role authenticated; insert into rental_contracts(workspace_id) values('w');")).toThrow("permission denied");
  expect(() => query(`set role authenticated; insert into rental_contract_lines(workspace_id,rental_contract_id,line_number,quantity,status) values('w','${id(60)}',1,1,'active');`)).toThrow("permission denied");
  expect(() => query("set role authenticated; update rental_contract_lines set daily_rate_cents=1;")).toThrow("permission denied");
  expect(() => query(`set role authenticated; select rental_close_contract('w','${id(60)}','${id(6)}',true,'forged approval');`)).toThrow("permission denied");
  expect(query("set role authenticated; select count(*) from rental_contracts;")).toContain("1");
  expect(query("select has_function_privilege('service_role','rental_close_contract(text,uuid,uuid,boolean,text)','execute');")).toBe("t");
  query(`set role service_role; update rental_contracts set agreed_daily_rate=1 where id='${id(60)}';`);
  expect(() => query(`set role service_role; select rental_checkout_atomic('w','${id(60)}','{}',0);`)).toThrow("matching its rates");
  expect(() => query(`insert into traffic_tickets(workspace_id,ticket_type,status,rental_contract_id) values('w','rental','scheduled','${id(60)}');`)).toThrow("Signed rental contract");
  query(`set role service_role; update rental_contracts set agreed_daily_rate=10,approved_end_date='2026-11-06',requested_end_date='2026-11-06' where id='${id(60)}'; select rental_checkout_atomic('w','${id(60)}','{}',0);`);
  expect(query(`select lifecycle_state||':'||approved_end_date::text||':'||agreed_daily_rate::text from rental_contracts where id='${id(60)}';`)).toBe("on_rent:2026-11-06:10");
 }), 30000);

 it("preserves portal signing and payment checkout with the same atomic commands", () => withScratchPostgres(query => {
  query(fixture); query(migration); query(draft(70));
  query(`update rental_contracts set portal_customer_id='${id(700)}',agreed_daily_rate=10,lifecycle_state='reserved',deposit_required=true where id='${id(70)}';`);
  const snapshot={rental_contract:{requested_start_date:"2026-09-06",requested_end_date:"2026-10-06",agreed_daily_rate:10,agreed_weekly_rate:null,agreed_monthly_rate:null}};
  query(`insert into rental_contract_signatures(workspace_id,rental_contract_id,portal_customer_id,signer_name,signed_snapshot) values('w','${id(70)}','${id(700)}','Portal customer',${json(snapshot)});`);
  const signature={signed_via:"portal",portal_customer_id:id(700)};
  const sign=`select rental_sign_quote_atomic('${id(70)}',null,${json(signature)});`;
  query(`set role service_role;${sign}`); query(`set role service_role;${sign}`);
  expect(query("select count(*) from rental_contract_signatures")).toBe("1");
  expect(() => query(`set role service_role; select rental_sign_quote_atomic('${id(70)}',null,${json({...signature,portal_customer_id:id(701)})});`)).toThrow("not found");
  expect(() => query(`set role service_role; select rental_checkout_atomic('w','${id(70)}','{}',5);`)).toThrow("Deposit required");
  query(`set role service_role; select rental_checkout_atomic('w','${id(70)}','{"deposit_status":"paid"}',5);`);
  expect(query(`select lifecycle_state||':'||deposit_status from rental_contracts where id='${id(70)}';`)).toBe("on_rent:paid");
  expect(query("select count(*) from rental_contract_lines where status='active'")).toBe("1");
 }),30000);

});
