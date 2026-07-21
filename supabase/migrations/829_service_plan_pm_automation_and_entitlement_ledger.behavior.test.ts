import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/829_service_plan_pm_automation_and_entitlement_ledger.sql",
  ),
  "utf8",
);

function postgresBin(name: string): string | null {
  const dirs = [
    process.env.QEP_POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
  ].filter((value): value is string => Boolean(value));
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const initdbPath = postgresBin("initdb");
const pgCtlPath = postgresBin("pg_ctl");
const psqlPath = postgresBin("psql");
const postgresBehavior = initdbPath && pgCtlPath && psqlPath
  ? describe
  : describe.skip;

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function withScratchPostgres(
  callback: (psql: (sql: string) => string) => void,
): void {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test invoked without server binaries");
  }
  const root = mkdtempSync(join(tmpdir(), "qep-829-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(25000 + Math.floor(Math.random() * 10000));

  try {
    mkdirSync(socketDir);
    run(initdbPath, ["-D", dataDir, "--auth=trust", "--username=postgres"]);
    run(pgCtlPath, [
      "-D",
      dataDir,
      "-o",
      `-F -k ${socketDir} -p ${port} -c listen_addresses=''`,
      "-l",
      logPath,
      "start",
    ]);
    const psql = (sql: string): string => {
      const queryPath = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(queryPath, sql);
      return run(psqlPath, [
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
        "-h",
        socketDir,
        "-p",
        port,
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-f",
        queryPath,
      ]);
    };
    callback(psql);
  } finally {
    if (existsSync(dataDir)) {
      spawnSync(pgCtlPath, ["-D", dataDir, "-m", "fast", "stop"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const schema = String.raw`
create schema auth;
create extension pgcrypto;
create role anon;
create role authenticated;
create role service_role;

create type public.user_role as enum ('rep', 'admin', 'manager', 'owner');
create type public.service_source_type as enum ('call', 'walk_in', 'field_tech', 'sales_handoff', 'portal');
create type public.service_request_type as enum ('repair', 'pm_service', 'inspection', 'machine_down', 'recall', 'warranty');
create type public.service_priority as enum ('normal', 'urgent', 'critical');
create type public.service_stage as enum (
  'request_received', 'triaging', 'diagnosis_selected', 'quote_drafted',
  'quote_sent', 'approved', 'parts_pending', 'parts_staged', 'haul_scheduled',
  'scheduled', 'in_progress', 'blocked_waiting', 'quality_check',
  'ready_for_pickup', 'invoice_ready', 'invoiced', 'paid_closed'
);
create type public.service_status_flag as enum (
  'machine_down', 'shop_job', 'field_job', 'internal', 'warranty_recall',
  'customer_pay', 'good_faith', 'waiting_customer', 'waiting_vendor',
  'waiting_transfer', 'waiting_haul'
);
create type public.meter_reading_code as enum ('actual', 'estimate', 'tampered', 'replaced');

create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function public.get_my_workspace() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.workspace_id', true), ''), 'default')
$$;
create function public.get_my_role() returns public.user_role language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.qep_role', true), ''), 'rep')::public.user_role
$$;

create table public.profiles (
  id uuid primary key,
  role public.user_role not null default 'rep'
);

create table public.qrm_companies (
  id uuid primary key,
  workspace_id text not null,
  deleted_at timestamptz
);

create table public.qrm_equipment (
  id uuid primary key,
  workspace_id text not null,
  company_id uuid not null references public.qrm_companies(id),
  home_branch_id uuid,
  name text not null,
  make text,
  model text,
  serial_number text,
  deleted_at timestamptz
);

create table public.service_agreement_programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  program_code text not null,
  name text not null,
  sponsor text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, program_code)
);

create table public.service_agreements (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  contract_number text not null,
  status text not null default 'active',
  customer_id uuid references public.qrm_companies(id),
  equipment_id uuid references public.qrm_equipment(id),
  program_name text not null,
  program_id uuid references public.service_agreement_programs(id),
  starts_on date,
  expires_on date,
  included_pm_services integer,
  deleted_at timestamptz,
  unique (workspace_id, contract_number)
);

create table public.equipment_meter_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  equipment_id uuid not null references public.qrm_equipment(id),
  meter_index integer not null default 1,
  hours numeric(10, 1) not null,
  code public.meter_reading_code not null default 'actual',
  recorded_at date not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  customer_id uuid references public.qrm_companies(id),
  machine_id uuid references public.qrm_equipment(id),
  source_type public.service_source_type not null default 'call',
  request_type public.service_request_type not null default 'repair',
  priority public.service_priority not null default 'normal',
  current_stage public.service_stage not null default 'request_received',
  status_flags public.service_status_flag[] not null default '{}',
  branch_id text,
  advisor_id uuid references public.profiles(id),
  technician_id uuid references public.profiles(id),
  requested_by_name text,
  customer_problem_summary text,
  shop_or_field text not null default 'shop',
  tracking_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz
);

create table public.service_job_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  job_id uuid not null references public.service_jobs(id),
  event_type text not null,
  actor_id uuid references public.profiles(id),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.qep_roadmap_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  ship_state text,
  blocking_decision text,
  evidence_link text,
  notes text,
  updated_at timestamptz not null default now()
);
insert into public.qep_roadmap_tasks (task_id, ship_state) values ('H9.1', 'in_progress');

create table public.qep_roadmap_sync_events (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  task_id text not null,
  action text not null,
  changed_fields jsonb not null,
  actor text not null,
  created_at timestamptz not null default now()
);
`;

postgresBehavior("829 service-plan SQL behavior", () => {
  it("compiles the full migration and keeps draft catalog rows behind a two-step gate", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
insert into public.profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'owner');

create temp table gate_result (value text);
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
  from public.service_agreement_programs
  where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250';

  begin
    update public.service_agreement_programs
    set is_provisional = false,
        review_status = 'reviewed',
        reviewed_by = '00000000-0000-4000-8000-000000000001',
        reviewed_at = now(),
        review_notes = 'attempted one-write bypass',
        is_active = true,
        activated_by = '00000000-0000-4000-8000-000000000001',
        activated_at = now()
    where id = v_program_id;
    insert into gate_result values ('bypass_allowed');
  exception when check_violation then
    insert into gate_result values ('bypass_blocked');
  end;
end $$;

select 'drafts=' || count(*)
from public.service_agreement_programs
where workspace_id = 'default'
  and program_code like 'BR-DRAFT-%'
  and is_provisional
  and review_status = 'draft'
  and not is_active;
select value from gate_result;
select 'roadmap=' || ship_state from public.qep_roadmap_tasks where task_id = 'H9.1';
select 'auth_insert=' || has_table_privilege('authenticated', 'public.service_agreement_entitlement_ledger', 'INSERT');
select 'auth_select=' || has_table_privilege('authenticated', 'public.service_agreement_entitlement_ledger', 'SELECT');
select 'service_insert=' || has_table_privilege('service_role', 'public.service_agreement_entitlement_ledger', 'INSERT');
select 'service_select=' || has_table_privilege('service_role', 'public.service_agreement_entitlement_ledger', 'SELECT');
`);
      expect(output).toContain("drafts=3");
      expect(output).toContain("bypass_blocked");
      expect(output).toContain("roadmap=in_progress");
      expect(output).toContain("auth_insert=false");
      expect(output).toContain("auth_select=true");
      expect(output).toContain("service_insert=false");
      expect(output).toContain("service_select=true");
    });
  });

  it("creates one hour-due job, records the prompt, and consumes without overdraft", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
insert into public.profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'owner');
insert into public.qrm_companies values
  ('10000000-0000-4000-8000-000000000001', 'default', null);
insert into public.qrm_equipment
  (id, workspace_id, company_id, name, make, model, serial_number, deleted_at)
values
  ('20000000-0000-4000-8000-000000000001', 'default',
   '10000000-0000-4000-8000-000000000001', 'Excavator One', 'Yanmar', 'SV100', 'SER-1', null);

select public.service_plan_review_program(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '00000000-0000-4000-8000-000000000001',
  'QEP test review of cadence only'
);
select public.service_plan_set_program_activation(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  true,
  '00000000-0000-4000-8000-000000000001'
);

insert into public.service_agreements (
  id, workspace_id, contract_number, status, customer_id, equipment_id,
  program_name, program_id, starts_on, expires_on, included_pm_services
) values (
  '30000000-0000-4000-8000-000000000001', 'default', 'AGR-1', 'active',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'BlackRock Draft 250',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '2026-01-01', '2027-12-31', 2
);
insert into public.equipment_meter_readings
  (workspace_id, equipment_id, hours, recorded_at)
values
  ('default', '20000000-0000-4000-8000-000000000001', 100, '2026-01-01'),
  ('default', '20000000-0000-4000-8000-000000000001', 360, '2026-02-01');

select public.service_plan_enroll_equipment(
  'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
  '00000000-0000-4000-8000-000000000001'
);
select public.run_service_plan_pm_daily_scan('2026-02-01');
select public.run_service_plan_pm_daily_scan('2026-02-01');
select public.run_service_plan_pm_daily_scan('2026-02-02');

select 'jobs_before_close=' || count(*) from public.service_jobs;
select 'basis=' || due_basis from public.service_plan_pm_due_events;
select 'prompts=' || count(*) from public.service_plan_schedule_prompts;
select 'before=' || available_quantity || ':' || reserved_quantity || ':' || consumed_quantity
from public.service_agreement_entitlement_balances
where service_agreement_id = '30000000-0000-4000-8000-000000000001';

update public.service_jobs
set current_stage = 'paid_closed', closed_at = '2026-02-02T12:00:00Z'
where service_plan_due_event_id is not null;

select 'after=' || available_quantity || ':' || reserved_quantity || ':' || consumed_quantity
from public.service_agreement_entitlement_balances
where service_agreement_id = '30000000-0000-4000-8000-000000000001';
select 'next=' || cycle_number || ':' || next_due_hours
from public.service_plan_enrollment_schedules;

create temp table invariant_result (value text);
do $$
begin
  begin
    insert into public.service_agreement_entitlement_ledger (
      workspace_id, service_agreement_id, entry_type, unit_code, quantity,
      idempotency_key, reason
    ) values (
      'default', '30000000-0000-4000-8000-000000000001', 'reserve',
      'pm_service', 2, 'overdraft-attempt', 'must fail'
    );
    insert into invariant_result values ('overdraft_allowed');
  exception when check_violation then
    insert into invariant_result values ('overdraft_blocked');
  end;

  begin
    update public.service_agreement_entitlement_ledger
    set reason = 'mutation attempt'
    where service_agreement_id = '30000000-0000-4000-8000-000000000001';
    insert into invariant_result values ('mutation_allowed');
  exception when object_not_in_prerequisite_state then
    insert into invariant_result values ('mutation_blocked');
  end;
end $$;
select value from invariant_result order by value;
`);
      expect(output).toContain("jobs_before_close=1");
      expect(output).toContain("basis=hours");
      expect(output).toContain("prompts=1");
      expect(output).toContain("before=1.00:1.00:0.00");
      expect(output).toContain("after=1.00:0.00:1.00");
      expect(output).toContain("next=2:610.0");
      expect(output).toContain("overdraft_blocked");
      expect(output).toContain("mutation_blocked");
    });
  });

  it("fires from calendar time when hours have not reached the threshold", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
insert into public.profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'owner');
insert into public.qrm_companies values
  ('10000000-0000-4000-8000-000000000001', 'default', null);
insert into public.qrm_equipment
  (id, workspace_id, company_id, name, deleted_at)
values
  ('20000000-0000-4000-8000-000000000001', 'default',
   '10000000-0000-4000-8000-000000000001', 'Loader One', null);

select public.service_plan_review_program(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '00000000-0000-4000-8000-000000000001',
  'QEP test review of cadence only'
);
select public.service_plan_set_program_activation(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  true,
  '00000000-0000-4000-8000-000000000001'
);
insert into public.service_agreements (
  id, workspace_id, contract_number, status, customer_id, equipment_id,
  program_name, program_id, starts_on, expires_on, included_pm_services
) values (
  '30000000-0000-4000-8000-000000000001', 'default', 'AGR-CALENDAR', 'active',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'BlackRock Draft 250',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '2026-01-01', '2027-12-31', 1
);
insert into public.equipment_meter_readings
  (workspace_id, equipment_id, hours, recorded_at)
values ('default', '20000000-0000-4000-8000-000000000001', 100, '2026-01-01');
select public.service_plan_enroll_equipment(
  'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
  '00000000-0000-4000-8000-000000000001'
);
select public.run_service_plan_pm_daily_scan('2026-07-01');
select 'calendar_basis=' || due_basis from public.service_plan_pm_due_events;
select 'calendar_jobs=' || count(*) from public.service_jobs;
`);
      expect(output).toContain("calendar_basis=calendar");
      expect(output).toContain("calendar_jobs=1");
    });
  });

  it("drains a due backlog through deterministic bounded resumable batches", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
insert into public.profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'owner');

select public.service_plan_review_program(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '00000000-0000-4000-8000-000000000001',
  'QEP bounded scanner behavior review'
);
select public.service_plan_set_program_activation(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  true,
  '00000000-0000-4000-8000-000000000001'
);

create temp table batch_fixture as
select
  sequence_number,
  gen_random_uuid() as company_id,
  gen_random_uuid() as equipment_id,
  gen_random_uuid() as agreement_id
from generate_series(1, 3) sequence_number;

insert into public.qrm_companies (id, workspace_id, deleted_at)
select company_id, 'default', null from batch_fixture;

insert into public.qrm_equipment (
  id, workspace_id, company_id, name, make, model, serial_number, deleted_at
)
select
  equipment_id,
  'default',
  company_id,
  'Bounded PM machine ' || sequence_number,
  'Yanmar',
  'SV100',
  'BATCH-' || sequence_number,
  null
from batch_fixture;

insert into public.service_agreements (
  id, workspace_id, contract_number, status, customer_id, equipment_id,
  program_name, program_id, starts_on, expires_on, included_pm_services
)
select
  agreement_id,
  'default',
  'AGR-BATCH-' || sequence_number,
  'active',
  company_id,
  equipment_id,
  'BlackRock Draft 250',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '2026-01-01',
  '2027-12-31',
  1
from batch_fixture;

insert into public.equipment_meter_readings (
  workspace_id, equipment_id, meter_index, hours, code, recorded_at
)
select 'default', equipment_id, 1, 100, 'actual', '2026-01-01'
from batch_fixture;

select (public.service_plan_enroll_equipment(
  'default', agreement_id, '2026-01-01', null,
  '00000000-0000-4000-8000-000000000001'
)).id
from batch_fixture
order by sequence_number;

select 'batch_1=' || (result->>'status')
  || ':' || (result->>'batch_claimed_count')
  || ':' || (result->>'due_count')
  || ':' || (result->>'needs_follow_up')
from (
  select public.service_plan_scan_due_pm_internal('default', '2026-07-01', 2) as result
) scan;
select 'after_batch_1=' || count(*) from public.service_jobs;

select 'batch_2=' || (result->>'status')
  || ':' || (result->>'batch_claimed_count')
  || ':' || (result->>'due_count')
  || ':' || (result->>'needs_follow_up')
from (
  select public.service_plan_scan_due_pm_internal('default', '2026-07-01', 2) as result
) scan;
select 'after_batch_2=' || count(*) from public.service_jobs;

select 'batch_3=' || (result->>'status')
  || ':' || (result->>'batch_claimed_count')
  || ':' || (result->>'due_count')
  || ':' || (result->>'needs_follow_up')
from (
  select public.service_plan_scan_due_pm_internal('default', '2026-07-01', 2) as result
) scan;

select 'dedup_retry=' || (result->>'deduplicated')
  || ':' || (result->>'batch_claimed_count')
from (
  select public.service_plan_scan_due_pm_internal('default', '2026-07-01', 2) as result
) scan;

select 'scan_run=' || status || ':' || due_count || ':' || job_count || ':' || batch_count
from public.service_plan_pm_scan_runs
where workspace_id = 'default' and scan_date = '2026-07-01';
select 'due_events=' || count(*) from public.service_plan_pm_due_events;
select 'prompts=' || count(*) from public.service_plan_schedule_prompts;
select 'open_events=' || count(*)
from public.service_plan_pm_due_events
where status = 'job_created';
`);
      expect(output).toContain("batch_1=running:2:2:true");
      expect(output).toContain("after_batch_1=2");
      expect(output).toContain("batch_2=running:1:3:true");
      expect(output).toContain("after_batch_2=3");
      expect(output).toContain("batch_3=completed:0:3:false");
      expect(output).toContain("dedup_retry=true:0");
      expect(output).toContain("scan_run=completed:3:3:3");
      expect(output).toContain("due_events=3");
      expect(output).toContain("prompts=3");
      expect(output).toContain("open_events=3");
    });
  });

  it("keeps a scan resumable when SKIP LOCKED temporarily hides a due schedule", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
create extension dblink;
insert into public.profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'owner');
insert into public.qrm_companies values
  ('10000000-0000-4000-8000-000000000001', 'default', null);
