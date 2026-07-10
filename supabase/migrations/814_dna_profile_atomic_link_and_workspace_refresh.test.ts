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

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "814_dna_profile_atomic_link_and_workspace_refresh.sql",
);
const refreshPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "_shared",
  "customer-profile-refresh.ts",
);
const sql = readFileSync(migrationPath, "utf8");
const refreshSource = readFileSync(refreshPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(name: string): string {
  const match = sql.match(
    new RegExp(
      `create(?: or replace)? function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

describe("814 customer DNA atomic identity contract", () => {
  it("keeps resolve, create, and contact link in one service-only transaction", () => {
    const fn = functionSql("get_or_create_customer_dna_profile");
    expect(compactSql.trim().startsWith("-- migration 814")).toBe(true);
    expect(compactSql).toContain("begin;");
    expect(compactSql.trim().endsWith("commit;")).toBe(true);
    expect(fn).toContain("security definer");
    expect(fn).toContain("(select auth.role())");
    expect(fn).toContain("<> 'service_role'");
    expect(fn).toContain("insert into public.customer_profiles_extended");
    expect(fn).toContain("update public.crm_contacts");
    expect(fn).toContain("get diagnostics v_rows = row_count");
    expect(fn).not.toContain("exception when others");
    expect(compactSql).toContain(
      "revoke all on function public.get_or_create_customer_dna_profile",
    );
    expect(compactSql).toContain("from public, anon, authenticated");
    expect(compactSql).toContain("to service_role");
  });

  it("serializes before locking the contact and validates workspace anchors", () => {
    const fn = functionSql("get_or_create_customer_dna_profile");
    expect(fn.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      fn.indexOf("for update"),
    );
    expect(fn).toContain("hashtextextended");
    expect(fn).toContain("c.workspace_id = v_workspace_id");
    expect(fn).toContain("company.workspace_id = v_workspace_id");
    expect(fn).toContain("company.deleted_at is null");
    expect(fn).toContain(
      "customer dna profile and contact have conflicting company anchors",
    );
    expect(fn).toContain("select p.* into v_profile");
    expect(fn).toContain("profile hubspot identity conflicts");
    expect(fn).toContain("profile intellidealer identity conflicts");
    expect(fn).toContain(
      "companyless customer dna contacts cannot adopt company-anchored profiles",
    );
  });

  it("routes edge refresh creation/linking through the RPC", () => {
    expect(refreshSource).toContain(
      '.rpc("get_or_create_customer_dna_profile"',
    );
    expect(refreshSource).not.toContain(
      '.from("customer_profiles_extended")\n      .insert(',
    );
    expect(refreshSource).not.toContain(
      ".update({ dge_customer_profile_id: profileId })",
    );
  });

  it("tenant-binds every cross-department health alert source", () => {
    const fn = functionSql("generate_cross_department_alerts");
    expect(fn).toContain("<> 'service_role'");
    expect(fn).toContain("ci.workspace_id = v_workspace_id");
    expect(fn).toContain("pc.workspace_id = v_workspace_id");
    expect(fn).toContain("cf.workspace_id = v_workspace_id");
    expect(compactSql).toContain(
      "revoke all on function public.generate_cross_department_alerts(text) from public, anon, authenticated",
    );
  });

  it("lists health candidates through a service-only authoritative tenant resolver", () => {
    const fn = functionSql("list_customer_health_profiles_for_workspace");
    expect(fn).toContain("<> 'service_role'");
    expect(fn).toContain("company.workspace_id = v_workspace_id");
    expect(fn).toContain("contact.workspace_id = v_workspace_id");
    expect(fn).toContain("profile.crm_company_id is null");
    expect(fn).toContain("p_order not in ('score_desc', 'stale_asc')");
    expect(compactSql).toContain(
      "create index if not exists idx_customer_profiles_extended_crm_company",
    );
    expect(compactSql).toContain(
      "if v_crm_contacts_kind in ('r', 'p')",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_qrm_contacts_workspace_dna_profile_active",
    );
    expect(compactSql).toContain(
      "revoke all on function public.list_customer_health_profiles_for_workspace",
    );
  });

  it("replaces role-only profile policies with fail-closed tenant anchors", () => {
    const visibility = functionSql(
      "customer_profile_visible_in_current_workspace",
    );
    expect(compactSql).toContain(
      'drop policy if exists "customer_profiles_ext_select"',
    );
    expect(compactSql).toContain(
      'create policy "customer_profiles_ext_select_workspace"',
    );
    expect(compactSql).toContain("crm_company_id is not null");
    expect(compactSql).toContain(
      "public.customer_profile_visible_in_current_workspace(id)",
    );
    expect(visibility).toContain("profile.active_workspace_id");
    expect(visibility).toContain("where profile.id = v_user_id");
    expect(visibility).toContain("company.workspace_id = v_workspace_id");
    expect(compactSql).toContain("crm_company_id is null");
    expect(compactSql).toContain(
      "contact.workspace_id = v_workspace_id",
    );
    expect(compactSql).toContain(
      "contact_other.workspace_id <> v_workspace_id",
    );
    expect(compactSql).toContain(
      "revoke insert, update, delete, truncate, references, trigger on table public.customer_profiles_extended from authenticated",
    );
    expect(compactSql).toContain(
      "revoke execute on function public.compute_customer_health_score(uuid) from public, anon, authenticated",
    );
  });

  it("makes enqueue authoritative and service-only", () => {
    const fn = functionSql("enqueue_dge_refresh_job");
    expect(fn).toContain("<> 'service_role'");
    expect(fn).toContain("profile.active_workspace_id = v_workspace_id");
    expect(fn).toContain(
      "- 'workspace_id' - 'requested_by' - 'job_type' - 'dedupe_key'",
    );
    expect(fn).toContain("jsonb_build_object( 'workspace_id', v_workspace_id");
    expect(compactSql).toContain(
      "revoke all on function public.enqueue_dge_refresh_job",
    );
    expect(compactSql).toContain(
      'drop policy if exists "dge_refresh_jobs_insert_workspace"',
    );
  });

  it("binds completion to the current unexpired lease token", () => {
    const claim = functionSql("claim_dge_refresh_job");
    const complete = functionSql("complete_dge_refresh_job");
    expect(claim).toContain("lease_token uuid");
    expect(claim).toContain("requested_by uuid");
    expect(claim).toContain("lease_token = gen_random_uuid()");
    expect(complete).toContain("p_lease_token uuid");
    expect(complete).toContain("status = 'running'");
    expect(complete).toContain("lease_token = p_lease_token");
    expect(complete).toContain("lease_expires_at > now()");
    expect(complete).toContain("get diagnostics v_rows = row_count");
    expect(compactSql).toContain(
      "revoke all on function public.claim_dge_refresh_job(integer) from public, anon, authenticated",
    );
    expect(complete).toContain("completion lease is stale");
  });

  it("discovers distinct health workspaces without a row cap", () => {
    const fn = functionSql("list_health_score_refresh_workspaces");
    expect(fn).toContain("select profile.active_workspace_id as workspace_id");
    expect(fn).toContain("union select company.workspace_id");
    expect(fn).not.toContain("limit");
    expect(fn).toContain("<> 'service_role'");
  });
});

function postgresBin(name: string): string | null {
  const candidateDirs = [
    process.env.QEP_POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@16/bin",
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
  ].filter((value): value is string => Boolean(value));
  for (const directory of candidateDirs) {
    const candidate = join(directory, name);
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

function runCommand(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `exit=${result.status}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ].filter(Boolean).join("\n"),
    );
  }
  return result.stdout;
}

