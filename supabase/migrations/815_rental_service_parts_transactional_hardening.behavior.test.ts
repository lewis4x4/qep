import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "815_rental_service_parts_transactional_hardening.sql",
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
    throw new Error(
      [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    );
  }
  return result.stdout;
}

function withScratchPostgres(
  callback: (psql: (sql: string) => string) => void,
): void {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test invoked without server binaries");
  }
  const root = mkdtempSync(join(tmpdir(), "qep-815-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(25000 + Math.floor(Math.random() * 10000));
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
      const path = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(path, sql);
      return run(psqlPath, [
        "-v",
        "ON_ERROR_STOP=1",
        ...connectionArgs,
        "-f",
        path,
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
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role;

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

create type public.rental_invoice_status as enum (
  'draft', 'open', 'posted', 'sent', 'partial', 'paid', 'overdue', 'void', 'reversed'
);

create table public.portal_customers (
  id uuid primary key,
  workspace_id text not null,
  crm_company_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.qrm_companies (
  id uuid primary key,
  workspace_id text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.branches (
  id uuid primary key,
  workspace_id text not null,
  slug text,
  legacy_code text,
  state_province text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.qrm_company_ship_to_addresses (
  id uuid primary key,
  workspace_id text not null,
  company_id uuid not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  county_name text,
  state text,
  tax_jurisdiction_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.tax_jurisdictions (
  id uuid primary key,
  workspace_id text not null,
  state_code text not null,
  county_name text,
  jurisdiction_name text not null,
  state_rate numeric(8,6) not null default 0,
  county_surtax_rate numeric(8,6) not null default 0,
  surtax_cap_amount numeric(14,2),
  source_label text,
  effective_date date not null default current_date,
  expires_at date,
  is_active boolean not null default true,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.rental_contracts (
  id uuid primary key,
  workspace_id text not null,
  contract_number text,
  contract_type text not null default 'rental',
  lifecycle_state text not null default 'on_rent',
  on_rent_at timestamptz,
  off_rent_at timestamptz,
  returned_at timestamptz,
  agreed_daily_rate numeric,
  agreed_weekly_rate numeric,
  agreed_monthly_rate numeric,
  delivery_fee_cents bigint,
  pickup_fee_cents bigint,
  damage_waiver_accepted boolean,
  damage_waiver_rate_pct numeric,
  deposit_status text,
  deposit_amount numeric,
  portal_customer_id uuid references public.portal_customers(id),
  qrm_company_id uuid,
  branch_id uuid references public.branches(id),
  ship_to_address_id uuid,
  tax_sourcing_method text,
  deleted_at timestamptz
);
create table public.rental_billing_runs (
  id uuid primary key,
  workspace_id text not null,
  status text not null,
  metadata jsonb not null default '{}',
  completed_at timestamptz,
  deleted_at timestamptz
);
create table public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  portal_customer_id uuid,
  crm_company_id uuid,
  invoice_number text not null,
  invoice_date date,
  due_date date,
  description text,
  amount numeric not null,
  tax numeric,
  total numeric not null,
  amount_paid numeric,
  status text not null,
  invoice_type text,
  invoice_source_code text,
  branch_id text,
  ship_to_address_id uuid,
  tax_breakdown jsonb,
  tax_code_1 text,
  tax_code_2 text,
  dr15_county_name text,
  tax_jurisdiction_id uuid,
  quickbooks_gl_status text not null default 'not_synced',
  quickbooks_gl_last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.rental_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  rental_billing_run_id uuid references public.rental_billing_runs(id),
  customer_invoice_id uuid references public.customer_invoices(id),
  invoice_number text not null,
  period_start date not null,
  period_end date not null,
  rental_charge_cents bigint not null default 0,
  taxable_amount_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  amount_paid_cents bigint not null default 0,
  status public.rental_invoice_status not null,
  posted_at timestamptz,
  due_date date,
  ship_to_address_id uuid,
  tax_breakdown jsonb not null default '{}',
  dr15_county_name text,
  tax_jurisdiction_id uuid,
  reversal_reason text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.rental_contract_lines (
  id uuid primary key,
  workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  included_hours numeric,
  outbound_meter_hours numeric,
  return_meter_hours numeric,
  overage_hourly_rate_cents bigint,
  deleted_at timestamptz
);
create table public.rental_returns (
  id uuid primary key,
  workspace_id text not null,
  rental_contract_id uuid references public.rental_contracts(id),
  equipment_id uuid,
  fuel_charge_cents bigint,
  cleaning_charge_cents bigint,
  damage_charge_cents bigint,
  environmental_fee_cents bigint,
  damage_disposition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.rental_billing_run_items (
  id uuid primary key,
  workspace_id text not null,
  rental_billing_run_id uuid not null references public.rental_billing_runs(id),
  rental_contract_id uuid not null references public.rental_contracts(id),
  status text not null,
  worker_token uuid,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  rental_invoice_id uuid references public.rental_invoices(id),
  billed_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  mirror_skipped boolean not null default false,
  error_detail text,
  completed_at timestamptz
);
create table public.customer_invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  invoice_id uuid not null references public.customer_invoices(id),
  line_number integer not null,
  description text not null,
  quantity numeric not null,
  unit_price numeric not null
);
create table public.quickbooks_gl_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  invoice_id uuid not null unique references public.customer_invoices(id),
  source_type text,
  posting_mode text,
  status text,
  quickbooks_txn_id text
);
create table public.service_jobs (
  id uuid primary key,
  workspace_id text not null
);
create table public.service_parts_requirements (
  id uuid primary key,
  workspace_id text not null,
  job_id uuid not null references public.service_jobs(id),
  status text not null,
  intake_line_status text
);
create table public.test_reconcile_calls (called_at timestamptz default now());

create function public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb)
returns table (invoice_id uuid, created_new boolean)
language sql security definer set search_path = '' as $$
  select gen_random_uuid(), true
$$;
create function public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into public.test_reconcile_calls default values;
  return jsonb_build_object('status', 'stub-called');
end;
$$;

insert into public.rental_contracts (id, workspace_id) values
  ('10000000-0000-4000-8000-000000000001', 'default');
insert into public.rental_invoices (
  id, workspace_id, rental_contract_id, invoice_number, period_start, period_end,
  status, posted_at, amount_paid_cents
) values
  ('20000000-0000-4000-8000-000000000001', 'default',
   '10000000-0000-4000-8000-000000000001', 'R-1', '2026-01-01', '2026-01-28',
   'posted', '2026-01-29T10:00:00Z', 0),
  ('20000000-0000-4000-8000-000000000002', 'default',
   '10000000-0000-4000-8000-000000000001', 'R-2', '2026-01-01', '2026-01-28',
   'posted', '2026-01-29T11:00:00Z', 0);
`;

postgresBehavior("815 behavior on scratch Postgres", () => {
  it("executes the migration, quarantines only the deterministic loser, and rejects incomplete plans", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(`\\i ${migrationPath}`);
      const evidence = psql(`
        do $$
        begin
          if (select count(*) from public.rental_invoice_period_quarantine) <> 1 then
            raise exception 'expected one quarantined duplicate';
          end if;
          if (
            select canonical_rental_invoice_id
            from public.rental_invoice_period_quarantine
          ) <> '20000000-0000-4000-8000-000000000001'::uuid then
            raise exception 'earliest posted invoice must remain canonical';
          end if;
          if (
            select status from public.rental_invoices
            where id = '20000000-0000-4000-8000-000000000002'
          ) <> 'void'::public.rental_invoice_status then
            raise exception 'deterministic duplicate loser must be void';
          end if;
          if has_function_privilege(
            'authenticated',
            'public.reconcile_service_parts_plan_v1_unchecked(text,uuid,uuid,uuid,jsonb)',
            'execute'
          ) then
            raise exception 'unchecked reconciler must be private';
          end if;
        end $$;

        insert into public.service_jobs (id, workspace_id) values
          ('30000000-0000-4000-8000-000000000001', 'default');
        insert into public.service_parts_requirements (
          id, workspace_id, job_id, status, intake_line_status
        ) values
          ('40000000-0000-4000-8000-000000000001', 'default',
           '30000000-0000-4000-8000-000000000001', 'pending', 'accepted'),
          ('40000000-0000-4000-8000-000000000002', 'default',
           '30000000-0000-4000-8000-000000000001', 'pending', 'accepted');

        set request.jwt.claim.role = 'authenticated';
        set request.jwt.claim.sub = '50000000-0000-4000-8000-000000000001';
        set request.jwt.claim.workspace_id = 'default';
        set role authenticated;
        do $$
        begin
          begin
            perform public.reconcile_service_parts_plan(
              'default',
              '30000000-0000-4000-8000-000000000001',
              '50000000-0000-4000-8000-000000000001',
              '60000000-0000-4000-8000-000000000001',
              jsonb_build_array(jsonb_build_object(
                'requirement_id', '40000000-0000-4000-8000-000000000001'
              ))
            );
            raise exception 'incomplete plan should fail';
          exception
            when serialization_failure then null;
          end;

          perform public.reconcile_service_parts_plan(
            'default',
            '30000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000002',
            jsonb_build_array(
              jsonb_build_object('requirement_id', '40000000-0000-4000-8000-000000000001'),
              jsonb_build_object('requirement_id', '40000000-0000-4000-8000-000000000002')
            )
          );
        end $$;
        reset role;

        select count(*) as safe_calls from public.test_reconcile_calls;
      `);
      expect(evidence).toContain(" 1");
    });
  });

  it("fails closed instead of auto-voiding a paid duplicate", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(`
        update public.rental_invoices
        set amount_paid_cents = 100
        where id = '20000000-0000-4000-8000-000000000002';
      `);
      let failure = "";
      try {
        psql(`\\i ${migrationPath}`);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      expect(failure.toLowerCase()).toContain(
        "rental_duplicate_period_financially_escaped",
      );
      const evidence = psql(`
        select count(*) filter (where status = 'void') as voided,
               count(*) filter (where status = 'posted') as active
        from public.rental_invoices;
      `);
      expect(evidence).toContain("0");
      expect(evidence).toContain("2");
    });
  });

  it("rejects a post when a locked numbering or tax source changed after planning", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(`\\i ${migrationPath}`);
      const evidence = psql(`
        insert into public.branches (
          id, workspace_id, slug, legacy_code, state_province
        ) values (
          '71000000-0000-4000-8000-000000000001', 'default', 'main', '01', 'FL'
        );
        insert into public.portal_customers (
          id, workspace_id, crm_company_id
        ) values (
          '72000000-0000-4000-8000-000000000001', 'default',
          '73000000-0000-4000-8000-000000000001'
        );
        insert into public.qrm_companies (id, workspace_id)
        values ('73000000-0000-4000-8000-000000000001', 'default');
        insert into public.qrm_company_ship_to_addresses (
          id, workspace_id, company_id, is_default, county_name, state
        ) values (
          '74000000-0000-4000-8000-000000000001', 'default',
          '73000000-0000-4000-8000-000000000001', true, 'Columbia', 'FL'
        );
        insert into public.tax_jurisdictions (
          id, workspace_id, state_code, county_name, jurisdiction_name,
          state_rate, county_surtax_rate, surtax_cap_amount, effective_date
        ) values (
          '75000000-0000-4000-8000-000000000001', 'global', 'FL', 'Columbia',
          'Columbia County, FL', 0.06, 0.015, 5000, current_date
        );
        update public.rental_contracts
        set branch_id = '71000000-0000-4000-8000-000000000001',
            portal_customer_id = '72000000-0000-4000-8000-000000000001',
            qrm_company_id = '73000000-0000-4000-8000-000000000001',
            ship_to_address_id = '74000000-0000-4000-8000-000000000001',
            tax_sourcing_method = 'destination_ship_to'
        where id = '10000000-0000-4000-8000-000000000001';

        insert into public.rental_billing_runs (id, workspace_id, status)
        values ('76000000-0000-4000-8000-000000000001', 'default', 'running');
        insert into public.rental_billing_run_items (
          id, workspace_id, rental_billing_run_id, rental_contract_id,
          status, worker_token
        ) values (
          '77000000-0000-4000-8000-000000000001', 'default',
          '76000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001', 'processing',
          '78000000-0000-4000-8000-000000000001'
        );

        set request.jwt.claim.role = 'service_role';
        do $$
        declare
          planned_snapshot jsonb;
        begin
          planned_snapshot := public.rental_billing_source_snapshot(
            'default', '10000000-0000-4000-8000-000000000001'
          );
          if planned_snapshot ->> 'version' <> '2'
             or planned_snapshot #>> '{numbering_branch,legacy_code}' <> '01'
             or planned_snapshot #>> '{tax_resolution,tax_jurisdiction,id}'
                <> '75000000-0000-4000-8000-000000000001' then
            raise exception 'expected complete versioned numbering/tax snapshot';
          end if;
          if planned_snapshot #>> '{tax_resolution,company,id}'
             <> '73000000-0000-4000-8000-000000000001' then
            raise exception 'expected same-workspace company source in snapshot';
          end if;

          update public.branches
          set legacy_code = '02', updated_at = now() + interval '1 second'
          where id = '71000000-0000-4000-8000-000000000001';

          begin
            perform public.post_rental_invoice_for_billing_item(
              '77000000-0000-4000-8000-000000000001',
              '78000000-0000-4000-8000-000000000001',
              jsonb_build_object('billing_source_snapshot', planned_snapshot)
            );
            raise exception 'stale numbering snapshot should fail';
          exception
            when serialization_failure then
              if sqlerrm not like '%RENTAL_BILLING_SOURCE_STALE%' then
                raise;
              end if;
          end;
        end $$;
        select 'source drift rejected' as result;
      `);
      expect(evidence).toContain("source drift rejected");
    });
  });

  it("rejects a direct company anchor from another workspace before AR mirror", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      psql(`\\i ${migrationPath}`);
      const evidence = psql(`
        insert into public.qrm_companies (id, workspace_id)
        values ('73000000-0000-4000-8000-000000000009', 'other');
        update public.rental_contracts
        set qrm_company_id = '73000000-0000-4000-8000-000000000009'
        where id = '10000000-0000-4000-8000-000000000001';
        do $$
        declare
          snapshot jsonb;
        begin
          snapshot := public.rental_billing_source_snapshot(
            'default', '10000000-0000-4000-8000-000000000001'
          );
          if snapshot is not null then
            raise exception 'cross-workspace company must not produce a billing snapshot';
          end if;
        end $$;
        select 'cross-workspace company rejected' as result;
      `);
      expect(evidence).toContain("cross-workspace company rejected");
    });
  });
});