insert into public.qrm_equipment
  (id, workspace_id, company_id, name, deleted_at)
values
  ('20000000-0000-4000-8000-000000000001', 'default',
   '10000000-0000-4000-8000-000000000001', 'Locked PM machine', null);

select public.service_plan_review_program(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '00000000-0000-4000-8000-000000000001',
  'QEP lock-aware scanner behavior review'
);
select public.service_plan_set_program_activation(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  true,
  '00000000-0000-4000-8000-000000000001'
);
insert into public.service_agreements (
  id, workspace_id, contract_number, status, customer_id, equipment_id,
  program_name, program_id, starts_on, expires_on, included_pm_services
) values (
  '30000000-0000-4000-8000-000000000001', 'default', 'AGR-LOCKED', 'active',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'BlackRock Draft 250',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '2026-01-01', '2027-12-31', 1
);
insert into public.equipment_meter_readings
  (workspace_id, equipment_id, meter_index, hours, code, recorded_at)
values
  ('default', '20000000-0000-4000-8000-000000000001', 1, 100, 'actual', '2026-01-01');
select public.service_plan_enroll_equipment(
  'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
  '00000000-0000-4000-8000-000000000001'
);

select dblink_connect(
  'pm_locker',
  format(
    'host=%s port=%s dbname=%s user=%s',
    current_setting('unix_socket_directories'),
    current_setting('port'),
    current_database(),
    current_user
  )
);
select dblink_exec('pm_locker', 'begin');
select dblink_open(
  'pm_locker',
  'locked_schedule',
  'select id from public.service_plan_enrollment_schedules where workspace_id = ''default'' for update'
);
select id
from dblink_fetch('pm_locker', 'locked_schedule', 1) as locked_row(id uuid);