function withScratchPostgres(
  callback: (
    psql: (sqlText: string) => string,
    connectionString: string,
  ) => void,
): void {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test invoked without server binaries");
  }
  const root = mkdtempSync(join(tmpdir(), "qep-dna-814-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(24000 + Math.floor(Math.random() * 10000));
  const connectionArgs = [
    "-h",
    socketDir,
    "-p",
    port,
    "-U",
    "postgres",
    "-d",
    "postgres",
  ];

  try {
    mkdirSync(socketDir);
    runCommand(initdbPath, [
      "-D",
      dataDir,
      "--auth=trust",
      "--username=postgres",
    ]);
    runCommand(pgCtlPath, [
      "-D",
      dataDir,
      "-o",
      `-F -k ${socketDir} -p ${port} -c listen_addresses=''`,
      "-l",
      logPath,
      "start",
    ]);
    const psql = (sqlText: string): string => {
      const file = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(file, sqlText);
      return runCommand(psqlPath, [
        "-v",
        "ON_ERROR_STOP=1",
        ...connectionArgs,
        "-f",
        file,
      ]);
    };
    callback(
      psql,
      `host=${socketDir} port=${port} dbname=postgres user=postgres`,
    );
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

const scratchSchemaSql = String.raw`
create extension if not exists pgcrypto;
create extension if not exists dblink;
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create or replace function auth.role()
returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function public.get_my_workspace()
returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.workspace_id', true), '')
$$;
create or replace function public.get_my_role()
returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.qep_role', true), '')
$$;

create table public.profiles (
  id uuid primary key,
  role text not null default 'rep',
  active_workspace_id text not null
);

create table public.crm_companies (
  id uuid primary key,
  workspace_id text not null,
  name text not null,
  deleted_at timestamptz
);
create table public.customer_profiles_extended (
  id uuid primary key default gen_random_uuid(),
  hubspot_contact_id text,
  intellidealer_customer_id text,
  customer_name text not null,
  company_name text,
  crm_company_id uuid references public.crm_companies(id),
  health_score numeric,
  health_score_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_profiles_extended enable row level security;
create table public.qrm_contacts (
  id uuid primary key,
  workspace_id text not null,
  dge_customer_profile_id uuid references public.customer_profiles_extended(id),
  first_name text not null,
  last_name text not null,
  email text,
  primary_company_id uuid references public.crm_companies(id),
  hubspot_contact_id text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create view public.crm_contacts as select * from public.qrm_contacts;
grant select on public.crm_companies, public.crm_contacts to authenticated;

create table public.dge_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  job_type text not null,
  dedupe_key text not null,
  status text not null default 'queued',
  priority integer not null default 100,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  requested_by uuid references public.profiles(id),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.dge_refresh_jobs enable row level security;
create unique index uq_dge_refresh_jobs_open_dedupe
  on public.dge_refresh_jobs (workspace_id, dedupe_key)
  where status in ('queued', 'running') and deleted_at is null;

create or replace function public.compute_customer_health_score(uuid)
returns numeric language sql security definer as $$ select 50::numeric $$;

create or replace function public.claim_dge_refresh_job(integer default 60)
returns table (
  job_id uuid,
  workspace_id text,
  job_type text,
  dedupe_key text,
  request_payload jsonb,
  attempt_count integer
)
language sql security definer as $$ select null::uuid, null::text, null::text, null::text, null::jsonb, null::integer where false $$;

create or replace function public.complete_dge_refresh_job(
  uuid, text, jsonb default '{}'::jsonb, text default null
)
returns void language plpgsql security definer as $$ begin return; end $$;
`;

postgresBehavior("814 behavior on scratch PostgreSQL", () => {
  it("is concurrency-safe, tenant-safe, least-privilege, and rolls link failures back", () => {
    withScratchPostgres((psql, connectionString) => {
      psql(scratchSchemaSql);
      psql(`\\i ${migrationPath}`);
      const escapedConnection = connectionString.replaceAll("'", "''");
      psql(`
        insert into public.crm_companies (id, workspace_id, name) values
          ('10000000-0000-4000-8000-000000000001', 'workspace-a', 'Company A'),
          ('10000000-0000-4000-8000-000000000002', 'workspace-b', 'Company B');
        insert into public.profiles (id, role, active_workspace_id) values
          ('90000000-0000-4000-8000-000000000001', 'manager', 'workspace-a'),
          ('90000000-0000-4000-8000-000000000002', 'manager', 'workspace-b');
        insert into public.crm_contacts (
          id, workspace_id, first_name, last_name, primary_company_id, hubspot_contact_id
        ) values
          ('20000000-0000-4000-8000-000000000001', 'workspace-a', 'First', 'Customer',
           '10000000-0000-4000-8000-000000000001', 'hub-1'),
          ('20000000-0000-4000-8000-000000000002', 'workspace-a', 'Concurrent', 'Customer',
           '10000000-0000-4000-8000-000000000001', 'hub-2'),
          ('20000000-0000-4000-8000-000000000003', 'workspace-a', 'Rollback', 'Customer',
           '10000000-0000-4000-8000-000000000001', 'hub-3'),
          ('20000000-0000-4000-8000-000000000004', 'workspace-a', 'Companyless', 'Customer',
           null, 'hub-companyless'),
          ('20000000-0000-4000-8000-000000000005', 'workspace-a', 'Conflict', 'Customer',
           '10000000-0000-4000-8000-000000000001', 'hub-requested'),
          ('20000000-0000-4000-8000-000000000009', 'workspace-a', 'Intelli', 'Conflict',
           '10000000-0000-4000-8000-000000000001', 'hub-existing');

        select set_config('request.jwt.claim.role', 'service_role', false);

        do $$
        declare v_first uuid; v_replay uuid;
        begin
          v_first := public.get_or_create_customer_dna_profile(
            'workspace-a', '20000000-0000-4000-8000-000000000001', null, 'hub-1', 'intelli-1'
          );
          v_replay := public.get_or_create_customer_dna_profile(
            'workspace-a', '20000000-0000-4000-8000-000000000001', v_first, 'hub-1', 'intelli-1'
          );
          if v_first is distinct from v_replay then raise exception 'replay created a second profile'; end if;
          if (select count(*) from public.customer_profiles_extended where id = v_first) <> 1 then
            raise exception 'expected exactly one replay-safe profile';
          end if;
        end $$;

        insert into public.customer_profiles_extended (
          id, customer_name, crm_company_id, health_score,
          hubspot_contact_id, intellidealer_customer_id
        ) values
          ('30000000-0000-4000-8000-000000000002', 'Workspace B profile',
           '10000000-0000-4000-8000-000000000002', 99, 'hub-b', 'intelli-b'),
          ('30000000-0000-4000-8000-000000000003', 'Anchored adoption target',
           '10000000-0000-4000-8000-000000000001', 70, 'hub-companyless', 'intelli-a'),
          ('30000000-0000-4000-8000-000000000004', 'Identity conflict target',
           '10000000-0000-4000-8000-000000000001', 71, 'hub-existing', 'intelli-existing'),
          ('30000000-0000-4000-8000-000000000005', 'Legacy linked A',
           null, 72, null, null),
          ('30000000-0000-4000-8000-000000000006', 'Unanchored orphan',
           null, 73, null, null),
          ('30000000-0000-4000-8000-000000000007', 'Ambiguous legacy',
           null, 74, null, null);
        insert into public.crm_contacts (
          id, workspace_id, dge_customer_profile_id, first_name, last_name
        ) values
        (
          '20000000-0000-4000-8000-000000000006', 'workspace-a',
          '30000000-0000-4000-8000-000000000005', 'Legacy', 'Linked'
        ),
        (
          '20000000-0000-4000-8000-000000000007', 'workspace-a',
          '30000000-0000-4000-8000-000000000007', 'Ambiguous', 'A'
        ),
        (
          '20000000-0000-4000-8000-000000000008', 'workspace-b',
          '30000000-0000-4000-8000-000000000007', 'Ambiguous', 'B'
        );

        do $$
        begin
          begin
            perform public.get_or_create_customer_dna_profile(
              'workspace-a', '20000000-0000-4000-8000-000000000004',
              '30000000-0000-4000-8000-000000000003', 'hub-companyless', 'intelli-a'
            );
            raise exception 'expected companyless adoption rejection';
          exception when check_violation then null;
          end;
          if exists (
            select 1 from public.crm_contacts
            where id = '20000000-0000-4000-8000-000000000004'
              and dge_customer_profile_id is not null
          ) then raise exception 'companyless adoption left a contact link'; end if;

          begin
            perform public.get_or_create_customer_dna_profile(
              'workspace-a', '20000000-0000-4000-8000-000000000005',
              '30000000-0000-4000-8000-000000000004', 'hub-requested', 'intelli-existing'
            );
            raise exception 'expected identity conflict rejection';
          exception when check_violation then null;
          end;
          if exists (
            select 1 from public.crm_contacts
            where id = '20000000-0000-4000-8000-000000000005'
              and dge_customer_profile_id is not null
          ) then raise exception 'identity conflict left a contact link'; end if;

          begin
            perform public.get_or_create_customer_dna_profile(
              'workspace-a', '20000000-0000-4000-8000-000000000009',
              '30000000-0000-4000-8000-000000000004', 'hub-existing', 'intelli-requested'
            );
            raise exception 'expected IntelliDealer identity conflict rejection';
          exception when check_violation then null;
          end;
          if exists (
            select 1 from public.crm_contacts
            where id = '20000000-0000-4000-8000-000000000009'
              and dge_customer_profile_id is not null
          ) then raise exception 'IntelliDealer conflict left a contact link'; end if;
          if not exists (
            select 1 from public.customer_profiles_extended
            where id = '30000000-0000-4000-8000-000000000004'
              and hubspot_contact_id = 'hub-existing'
              and intellidealer_customer_id = 'intelli-existing'
          ) then raise exception 'identity conflict mutated the existing profile'; end if;
        end $$;
        do $$
        begin
          if exists (
            select 1 from public.list_customer_health_profiles_for_workspace(
              'workspace-a', 'score_desc', 100
            ) where id = '30000000-0000-4000-8000-000000000002'
          ) then
            raise exception 'workspace health resolver leaked another tenant profile';
          end if;
          if not exists (
            select 1 from public.list_customer_health_profiles_for_workspace(
              'workspace-a', 'score_desc', 100
            ) where customer_name = 'First Customer'
          ) then
            raise exception 'workspace health resolver omitted the target profile';
          end if;
          if exists (
            select 1 from public.list_customer_health_profiles_for_workspace(
              'workspace-a', 'score_desc', 100
            ) where customer_name = 'Ambiguous legacy'
          ) then
            raise exception 'workspace health resolver exposed an ambiguous legacy profile';
          end if;
        end $$;

        select set_config('request.jwt.claim.role', 'authenticated', false);
        select set_config('request.jwt.claim.workspace_id', 'workspace-a', false);
        select set_config('request.jwt.claim.qep_role', 'manager', false);
        select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', false);
        set role authenticated;
        do $$
        begin
          if not exists (
            select 1 from public.customer_profiles_extended
            where customer_name = 'First Customer'
          ) then raise exception 'RLS omitted workspace A company profile'; end if;
          if not exists (
            select 1 from public.customer_profiles_extended
            where customer_name = 'Legacy linked A'
          ) then raise exception 'RLS omitted workspace A linked legacy profile'; end if;
          if exists (
            select 1 from public.customer_profiles_extended
            where customer_name in (
              'Workspace B profile', 'Unanchored orphan', 'Ambiguous legacy'
            )
          ) then raise exception 'RLS leaked another workspace or unanchored profile'; end if;
          begin
            update public.customer_profiles_extended
            set customer_name = 'forbidden mutation'
            where customer_name = 'First Customer';
            raise exception 'expected authenticated profile mutation rejection';
          exception when insufficient_privilege then null;
          end;
          begin
            perform public.compute_customer_health_score(
              '30000000-0000-4000-8000-000000000002'
            );
            raise exception 'expected authenticated health compute rejection';
          exception when insufficient_privilege then null;
          end;
        end $$;
        reset role;
        select set_config('request.jwt.claim.role', 'service_role', false);

        create or replace function public.test_hold_customer_dna_profile()
        returns uuid language plpgsql as $$
        declare v_id uuid;
        begin
          v_id := public.get_or_create_customer_dna_profile(
            'workspace-a', '20000000-0000-4000-8000-000000000002', null, 'hub-2', null
          );
          perform pg_sleep(0.8);
          return v_id;
        end $$;
        select dblink_connect('dna_worker', '${escapedConnection}');
        select dblink_exec('dna_worker', 'set request.jwt.claim.role = ''service_role''');
        select dblink_send_query('dna_worker', 'select public.test_hold_customer_dna_profile()');
        select pg_sleep(0.15);
        select public.get_or_create_customer_dna_profile(
          'workspace-a', '20000000-0000-4000-8000-000000000002', null, 'hub-2', null
        );
        select * from dblink_get_result('dna_worker') as result(profile_id uuid);
        select dblink_disconnect('dna_worker');

        do $$
        declare v_linked uuid;
        begin
          select dge_customer_profile_id into v_linked from public.crm_contacts
          where id = '20000000-0000-4000-8000-000000000002';
          if v_linked is null then raise exception 'concurrent contact was not linked'; end if;
          if (select count(*) from public.customer_profiles_extended where hubspot_contact_id = 'hub-2') <> 1 then
            raise exception 'concurrent first refresh created duplicate profiles';
          end if;
        end $$;

        create or replace function public.reject_customer_dna_link()
        returns trigger language plpgsql as $$
        begin
          if new.id = '20000000-0000-4000-8000-000000000003'::uuid then
            raise exception 'forced link failure';
          end if;
          return new;
        end $$;
        create trigger reject_customer_dna_link_trg
          before update on public.qrm_contacts
          for each row execute function public.reject_customer_dna_link();
        do $$
        declare v_before integer;
        begin
          select count(*) into v_before from public.customer_profiles_extended;
          begin
            perform public.get_or_create_customer_dna_profile(
              'workspace-a', '20000000-0000-4000-8000-000000000003', null, 'hub-3', null
            );
            raise exception 'expected forced contact-link failure';
          exception when raise_exception then
            if sqlerrm = 'expected forced contact-link failure' then raise; end if;
          end;
          if (select count(*) from public.customer_profiles_extended) <> v_before then
            raise exception 'failed contact link left an orphan profile';
          end if;
        end $$;
        drop trigger reject_customer_dna_link_trg on public.qrm_contacts;

        do $$
        begin
          begin
            perform public.get_or_create_customer_dna_profile(
              'workspace-b', '20000000-0000-4000-8000-000000000001', null, 'hub-1', null
            );
            raise exception 'expected workspace rejection';
          exception when no_data_found then null;
          end;
        end $$;

        do $$
        declare
          v_enqueued record;
          v_first_claim record;
          v_reclaimed record;
          v_payload jsonb;
        begin
          begin
            perform public.enqueue_dge_refresh_job(
              'workspace-a', 'customer_profile_refresh', 'cross-workspace-user',
              '{}'::jsonb, '90000000-0000-4000-8000-000000000002', 40
            );
            raise exception 'expected requested_by workspace rejection';
          exception when insufficient_privilege then null;
          end;

          select * into v_enqueued
          from public.enqueue_dge_refresh_job(
            'workspace-a', 'CUSTOMER_PROFILE_REFRESH', ' DNA:PROFILE-1 ',
            jsonb_build_object(
              'workspace_id', 'workspace-b',
              'requested_by', '90000000-0000-4000-8000-000000000002',
              'customer_profiles_extended_id', 'profile-1'
            ),
            '90000000-0000-4000-8000-000000000001',
            40
          );
          select request_payload into v_payload
          from public.dge_refresh_jobs where id = v_enqueued.job_id;
          if v_payload ->> 'workspace_id' <> 'workspace-a'
             or v_payload ->> 'requested_by' <> '90000000-0000-4000-8000-000000000001'
             or v_payload ->> 'job_type' <> 'customer_profile_refresh'
             or v_payload ->> 'dedupe_key' <> 'dna:profile-1' then
            raise exception 'enqueue payload was not canonicalized';
          end if;

          select * into v_first_claim from public.claim_dge_refresh_job(15);
          if v_first_claim.lease_token is null
             or v_first_claim.requested_by <> '90000000-0000-4000-8000-000000000001'::uuid then
            raise exception 'claim omitted lease ownership or requested_by';
          end if;
          update public.dge_refresh_jobs
          set lease_expires_at = now() - interval '1 second'
          where id = v_first_claim.job_id;
          begin
            perform public.complete_dge_refresh_job(
              v_first_claim.job_id, v_first_claim.lease_token, 'succeeded', '{}'::jsonb, null
            );
            raise exception 'expected expired lease completion rejection';
          exception when no_data_found then null;
          end;
          select * into v_reclaimed from public.claim_dge_refresh_job(15);
          if v_reclaimed.job_id is distinct from v_first_claim.job_id
             or v_reclaimed.lease_token is not distinct from v_first_claim.lease_token then
            raise exception 'expired job was not reclaimed with a fresh lease';
          end if;

          begin
            perform public.complete_dge_refresh_job(
              v_first_claim.job_id, v_first_claim.lease_token, 'succeeded', '{}'::jsonb, null
            );
            raise exception 'expected stale-owner completion rejection';
          exception when no_data_found then null;
          end;
          if not exists (
            select 1 from public.dge_refresh_jobs
            where id = v_reclaimed.job_id
              and status = 'running'
              and lease_token = v_reclaimed.lease_token
          ) then raise exception 'stale owner changed the reclaimed job'; end if;

          perform public.complete_dge_refresh_job(
            v_reclaimed.job_id, v_reclaimed.lease_token, 'succeeded',
            jsonb_build_object('ok', true), null
          );
          begin
            perform public.complete_dge_refresh_job(
              v_reclaimed.job_id, v_reclaimed.lease_token, 'succeeded', '{}'::jsonb, null
            );
            raise exception 'expected zero-row completion rejection';
          exception when no_data_found then null;
          end;
        end $$;

        insert into public.profiles (id, role, active_workspace_id)
        select gen_random_uuid(), 'rep', 'bulk-workspace-' || value::text
        from generate_series(1, 1005) as series(value);
        do $$
        declare v_count integer;
        begin
          select jsonb_array_length(public.list_health_score_refresh_workspaces())
          into v_count;
          if v_count < 1007 then
            raise exception 'uncapped workspace discovery omitted rows: %', v_count;
          end if;
        end $$;

        reset request.jwt.claim.role;
        do $$
        begin
          if has_function_privilege(
            'authenticated',
            'public.claim_dge_refresh_job(integer)',
            'EXECUTE'
          ) then
            raise exception 'authenticated retained EXECUTE on claim_dge_refresh_job';
          end if;
          if not has_function_privilege(
            'service_role',
            'public.claim_dge_refresh_job(integer)',
            'EXECUTE'
          ) then
            raise exception 'service_role lacks EXECUTE on claim_dge_refresh_job';
          end if;
        end $$;
        set role authenticated;
        do $$
        begin
          begin
            perform public.get_or_create_customer_dna_profile(
              'workspace-a', '20000000-0000-4000-8000-000000000001', null, 'hub-1', null
            );
            raise exception 'expected authenticated execute rejection';
          exception when insufficient_privilege then null;
          end;
          begin
            perform public.enqueue_dge_refresh_job(
              'workspace-a', 'customer_profile_refresh', 'authenticated-bypass',
              '{}'::jsonb, '90000000-0000-4000-8000-000000000001', 40
            );
            raise exception 'expected authenticated enqueue rejection';
          exception when insufficient_privilege then null;
          end;
          begin
            perform public.list_health_score_refresh_workspaces();
            raise exception 'expected authenticated workspace discovery rejection';
          exception when insufficient_privilege then null;
          end;
          begin
            perform public.claim_dge_refresh_job(60);
            raise exception 'expected authenticated claim rejection';
          exception when insufficient_privilege then null;
          end;
        end $$;
        reset role;
      `);
    });
  });
});
