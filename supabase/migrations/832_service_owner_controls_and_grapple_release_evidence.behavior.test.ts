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
    "supabase/migrations/832_service_owner_controls_and_grapple_release_evidence.sql",
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
  const root = mkdtempSync(join(tmpdir(), "qep-832-"));
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
grant usage on schema public, auth to anon, authenticated, service_role;

create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function public.get_my_workspace() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.workspace_id', true), ''), 'default')
$$;
create function public.get_my_role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.qep_role', true), ''), 'rep')
$$;

create table public.profiles (
  id uuid primary key,
  role text not null,
  is_active boolean not null default true
);
create table public.profile_workspaces (
  profile_id uuid not null references public.profiles(id),
  workspace_id text not null,
  primary key (profile_id, workspace_id)
);
create table public.branches (
  id uuid primary key,
  workspace_id text not null,
  deleted_at timestamptz
);
create table public.service_job_blockers (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  job_id uuid not null,
  blocker_type text not null,
  description text,
  created_by uuid,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  hold_duration_seconds bigint
);
alter table public.service_job_blockers
  add constraint service_job_blockers_hold_state_chk check (blocker_type <> '');

create table public.traffic_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  driver_id uuid references public.profiles(id),
  mileage_one_way numeric(10, 2),
  round_trip_miles numeric(10, 2),
  mileage_source text not null default 'manual',
  mileage_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  field_mileage_miles numeric(10, 2),
  field_mileage_source text not null default 'manual',
  field_mileage_recorded_at timestamptz,
  field_mileage_provider text,
  field_mileage_metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz
);
create table public.grapple_builds (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  production_stage text not null default 'intake',
  status text not null default 'active',
  deleted_at timestamptz
);
create table public.grapple_build_final_qc_checklists (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  build_id uuid not null references public.grapple_builds(id),
  status text not null,
  overall_result text,
  lead_signed_at timestamptz,
  deleted_at timestamptz
);
create table public.qep_roadmap_tasks (
  task_id text primary key,
  evidence_link text,
  notes text,
  updated_at timestamptz
);
insert into public.qep_roadmap_tasks (task_id)
values ('H4.1'), ('H7.1'), ('H15.1'), ('I6.1');
create table public.qep_roadmap_sync_events (
  direction text not null,
  task_id text not null,
  action text not null,
  changed_fields jsonb not null,
  actor text not null
);

grant all on public.traffic_tickets, public.service_jobs, public.grapple_builds,
  public.grapple_build_final_qc_checklists to authenticated, service_role;
`;

const manager1 = "00000000-0000-4000-8000-000000000001";
const manager2 = "00000000-0000-4000-8000-000000000002";
const driver1 = "00000000-0000-4000-8000-000000000011";
const driver2 = "00000000-0000-4000-8000-000000000012";
const inactiveRecorder = "00000000-0000-4000-8000-000000000013";
const outsider = "00000000-0000-4000-8000-000000000014";
const branch = "10000000-0000-4000-8000-000000000001";
const otherBranch = "10000000-0000-4000-8000-000000000002";

const actorsAndBranch = String.raw`
insert into public.profiles (id, role, is_active) values
  ('${manager1}', 'manager', true),
  ('${manager2}', 'manager', true),
  ('${driver1}', 'rep', true),
  ('${driver2}', 'rep', true),
  ('${inactiveRecorder}', 'manager', false),
  ('${outsider}', 'rep', true);
insert into public.profile_workspaces (profile_id, workspace_id) values
  ('${manager1}', 'default'),
  ('${manager2}', 'default'),
  ('${driver1}', 'default'),
  ('${driver2}', 'default'),
  ('${inactiveRecorder}', 'default'),
  ('${outsider}', 'other');
