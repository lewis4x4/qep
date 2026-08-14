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

const migration830 = readFileSync(
  join(process.cwd(), "supabase/migrations/830_rental_conversion_commission_and_refund_clawback.sql"),
  "utf8",
);
const migration836 = readFileSync(
  join(process.cwd(), "supabase/migrations/836_l121_rental_commission_producer_activation.sql"),
  "utf8",
);

function postgresBin(name: string): string | null {
  for (const dir of [
    process.env.QEP_POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
  ].filter((value): value is string => Boolean(value))) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const initdbPath = postgresBin("initdb");
const pgCtlPath = postgresBin("pg_ctl");
const psqlPath = postgresBin("psql");
const postgresBehavior = initdbPath && pgCtlPath && psqlPath ? describe : describe.skip;

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

function withScratchPostgres(callback: (psql: (sql: string) => string) => void): void {
  if (!initdbPath || !pgCtlPath || !psqlPath) throw new Error("Postgres binaries unavailable");
  const root = mkdtempSync(join(tmpdir(), "qep-836-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(25000 + Math.floor(Math.random() * 10000));
  try {
    mkdirSync(socketDir);
    run(initdbPath, ["-D", dataDir, "--auth=trust", "--username=postgres"]);
    run(pgCtlPath, [
      "-D", dataDir, "-o", `-F -k ${socketDir} -p ${port} -c listen_addresses=''`,
      "-l", logPath, "start",
    ]);
    const psql = (sql: string): string => {
      const queryPath = join(root, `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
      writeFileSync(queryPath, sql);
      return run(psqlPath, [
        "-v", "ON_ERROR_STOP=1", "-At", "-h", socketDir, "-p", port,
        "-U", "postgres", "-d", "postgres", "-f", queryPath,
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
  id uuid primary key references auth.users(id), role text not null,
  is_active boolean not null default true
);
create table public.profile_workspaces (
  profile_id uuid not null references public.profiles(id), workspace_id text not null,
  primary key (profile_id, workspace_id)
);
create table public.qrm_equipment (
  id uuid primary key, workspace_id text not null, deleted_at timestamptz
);
create table public.rental_contracts (
  id uuid primary key, workspace_id text not null,
  equipment_id uuid references public.qrm_equipment(id), deleted_at timestamptz
);
create table public.rental_contract_lines (
  id uuid primary key, workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  equipment_id uuid references public.qrm_equipment(id), deleted_at timestamptz
);
create table public.customer_invoices (
  id uuid primary key, workspace_id text not null, invoice_type text not null,
  total numeric not null, amount_paid numeric not null default 0,
  status text not null, paid_at timestamptz
);
create table public.rental_invoices (
  id uuid primary key, workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  customer_invoice_id uuid references public.customer_invoices(id),
  rental_charge_cents bigint not null, total_cents bigint not null,
  amount_paid_cents bigint not null default 0, status text not null,
  paid_at timestamptz, updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.rental_contract_commissions (
  id uuid primary key, workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  salesperson_id uuid not null references public.profiles(id),
  split_pct numeric(5,2) not null, role text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.customer_payments (
  id uuid primary key, workspace_id text not null, reference text,
  received_at timestamptz not null, received_by uuid references public.profiles(id)
);
create table public.customer_payment_applications (
  id uuid primary key, workspace_id text not null,
  customer_payment_id uuid not null references public.customer_payments(id),
  customer_invoice_id uuid not null references public.customer_invoices(id)
);
create table public.portal_payment_intents (
  id uuid primary key, workspace_id text not null,
  invoice_id uuid references public.customer_invoices(id),
  stripe_payment_intent_id text not null, status text not null,
  webhook_signature_verified boolean not null default false,
  succeeded_at timestamptz
);
create table public.qrm_deals (
  id uuid primary key, workspace_id text not null,
  rental_contract_id uuid references public.rental_contracts(id), deleted_at timestamptz
);
create table public.qrm_deal_equipment (
  deal_id uuid not null references public.qrm_deals(id), workspace_id text not null,
  equipment_id uuid not null references public.qrm_equipment(id), role text not null
);
create table public.qb_deals (
  id uuid primary key, workspace_id text not null,
  crm_deal_id uuid references public.qrm_deals(id), gross_margin_cents bigint not null,
  status text not null, commission_paid boolean not null default false,
  salesman_id uuid not null references auth.users(id),
  commission_rate_pct numeric(5,4) not null default 0.1500,
  commission_cents bigint, updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.qep_roadmap_tasks (
  task_id text primary key, ship_state text, blocking_decision text,
  evidence_link text, notes text, updated_at timestamptz not null default now()
);
create table public.qep_roadmap_sync_events (
  id uuid primary key default gen_random_uuid(), direction text not null,
  task_id text not null, action text not null, changed_fields jsonb not null, actor text not null
);
insert into public.qep_roadmap_tasks (task_id, ship_state) values ('L12.1', 'in_progress');
`;

postgresBehavior("836 L12.1 producer behavior", () => {
  it("compiles over 830 and keeps payment, refund, and legacy retries exact", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration830);
      psql(migration836);
      const output = psql(String.raw`
set request.jwt.claim.role = 'service_role';
insert into auth.users values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.profiles (id, role) values
  ('10000000-0000-4000-8000-000000000001', 'rep'),
  ('10000000-0000-4000-8000-000000000002', 'finance_admin'),
  ('10000000-0000-4000-8000-000000000003', 'owner');
insert into public.profile_workspaces values
  ('10000000-0000-4000-8000-000000000001', 'alpha'),
  ('10000000-0000-4000-8000-000000000002', 'alpha'),
  ('10000000-0000-4000-8000-000000000003', 'alpha');
insert into public.qrm_equipment values
  ('20000000-0000-4000-8000-000000000001', 'alpha', null);
insert into public.rental_contracts values
  ('30000000-0000-4000-8000-000000000001', 'alpha',
   '20000000-0000-4000-8000-000000000001', null);
insert into public.customer_invoices values
  ('40000000-0000-4000-8000-000000000001', 'alpha', 'rental',
   10000, 10000, 'paid', '2026-08-14T12:00:00Z');
insert into public.rental_invoices values
  ('50000000-0000-4000-8000-000000000001', 'alpha',
   '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001',
   1000000, 1000000, 0, 'posted', null, now(), null);
insert into public.rental_contract_commissions
  (id, workspace_id, rental_contract_id, salesperson_id, split_pct)
values
  ('60000000-0000-4000-8000-000000000001', 'alpha',
   '30000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 100);
insert into public.customer_payments values
  ('70000000-0000-4000-8000-000000000001', 'alpha', 'check-17',
   '2026-08-14T12:00:00Z', '10000000-0000-4000-8000-000000000002');
insert into public.customer_payment_applications values
  ('80000000-0000-4000-8000-000000000001', 'alpha',
   '70000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001');

select count(*) from public.rental_activate_paid_invoice_commission(
  'alpha', '50000000-0000-4000-8000-000000000001',
  'customer_payment_application', '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);
select count(*) from public.rental_activate_paid_invoice_commission(
  'alpha', '50000000-0000-4000-8000-000000000001',
  'customer_payment_application', '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

select (public.rental_record_approved_rent_adjustment(
  'alpha', '50000000-0000-4000-8000-000000000001', 100000,
  'credit_memo', 'credit-1', 'CM-1', 'customer rent credit', null,
  '10000000-0000-4000-8000-000000000002'
)->'adjustment'->>'id') is not null;
select (public.rental_record_approved_rent_adjustment(
  'alpha', '50000000-0000-4000-8000-000000000001', 50000,
  'correction', 'correction-1', 'CORR-1', 'correct paid rent basis',
  'rental-payment:ar-application:80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
)->'adjustment'->>'id') is not null;
select (public.rental_record_approved_rent_adjustment(
  'alpha', '50000000-0000-4000-8000-000000000001', 100000,
  'credit_memo', 'credit-1', 'CM-1', 'customer rent credit', null,
  '10000000-0000-4000-8000-000000000002'
)->'adjustment'->>'id') is not null;

select status from public.rental_stage_legacy_payroll_commission(
  'alpha', '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001', 200000,
  '2026-01-15T12:00:00Z', 'PAY-2026-01', 'archive/payroll-2026-01.csv',
  'legacy-1', '10000000-0000-4000-8000-000000000002', null
);
do $$ begin
  begin
    perform public.rental_approve_legacy_payroll_commission(
      'alpha', (select id from public.rental_legacy_payroll_commission_imports
                where idempotency_key = 'legacy-1'),
      '10000000-0000-4000-8000-000000000002', 'self approval must fail');
    raise exception 'expected distinct approver rejection';
  exception when insufficient_privilege then raise notice 'self-approval-rejected'; end;
end $$;
select status from public.rental_approve_legacy_payroll_commission(
  'alpha', (select id from public.rental_legacy_payroll_commission_imports
            where idempotency_key = 'legacy-1'),
  '10000000-0000-4000-8000-000000000003', 'matched payroll register'
);
select status from public.rental_approve_legacy_payroll_commission(
  'alpha', (select id from public.rental_legacy_payroll_commission_imports
            where idempotency_key = 'legacy-1'),
  '10000000-0000-4000-8000-000000000003', 'matched payroll register'
);
insert into public.qrm_deals values
  ('90000000-0000-4000-8000-000000000001', 'alpha',
   '30000000-0000-4000-8000-000000000001', null);
insert into public.qrm_deal_equipment values
  ('90000000-0000-4000-8000-000000000001', 'alpha',
   '20000000-0000-4000-8000-000000000001', 'subject');
insert into public.qb_deals
  (id, workspace_id, crm_deal_id, gross_margin_cents, status, salesman_id)
values
  ('91000000-0000-4000-8000-000000000001', 'alpha',
   '90000000-0000-4000-8000-000000000001', 2000000, 'won',
   '10000000-0000-4000-8000-000000000001');
select status from public.rental_approve_conversion_commission(
  'alpha', '91000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 100000,
  'conversion-approval-1', '10000000-0000-4000-8000-000000000003',
  'approved negotiated customer credit'
);
select count(*) from public.rental_unit_commission_ledger;
select ship_state || ':' || blocking_decision from public.qep_roadmap_tasks
where task_id = 'L12.1';
`);
      expect(output).toContain("1\n1\nt\nt\nt\nstaged\nDO\nposted\nposted");
      expect(output).toContain("posted\n4");
      expect(output).toContain("in_progress:BLK-RENTAL-COMMISSION-UAT");
    });
  });

  it("fails closed on ambiguous unit allocation", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(migration830);
      psql(migration836);
      const output = psql(String.raw`
set request.jwt.claim.role = 'service_role';
insert into auth.users values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
insert into public.profiles (id, role) values
  ('10000000-0000-4000-8000-000000000001', 'rep'),
  ('10000000-0000-4000-8000-000000000002', 'owner');
insert into public.profile_workspaces values
  ('10000000-0000-4000-8000-000000000001', 'alpha'),
  ('10000000-0000-4000-8000-000000000002', 'alpha');
insert into public.qrm_equipment values
  ('20000000-0000-4000-8000-000000000001', 'alpha', null),
  ('20000000-0000-4000-8000-000000000002', 'alpha', null);
insert into public.rental_contracts values
  ('30000000-0000-4000-8000-000000000001', 'alpha',
   '20000000-0000-4000-8000-000000000001', null);
insert into public.rental_contract_lines values
  ('31000000-0000-4000-8000-000000000001', 'alpha',
   '30000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002', null);
insert into public.customer_invoices values
  ('40000000-0000-4000-8000-000000000001', 'alpha', 'rental',
   100, 100, 'paid', now());
insert into public.rental_invoices values
  ('50000000-0000-4000-8000-000000000001', 'alpha',
   '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001',
   10000, 10000, 0, 'posted', null, now(), null);
insert into public.rental_contract_commissions
  (id, workspace_id, rental_contract_id, salesperson_id, split_pct)
values
  ('60000000-0000-4000-8000-000000000001', 'alpha',
   '30000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 100);
insert into public.customer_payments values
  ('70000000-0000-4000-8000-000000000001', 'alpha', 'check', now(),
   '10000000-0000-4000-8000-000000000002');
insert into public.customer_payment_applications values
  ('80000000-0000-4000-8000-000000000001', 'alpha',
   '70000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001');
do $$ begin
  begin
    perform * from public.rental_activate_paid_invoice_commission(
      'alpha', '50000000-0000-4000-8000-000000000001',
      'customer_payment_application', '80000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002');
    raise exception 'expected ambiguous unit rejection';
  exception when invalid_parameter_value then raise notice 'ambiguous-unit-rejected'; end;
end $$;
select count(*) from public.rental_unit_commission_ledger;
`);
      expect(output.trim().endsWith("\n0")).toBe(true);
    });
  });
});
