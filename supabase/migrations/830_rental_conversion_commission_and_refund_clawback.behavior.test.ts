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
    "supabase/migrations/830_rental_conversion_commission_and_refund_clawback.sql",
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
  const root = mkdtempSync(join(tmpdir(), "qep-830-"));
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

create table auth.users (id uuid primary key);
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
  id uuid primary key references auth.users(id),
  role text not null,
  is_active boolean not null default true
);
create table public.profile_workspaces (
  profile_id uuid not null references public.profiles(id),
  workspace_id text not null,
  primary key (profile_id, workspace_id)
);
create table public.qrm_equipment (
  id uuid primary key,
  workspace_id text not null,
  deleted_at timestamptz
);
create table public.rental_contracts (
  id uuid primary key,
  workspace_id text not null,
  equipment_id uuid references public.qrm_equipment(id),
  deleted_at timestamptz
);
create table public.rental_contract_lines (
  id uuid primary key,
  workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  equipment_id uuid references public.qrm_equipment(id),
  deleted_at timestamptz
);
create table public.rental_invoices (
  id uuid primary key,
  workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  rental_charge_cents bigint not null,
  status text not null,
  deleted_at timestamptz
);
create table public.rental_contract_commissions (
  id uuid primary key,
  workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  salesperson_id uuid not null references public.profiles(id),
  split_pct numeric(5, 2) not null,
  role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.qrm_deals (
  id uuid primary key,
  workspace_id text not null,
  rental_contract_id uuid references public.rental_contracts(id),
  deleted_at timestamptz
);
create table public.qrm_deal_equipment (
  deal_id uuid not null references public.qrm_deals(id),
  workspace_id text not null,
  equipment_id uuid not null references public.qrm_equipment(id),
  role text not null
);
create table public.qb_deals (
  id uuid primary key,
  workspace_id text not null,
  crm_deal_id uuid references public.qrm_deals(id),
  gross_margin_cents bigint not null,
  status text not null,
  commission_paid boolean not null default false,
  salesman_id uuid not null references auth.users(id),
  commission_rate_pct numeric(5, 4) not null default 0.1500,
  commission_cents bigint,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.qep_roadmap_tasks (
  task_id text primary key,
  ship_state text,
  blocking_decision text,
  evidence_link text,
  notes text,
  updated_at timestamptz not null default now()
);
create table public.qep_roadmap_sync_events (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  task_id text not null,
  action text not null,
  changed_fields jsonb not null,
  actor text not null
);
insert into public.qep_roadmap_tasks (task_id, ship_state)
values ('L12.1', 'in_progress');
`;

postgresBehavior("830 rental commission behavior", () => {
  it("allocates paid commission to active splits, claws original payees, and nets conversion", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
set request.jwt.claim.role = 'service_role';
insert into auth.users values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.profiles (id, role) values
  ('10000000-0000-4000-8000-000000000001', 'rep'),
  ('10000000-0000-4000-8000-000000000002', 'rep'),
  ('10000000-0000-4000-8000-000000000003', 'owner');
insert into public.profile_workspaces values
  ('10000000-0000-4000-8000-000000000001', 'alpha'),
  ('10000000-0000-4000-8000-000000000002', 'alpha'),
  ('10000000-0000-4000-8000-000000000003', 'alpha');
insert into public.qrm_equipment values
  ('20000000-0000-4000-8000-000000000001', 'alpha', null);
insert into public.rental_contracts values
  ('30000000-0000-4000-8000-000000000001', 'alpha', '20000000-0000-4000-8000-000000000001', null);
insert into public.rental_invoices values
  ('40000000-0000-4000-8000-000000000001', 'alpha', '30000000-0000-4000-8000-000000000001', 1000000, 'paid', null);
insert into public.rental_contract_commissions
  (id, workspace_id, rental_contract_id, salesperson_id, split_pct, role)
values
  ('50000000-0000-4000-8000-000000000001', 'alpha', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 60, 'originator'),
  ('50000000-0000-4000-8000-000000000002', 'alpha', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 40, 'relationship');

select right(salesperson_id::text, 1) || ':' || rent_basis_cents || ':' || commission_cents
from public.rental_record_unit_commission_paid(
  'alpha',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1000000,
  'payment:1',
  '2026-07-20T12:00:00Z',
  '40000000-0000-4000-8000-000000000001',
  'invoice_payment',
  'customer-payment:1'
) order by salesperson_id;

select right(salesperson_id::text, 1) || ':' || rent_basis_cents || ':' || commission_cents
from public.rental_record_rent_refund_clawback(
  'alpha',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  200000,
  'credit_memo',
  'refund:1',
  'rent-credit:1'
) order by salesperson_id;

select net_unit_commission_cents
from public.v_rental_unit_commission_truth
where workspace_id = 'alpha'
  and equipment_id = '20000000-0000-4000-8000-000000000001';

insert into public.qrm_deals values
  ('60000000-0000-4000-8000-000000000001', 'alpha', '30000000-0000-4000-8000-000000000001', null);
insert into public.qrm_deal_equipment values
  ('60000000-0000-4000-8000-000000000001', 'alpha', '20000000-0000-4000-8000-000000000001', 'subject');
insert into public.qb_deals
  (id, workspace_id, crm_deal_id, gross_margin_cents, status, salesman_id)
values
  ('70000000-0000-4000-8000-000000000001', 'alpha', '60000000-0000-4000-8000-000000000001', 2000000, 'won', '10000000-0000-4000-8000-000000000001');

select prior_net_rental_commission_cents || ':' || net_conversion_commission_cents
from public.rental_calculate_conversion_commission(
  'alpha',
  '70000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  100000,
  'conversion:1',
  '10000000-0000-4000-8000-000000000003'
);

select status || ':' || net_conversion_commission_cents
from public.rental_post_conversion_commission(
  'alpha',
  (select id from public.rental_conversion_commission_settlements
   where workspace_id = 'alpha' and idempotency_key = 'conversion:1'),
  '10000000-0000-4000-8000-000000000003'
);
select commission_cents from public.qb_deals
where id = '70000000-0000-4000-8000-000000000001';

insert into public.rental_invoices values
  ('40000000-0000-4000-8000-000000000002', 'alpha', '30000000-0000-4000-8000-000000000001', 10000, 'paid', null);
do $$
begin
  begin
    perform * from public.rental_record_unit_commission_paid(
      'alpha', '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', 10000,
      'payment:late', '2026-07-21T12:00:00Z',
      '40000000-0000-4000-8000-000000000002', 'invoice_payment', 'customer-payment:late'
    );
    raise exception 'expected posted-unit mutation rejection';
  exception when object_not_in_prerequisite_state then
    null;
  end;
end $$;
select 'late:' || count(*) from public.rental_unit_commission_ledger
where source_event_key = 'payment:late';

select ship_state || ':' || blocking_decision
from public.qep_roadmap_tasks where task_id = 'L12.1';
`);
      expect(output).toContain("1:600000:30000");
      expect(output).toContain("2:400000:20000");
      expect(output).toContain("1:120000:-6000");
      expect(output).toContain("2:80000:-4000");
      expect(output).toContain("40000");
      expect(output).toContain("40000:260000");
      expect(output).toContain("posted:260000");
      expect(output).toContain("late:0");
      expect(output).toContain(
        "in_progress:BLK-RENTAL-COMMISSION-SOURCE-WIRING",
      );
    });
  });

  it("rejects unsupported clawback debt and keeps same-source retries idempotent", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration);
      const output = psql(String.raw`
set request.jwt.claim.role = 'service_role';
insert into auth.users values ('10000000-0000-4000-8000-000000000001');
insert into public.profiles (id, role) values ('10000000-0000-4000-8000-000000000001', 'rep');
insert into public.profile_workspaces values ('10000000-0000-4000-8000-000000000001', 'alpha');
insert into public.qrm_equipment values ('20000000-0000-4000-8000-000000000001', 'alpha', null);
insert into public.rental_contracts values ('30000000-0000-4000-8000-000000000001', 'alpha', '20000000-0000-4000-8000-000000000001', null);
insert into public.rental_invoices values ('40000000-0000-4000-8000-000000000001', 'alpha', '30000000-0000-4000-8000-000000000001', 1000000, 'paid', null);
insert into public.rental_contract_commissions
  (id, workspace_id, rental_contract_id, salesperson_id, split_pct)
values ('50000000-0000-4000-8000-000000000001', 'alpha', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 100);

do $$
begin
  begin
    perform * from public.rental_record_rent_refund_clawback(
      'alpha', '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', 10000,
      'credit_memo', 'refund:no-paid', 'credit:no-paid'
    );
    raise exception 'expected no-paid clawback rejection';
  exception when check_violation then
    raise notice 'no-paid-clawback-rejected';
  end;
end $$;

select count(*) from public.rental_record_unit_commission_paid(
  'alpha', '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 1000000,
  'payment:retry', '2026-07-20T12:00:00Z',
  '40000000-0000-4000-8000-000000000001', 'invoice_payment', 'customer-payment:retry'
);
select count(*) from public.rental_record_unit_commission_paid(
  'alpha', '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 1000000,
  'payment:retry', '2026-07-20T12:00:00Z',
  '40000000-0000-4000-8000-000000000001', 'invoice_payment', 'customer-payment:retry'
);
select count(*) from public.rental_unit_commission_ledger;
`);
      expect(output).toContain("1\n1\n1");
    });
  });
});