insert into public.branches (id, workspace_id) values
  ('${branch}', 'default'),
  ('${otherBranch}', 'other');
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '${manager1}', false);
select set_config('request.jwt.claim.workspace_id', 'default', false);
select set_config('request.jwt.claim.qep_role', 'manager', false);
`;

postgresBehavior("832 service owner control behavior", () => {
  it("binds verifier and recorder provenance and derives driver reassignment", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
${actorsAndBranch}
create temp table results (value text);

do $$
begin
  begin
    insert into public.service_driver_profiles (
      workspace_id, profile_id, home_branch_id, is_dispatchable
    ) values ('default', '${outsider}', '${branch}', false);
  exception when others then
    if sqlerrm not like '%active member%' then raise; end if;
    insert into results values ('driver_workspace_blocked');
  end;
  begin
    insert into public.service_driver_profiles (
      workspace_id, profile_id, home_branch_id, is_dispatchable
    ) values ('default', '${driver1}', '${otherBranch}', false);
  exception when others then
    if sqlerrm not like '%home branch%' then raise; end if;
    insert into results values ('branch_workspace_blocked');
  end;
  begin
    insert into public.service_driver_profiles (
      workspace_id, profile_id, home_branch_id, is_dispatchable,
      roster_verified_by, roster_verified_at
    ) values (
      'default', '${driver1}', '${branch}', true,
      '${manager2}', '2000-01-01'
    );
  exception when others then
    if sqlerrm not like '%authenticated verifier%' then raise; end if;
    insert into results values ('verifier_spoof_blocked');
  end;
end $$;

insert into public.service_driver_profiles (
  workspace_id, profile_id, home_branch_id, is_dispatchable,
  roster_verified_by, roster_verified_at
) values
  ('default', '${driver1}', '${branch}', true, '${manager1}', '2000-01-01'),
  ('default', '${driver2}', '${branch}', true, '${manager1}', '2000-01-01');

insert into results
select 'verifier_bound=' || (roster_verified_by = '${manager1}'::uuid)
  || ':' || (roster_verified_at > now() - interval '1 minute')
from public.service_driver_profiles where profile_id = '${driver1}';

insert into public.traffic_tickets (workspace_id, driver_id, service_driver_profile_id)
select 'default', '${driver1}', id
from public.service_driver_profiles where profile_id = '${driver2}'
returning id;

update public.traffic_tickets set driver_id = '${driver2}';
insert into results
select 'reassignment_derived=' || (d.profile_id = '${driver2}'::uuid)
from public.traffic_tickets tt
join public.service_driver_profiles d on d.id = tt.service_driver_profile_id;

do $$
declare v_ticket uuid; v_driver_profile uuid;
begin
  select id, service_driver_profile_id into v_ticket, v_driver_profile
  from public.traffic_tickets limit 1;
  begin
    insert into public.service_driver_accountability_events (
      traffic_ticket_id, service_driver_profile_id, event_type, occurred_at,
      recorded_by
    ) values (v_ticket, v_driver_profile, 'departure', now(), null);
  exception when others then
    if sqlerrm not like '%active member%' then raise; end if;
    insert into results values ('null_recorder_blocked');
  end;
  begin
    insert into public.service_driver_accountability_events (
      traffic_ticket_id, service_driver_profile_id, event_type, occurred_at,
      recorded_by
    ) values (v_ticket, v_driver_profile, 'departure', now(), '${inactiveRecorder}');
  exception when others then
    if sqlerrm not like '%active member%' then raise; end if;
    insert into results values ('inactive_recorder_blocked');
  end;
  begin
    insert into public.service_driver_accountability_events (
      traffic_ticket_id, service_driver_profile_id, event_type, occurred_at,
      recorded_by
    ) values (v_ticket, v_driver_profile, 'departure', now(), '${manager2}');
  exception when others then
    if sqlerrm not like '%authenticated recorder%' then raise; end if;
    insert into results values ('recorder_spoof_blocked');
  end;
  insert into public.service_driver_accountability_events (
    traffic_ticket_id, service_driver_profile_id, event_type, occurred_at,
    recorded_by
  ) values (v_ticket, v_driver_profile, 'departure', now(), '${manager1}');
end $$;

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
insert into public.service_driver_accountability_events (
  traffic_ticket_id, service_driver_profile_id, event_type, occurred_at,
  recorded_by
)
select id, service_driver_profile_id, 'arrival', now(), '${manager2}'
from public.traffic_tickets limit 1;

insert into results
select 'event_rows=' || count(*) from public.service_driver_accountability_events;
select value from results order by value;
`);
      expect(output).toContain("verifier_spoof_blocked");
      expect(output).toContain("driver_workspace_blocked");
      expect(output).toContain("branch_workspace_blocked");
      expect(output).toContain("verifier_bound=true:true");
      expect(output).toContain("reassignment_derived=true");
      expect(output).toContain("null_recorder_blocked");
      expect(output).toContain("inactive_recorder_blocked");
      expect(output).toContain("recorder_spoof_blocked");
      expect(output).toContain("event_rows=2");
    });
  });

  it("makes manual mileage review retries exact and service-role attribution explicit", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
${actorsAndBranch}
create temp table results (value text);
insert into public.service_jobs (
  id, workspace_id, field_mileage_miles, field_mileage_source,
  field_mileage_recorded_at, field_mileage_metadata
) values (
  '20000000-0000-4000-8000-000000000001', 'default', 12.50, 'manual',
  now(), '{"entry":"advisor"}'
);

create temp table first_review as
select (public.review_manual_service_mileage(
  'default', 'service_job', '20000000-0000-4000-8000-000000000001',
  'approved', 'Manager verified mileage', 'mileage-key-1', '${manager1}'
)).*;

update public.service_jobs set field_mileage_miles = 22.50
where id = '20000000-0000-4000-8000-000000000001';

insert into results
select 'exact_retry=' || (id = (public.review_manual_service_mileage(
  'default', 'service_job', '20000000-0000-4000-8000-000000000001',
  'approved', 'Manager verified mileage', 'mileage-key-1', '${manager1}'
)).id) from first_review;

do $$ begin
  begin
    perform public.review_manual_service_mileage(
      'default', 'service_job', '20000000-0000-4000-8000-000000000001',
      'approved', 'A different review note', 'mileage-key-1', '${manager1}'
    );
  exception when others then
    if sqlerrm not like '%different review%' then raise; end if;
    insert into results values ('note_conflict_blocked');
  end;
end $$;

do $$ begin
  begin
    perform public.review_manual_service_mileage(
      'default', 'service_job', '20000000-0000-4000-8000-000000000001',
      'approved', 'Manager verified mileage', 'mileage-key-1', '${manager2}'
    );
  exception when others then
    if sqlerrm not like '%authenticated reviewer%' then raise; end if;
    insert into results values ('authenticated_reviewer_spoof_blocked');
  end;
end $$;

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin
    perform public.review_manual_service_mileage(
      'default', 'service_job', '20000000-0000-4000-8000-000000000001',
      'approved', 'Manager verified mileage', 'mileage-key-1', '${manager2}'
    );
  exception when others then
    if sqlerrm not like '%different review%' then raise; end if;
    insert into results values ('service_reviewer_conflict_blocked');
  end;
end $$;

select (public.review_manual_service_mileage(
  'default', 'service_job', '20000000-0000-4000-8000-000000000001',
  'rejected', 'Second manager reviewed new mileage', 'mileage-key-2', '${manager2}'
)).id;

do $$ begin
  begin
    perform public.review_manual_service_mileage(
      'default', 'service_job', '20000000-0000-4000-8000-000000000001',
      'approved', 'Missing reviewer should fail', 'mileage-key-3', null
    );
  exception when others then
    if sqlerrm not like '%active manager%' then raise; end if;
    insert into results values ('service_null_reviewer_blocked');
  end;
end $$;

insert into results
select 'review_rows=' || count(*) from public.service_manual_mileage_reviews;
insert into results
select 'first_mileage=' || mileage::text from first_review;
insert into results
select 'service_reviewer=' || (reviewed_by = '${manager2}'::uuid)
from public.service_manual_mileage_reviews where idempotency_key = 'mileage-key-2';
select value from results order by value;
`);
      expect(output).toContain("exact_retry=true");
      expect(output).toContain("note_conflict_blocked");
      expect(output).toContain("authenticated_reviewer_spoof_blocked");
      expect(output).toContain("service_reviewer_conflict_blocked");
      expect(output).toContain("service_null_reviewer_blocked");
      expect(output).toContain("review_rows=2");
      expect(output).toContain("first_mileage=12.50");
      expect(output).toContain("service_reviewer=true");
    });
  });

  it("enforces grapple release evidence on stage and status transitions", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(String.raw`
insert into public.profiles (id, role, is_active)
values ('${manager1}', 'manager', true);
insert into public.profile_workspaces (profile_id, workspace_id)
values ('${manager1}', 'default');
insert into public.grapple_builds (id, workspace_id, production_stage, status)
values (
  '30000000-0000-4000-8000-000000000001', 'default',
  'production_complete', 'completed'
);
insert into public.grapple_build_final_qc_checklists (
  id, workspace_id, build_id, status, overall_result, lead_signed_at
) values (
  '40000000-0000-4000-8000-000000000001', 'default',
  '30000000-0000-4000-8000-000000000001', 'signed', 'pass', now()
);
`);
      psql(migration);
      const output = psql(String.raw`
create temp table results (value text);

select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.workspace_id', 'other', false);
insert into results
select 'null_role_tenant_mask=' || (not ok and code = 'grapple_build_not_found')
from public.grapple_build_service_manager_release_gate(
  '30000000-0000-4000-8000-000000000001'
);

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.workspace_id', 'default', false);

do $$ begin
  begin
    update public.grapple_builds set status = 'active'
    where id = '30000000-0000-4000-8000-000000000001';
  exception when others then
    if sqlerrm not like '%Service Manager signoff%' then raise; end if;
    insert into results values ('legacy_status_bypass_blocked');
  end;
end $$;

insert into public.grapple_builds (id, workspace_id, production_stage, status)
values ('30000000-0000-4000-8000-000000000002', 'default', 'intake', 'active');
insert into public.grapple_build_final_qc_checklists (
  id, workspace_id, build_id, status, overall_result, lead_signed_at
) values (
  '40000000-0000-4000-8000-000000000002', 'default',
  '30000000-0000-4000-8000-000000000002', 'signed', 'pass', now()
);

do $$ begin
  begin
    perform public.record_grapple_build_service_manager_release(
      'default', '30000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002', '${manager1}',
      'build-sheet-2', '{"passed":true}', '{"serial":"S-2"}',
      '[{"path":"photo-2"}]', 'I approve this release evidence.', '   '
    );
  exception when others then
    if sqlerrm not like '%nonblank idempotency key%' then raise; end if;
    insert into results values ('blank_release_key_blocked');
  end;
end $$;

select (public.record_grapple_build_service_manager_release(
  'default', '30000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000002', '${manager1}',
  'build-sheet-2', '{"passed":true}', '{"serial":"S-2"}',
  '[{"path":"photo-2"}]', 'I approve this release evidence.', 'release-key-2'
)).id;

update public.grapple_builds
set production_stage = 'production_complete', status = 'completed'
where id = '30000000-0000-4000-8000-000000000002';

insert into results
select 'release_gate=' || ok from public.grapple_build_service_manager_release_gate(
  '30000000-0000-4000-8000-000000000002'
);
insert into results
select 'release_rows=' || count(*)
from public.grapple_build_service_manager_releases;
select value from results order by value;
`);
      expect(output).toContain("legacy_status_bypass_blocked");
      expect(output).toContain("blank_release_key_blocked");
      expect(output).toContain("null_role_tenant_mask=true");
      expect(output).toContain("release_gate=true");
      expect(output).toContain("release_rows=1");
    });
  });
});