select 'locked_pass=' || (result->>'status')
  || ':' || (result->>'batch_claimed_count')
  || ':' || (result->>'needs_follow_up')
from (
  select public.service_plan_scan_due_pm_internal('default', '2026-07-01', 1) as result
) scan;
select 'locked_jobs=' || count(*) from public.service_jobs;
select 'locked_run=' || status from public.service_plan_pm_scan_runs;

select dblink_close('pm_locker', 'locked_schedule');
select dblink_exec('pm_locker', 'commit');
select dblink_disconnect('pm_locker');

select 'released_pass=' || (result->>'status')
  || ':' || (result->>'batch_claimed_count')
  || ':' || (result->>'due_count')
from (
  select public.service_plan_scan_due_pm_internal('default', '2026-07-01', 1) as result
) scan;
select 'completion_pass=' || (result->>'status')
  || ':' || (result->>'batch_claimed_count')
  || ':' || (result->>'needs_follow_up')
from (
  select public.service_plan_scan_due_pm_internal('default', '2026-07-01', 1) as result
) scan;
select 'released_jobs=' || count(*) from public.service_jobs;
select 'released_events=' || count(*) from public.service_plan_pm_due_events;
select 'released_run=' || status || ':' || batch_count
from public.service_plan_pm_scan_runs;
`);
      expect(output).toContain("locked_pass=running:0:true");
      expect(output).toContain("locked_jobs=0");
      expect(output).toContain("locked_run=running");
      expect(output).toContain("released_pass=running:1:1");
      expect(output).toContain("completion_pass=completed:0:false");
      expect(output).toContain("released_jobs=1");
      expect(output).toContain("released_events=1");
      expect(output).toContain("released_run=completed:3");
    });
  });

  it("makes entitlement retries source-semantic and rejects conflicting payloads", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
insert into public.service_agreements (
  id, workspace_id, contract_number, status, program_name, included_pm_services
) values (
  '30000000-0000-4000-8000-000000000001', 'default', 'AGR-RETRY',
  'active', 'Retry fixture', 1
);

create temp table retry_ids (label text primary key, entry_id uuid not null);
insert into retry_ids values (
  'grant_first',
  (public.service_plan_post_entitlement(
    'default', '30000000-0000-4000-8000-000000000001', 'grant',
    'pm_service', 1, 'manual-grant', 'Manual grant', null,
    null, null, null, '{"source":"retry-test"}'::jsonb
  )).id
);
insert into retry_ids values (
  'grant_retry',
  (public.service_plan_post_entitlement(
    'default', '30000000-0000-4000-8000-000000000001', 'grant',
    'pm_service', 1, 'manual-grant', 'Manual grant', null,
    null, null, null, '{"source":"retry-test"}'::jsonb
  )).id
);
insert into retry_ids values (
  'reserve_first',
  (public.service_plan_post_entitlement(
    'default', '30000000-0000-4000-8000-000000000001', 'reserve',
    'pm_service', 1, 'manual-reserve', 'Manual reserve', null
  )).id
);
insert into retry_ids values (
  'reserve_retry',
  (public.service_plan_post_entitlement(
    'default', '30000000-0000-4000-8000-000000000001', 'reserve',
    'pm_service', 1, 'manual-reserve', 'Manual reserve', null
  )).id
);

create temp table retry_results (value text);
do $$
begin
  begin
    perform public.service_plan_post_entitlement(
      'default', '30000000-0000-4000-8000-000000000001', 'reserve',
      'pm_service', 2, 'manual-reserve', 'Manual reserve', null
    );
    insert into retry_results values ('conflict_allowed');
  exception when check_violation then
    insert into retry_results values ('conflict_blocked');
  end;
end $$;

insert into retry_ids values (
  'release_first',
  (public.service_plan_post_entitlement(
    'default', '30000000-0000-4000-8000-000000000001', 'release',
    'pm_service', 1, 'manual-release', 'Manual release', null,
    null, null,
    (select id from public.service_agreement_entitlement_ledger where idempotency_key = 'manual-reserve')
  )).id
);
insert into retry_ids values (
  'release_retry',
  (public.service_plan_post_entitlement(
    'default', '30000000-0000-4000-8000-000000000001', 'release',
    'pm_service', 1, 'manual-release', 'Manual release', null,
    null, null,
    (select id from public.service_agreement_entitlement_ledger where idempotency_key = 'manual-reserve')
  )).id
);

select 'grant_same=' || (
  (select entry_id from retry_ids where label = 'grant_first') =
  (select entry_id from retry_ids where label = 'grant_retry')
);
select 'reserve_same=' || (
  (select entry_id from retry_ids where label = 'reserve_first') =
  (select entry_id from retry_ids where label = 'reserve_retry')
);
select 'release_same=' || (
  (select entry_id from retry_ids where label = 'release_first') =
  (select entry_id from retry_ids where label = 'release_retry')
);
select value from retry_results;
select 'ledger_rows=' || count(*) from public.service_agreement_entitlement_ledger;
select 'retry_balance=' || available_quantity || ':' || reserved_quantity
from public.service_agreement_entitlement_balances
where service_agreement_id = '30000000-0000-4000-8000-000000000001';
`);
      expect(output).toContain("grant_same=true");
      expect(output).toContain("reserve_same=true");
      expect(output).toContain("release_same=true");
      expect(output).toContain("conflict_blocked");
      expect(output).toContain("ledger_rows=3");
      expect(output).toContain("retry_balance=1.00:0.00");
    });
  });

  it("cancels generated PM work atomically, releases entitlement, and permits a replacement cycle", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
insert into public.profiles (id, role)
values ('00000000-0000-4000-8000-000000000001', 'owner');
insert into public.qrm_companies values
  ('10000000-0000-4000-8000-000000000001', 'default', null);
insert into public.qrm_equipment
  (id, workspace_id, company_id, name, deleted_at)
values
  ('20000000-0000-4000-8000-000000000001', 'default',
   '10000000-0000-4000-8000-000000000001', 'Cancellation Loader', null);

select public.service_plan_review_program(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '00000000-0000-4000-8000-000000000001',
  'QEP cancellation behavior review'
);
select public.service_plan_set_program_activation(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  true,
  '00000000-0000-4000-8000-000000000001'
);
insert into public.service_agreements (
  id, workspace_id, contract_number, status, customer_id, equipment_id,
  program_name, program_id, starts_on, expires_on, included_pm_services
) values (
  '30000000-0000-4000-8000-000000000001', 'default', 'AGR-CANCEL', 'active',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'BlackRock Draft 250',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '2026-01-01', '2027-12-31', 1
);
insert into public.equipment_meter_readings
  (workspace_id, equipment_id, meter_index, hours, code, recorded_at)
values
  ('default', '20000000-0000-4000-8000-000000000001', 1, 100, 'actual', '2026-01-01'),
  ('default', '20000000-0000-4000-8000-000000000001', 1, 360, 'actual', '2026-02-01');
select public.service_plan_enroll_equipment(
  'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
  '00000000-0000-4000-8000-000000000001'
);
select public.run_service_plan_pm_daily_scan('2026-02-01');

create temp table cancel_results (value text);
do $$
begin
  begin
    update public.service_jobs
    set deleted_at = now()
    where service_plan_due_event_id is not null;
    insert into cancel_results values ('direct_delete_allowed');
  exception when check_violation then
    insert into cancel_results values ('direct_delete_blocked');
  end;

  begin
    perform public.service_plan_post_entitlement(
      'default',
      '30000000-0000-4000-8000-000000000001',
      'release',
      'pm_service',
      1,
      'manual-pm-release',
      'must use controlled cancellation',
      '00000000-0000-4000-8000-000000000001',
      (select enrollment_id from public.service_plan_pm_due_events where status = 'job_created'),
      (select service_job_id from public.service_plan_pm_due_events where status = 'job_created'),
      (select entitlement_reservation_entry_id from public.service_plan_pm_due_events where status = 'job_created')
    );
    insert into cancel_results values ('manual_pm_release_allowed');
  exception when check_violation then
    insert into cancel_results values ('manual_pm_release_blocked');
  end;
end $$;

select public.service_plan_cancel_pm_due_event(
  'default',
  (select id from public.service_plan_pm_due_events where status = 'job_created'),
  'abandoned',
  'Customer rescheduled after generated work was abandoned',
  '00000000-0000-4000-8000-000000000001'
);
select public.service_plan_cancel_pm_due_event(
  'default',
  (select id from public.service_plan_pm_due_events where status = 'cancelled'),
  'abandoned',
  'Customer rescheduled after generated work was abandoned',
  '00000000-0000-4000-8000-000000000001'
);

select value from cancel_results;
select 'cancelled=' || count(*) from public.service_plan_pm_due_events where status = 'cancelled';
select 'deleted_jobs=' || count(*) from public.service_jobs where deleted_at is not null;
select 'cancel_events=' || count(*) from public.service_job_events where event_type = 'pm_service_plan_cycle_cancelled';
select 'release_rows=' || count(*) from public.service_agreement_entitlement_ledger where entry_type = 'release';
select 'after_cancel=' || available_quantity || ':' || reserved_quantity
from public.service_agreement_entitlement_balances
where service_agreement_id = '30000000-0000-4000-8000-000000000001';

select public.run_service_plan_pm_daily_scan('2026-02-02');
select 'replacement_active_jobs=' || count(*) from public.service_jobs where deleted_at is null;
select 'replacement_open_events=' || count(*) from public.service_plan_pm_due_events where status = 'job_created';
select 'after_replacement=' || available_quantity || ':' || reserved_quantity
from public.service_agreement_entitlement_balances
where service_agreement_id = '30000000-0000-4000-8000-000000000001';
`);
      expect(output).toContain("direct_delete_blocked");
      expect(output).toContain("manual_pm_release_blocked");
      expect(output).toContain("cancelled=1");
      expect(output).toContain("deleted_jobs=1");
      expect(output).toContain("cancel_events=1");
      expect(output).toContain("release_rows=1");
      expect(output).toContain("after_cancel=1.00:0.00");
      expect(output).toContain("replacement_active_jobs=1");
      expect(output).toContain("replacement_open_events=1");
      expect(output).toContain("after_replacement=0.00:1.00");
    });
  });

  it("requires a valid primary actual meter baseline and ignores invalid meter streams", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
insert into public.profiles (id, role)
values
  ('00000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', 'owner');
insert into public.qrm_companies values
  ('10000000-0000-4000-8000-000000000001', 'default', null);
insert into public.qrm_equipment
  (id, workspace_id, company_id, name, deleted_at)
values
  ('20000000-0000-4000-8000-000000000001', 'default',
   '10000000-0000-4000-8000-000000000001', 'Meter Validation Loader', null);
select public.service_plan_review_program(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '00000000-0000-4000-8000-000000000001',
  'QEP primary-meter behavior review'
);
select public.service_plan_set_program_activation(
  'default',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  true,
  '00000000-0000-4000-8000-000000000001'
);
insert into public.service_agreements (
  id, workspace_id, contract_number, status, customer_id, equipment_id,
  program_name, program_id, starts_on, expires_on, included_pm_services
) values (
  '30000000-0000-4000-8000-000000000001', 'default', 'AGR-METER', 'active',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'BlackRock Draft 250',
  (select id from public.service_agreement_programs where workspace_id = 'default' and program_code = 'BR-DRAFT-PM-250'),
  '2026-01-01', '2027-12-31', 1
);

create temp table meter_results (value text);
do $$
begin
  begin
    perform public.service_plan_enroll_equipment(
      'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
      '00000000-0000-4000-8000-000000000001'
    );
    insert into meter_results values ('missing_baseline_allowed');
  exception when check_violation then
    insert into meter_results values ('missing_baseline_blocked');
  end;
end $$;

insert into public.equipment_meter_readings
  (workspace_id, equipment_id, meter_index, hours, code, recorded_at)
values
  ('default', '20000000-0000-4000-8000-000000000001', 2, 1000, 'actual', '2026-01-01'),
  ('default', '20000000-0000-4000-8000-000000000001', 1, 1000, 'estimate', '2026-01-01');
do $$
begin
  begin
    perform public.service_plan_enroll_equipment(
      'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
      '00000000-0000-4000-8000-000000000001'
    );
    insert into meter_results values ('invalid_baseline_allowed');
  exception when check_violation then
    insert into meter_results values ('invalid_baseline_blocked');
  end;
end $$;

insert into public.equipment_meter_readings
  (workspace_id, equipment_id, meter_index, hours, code, recorded_at)
values ('default', '20000000-0000-4000-8000-000000000001', 1, 100, 'actual', '2026-01-01');
select public.service_plan_enroll_equipment(
  'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
  '00000000-0000-4000-8000-000000000001'
);
select 'initial_hour_due=' || next_due_hours from public.service_plan_enrollment_schedules;
create temp table enrollment_retry_ids (kind text primary key, enrollment_id uuid not null);
insert into enrollment_retry_ids
select 'original', id from public.service_plan_equipment_enrollments;
insert into enrollment_retry_ids values (
  'exact_retry',
  (public.service_plan_enroll_equipment(
    'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
    '00000000-0000-4000-8000-000000000001'
  )).id
);
do $$
begin
  begin
    perform public.service_plan_enroll_equipment(
      'default', '30000000-0000-4000-8000-000000000001', '2026-01-02', null,
      '00000000-0000-4000-8000-000000000001'
    );
    insert into meter_results values ('date_conflict_allowed');
  exception when check_violation then
    insert into meter_results values ('date_conflict_blocked');
  end;

  begin
    perform public.service_plan_enroll_equipment(
      'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', 100,
      '00000000-0000-4000-8000-000000000001'
    );
    insert into meter_results values ('baseline_conflict_allowed');
  exception when check_violation then
    insert into meter_results values ('baseline_conflict_blocked');
  end;

  begin
    perform public.service_plan_enroll_equipment(
      'default', '30000000-0000-4000-8000-000000000001', '2026-01-01', null,
      '00000000-0000-4000-8000-000000000002'
    );
    insert into meter_results values ('actor_conflict_allowed');
  exception when check_violation then
    insert into meter_results values ('actor_conflict_blocked');
  end;
end $$;
select 'enrollment_retry_same=' || (
  (select enrollment_id from enrollment_retry_ids where kind = 'original') =
  (select enrollment_id from enrollment_retry_ids where kind = 'exact_retry')
);
select 'enrollment_rows=' || count(*) from public.service_plan_equipment_enrollments;
select 'schedule_rows=' || count(*) from public.service_plan_enrollment_schedules;
select 'grant_rows=' || count(*) from public.service_agreement_entitlement_ledger where entry_type = 'grant';
select 'baseline_evidence=' || baseline_source || ':' || (requested_baseline_hours is null) || ':' || (baseline_meter_reading_id is not null)
from public.service_plan_equipment_enrollments;

insert into public.equipment_meter_readings
  (workspace_id, equipment_id, meter_index, hours, code, recorded_at)
values
  ('default', '20000000-0000-4000-8000-000000000001', 2, 1500, 'actual', '2026-02-01'),
  ('default', '20000000-0000-4000-8000-000000000001', 1, 1500, 'tampered', '2026-02-01');
select public.run_service_plan_pm_daily_scan('2026-02-01');
select 'jobs_from_invalid_meters=' || count(*) from public.service_jobs;

insert into public.equipment_meter_readings
  (workspace_id, equipment_id, meter_index, hours, code, recorded_at)
values ('default', '20000000-0000-4000-8000-000000000001', 1, 360, 'actual', '2026-02-02');
select public.run_service_plan_pm_daily_scan('2026-02-02');
select 'jobs_from_primary_actual=' || count(*) from public.service_jobs;
select 'primary_basis=' || due_basis from public.service_plan_pm_due_events;
select value from meter_results order by value;
`);
      expect(output).toContain("missing_baseline_blocked");
      expect(output).toContain("invalid_baseline_blocked");
      expect(output).toContain("initial_hour_due=350.0");
      expect(output).toContain("enrollment_retry_same=true");
      expect(output).toContain("date_conflict_blocked");
      expect(output).toContain("baseline_conflict_blocked");
      expect(output).toContain("actor_conflict_blocked");
      expect(output).toContain("enrollment_rows=1");
      expect(output).toContain("schedule_rows=1");
      expect(output).toContain("grant_rows=1");
      expect(output).toContain(
        "baseline_evidence=primary_actual_meter:true:true",
      );
      expect(output).toContain("jobs_from_invalid_meters=0");
      expect(output).toContain("jobs_from_primary_actual=1");
      expect(output).toContain("primary_basis=hours");
    });
  });
});
