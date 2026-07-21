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

function postgresBin(name: string): string | null {
  for (const directory of [
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/libpq/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const initdb = postgresBin("initdb");
const pgCtl = postgresBin("pg_ctl");
const psql = postgresBin("psql");
const postgresBehavior = initdb && pgCtl && psql ? describe : describe.skip;

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

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/828_ar_monthly_charge_and_deposit_liability_ledger.sql",
  ),
  "utf8",
);

function extractFunction(name: string): string {
  const marker = `create or replace function public.${name}(`;
  const start = migration.indexOf(marker);
  const end = migration.indexOf("\n$$;", start);
  if (start < 0 || end < 0) {
    throw new Error(`function ${name} not found in migration 828`);
  }
  return migration.slice(start, end + "\n$$;".length);
}

function extractThrough(startMarker: string, endMarker: string): string {
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`migration 828 section not found: ${startMarker}`);
  }
  return migration.slice(start, end + endMarker.length);
}

const claimTableSql = extractThrough(
  "create table if not exists public.ar_dunning_invoice_cycle_claims (",
  "grant select on table public.ar_dunning_invoice_cycle_claims\n  to authenticated, service_role;",
);

const cursorTableSql = extractThrough(
  "create table if not exists public.ar_dunning_workspace_cursors (",
  "grant select on table public.ar_dunning_workspace_cursors\n  to authenticated, service_role;",
);

const bootstrap = String.raw`
create extension if not exists pgcrypto;
create schema auth;
create role anon;
create role authenticated;
create role service_role;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create function public.get_my_workspace() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.workspace_id', true), ''), 'default')
$$;
create function public.get_my_role() returns text language sql stable as $$
  select nullif(current_setting('app.user_role', true), '')
$$;
create function public.qep_finance_can_read() returns boolean language sql stable as $$
  select true
$$;
create function public.qep_finance_can_mutate() returns boolean language sql stable as $$
  select true
$$;
create function public.qep_finance_config_value(text, text)
returns jsonb language sql stable as $$
  select '{"annual_rate": 0.18}'::jsonb
$$;

create table public.profiles (
  id uuid primary key,
  full_name text,
  role text not null,
  is_active boolean not null default true
);
create table public.profile_workspaces (
  profile_id uuid not null references public.profiles(id),
  workspace_id text not null,
  primary key (profile_id, workspace_id)
);

create table public.ar_finance_charge_policy_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  approval_status text not null default 'active',
  compounding_allowed boolean not null default false,
  max_monthly_rate numeric(8, 6) not null default 0.015,
  legal_reference text not null default 'test',
  evidence_url text not null default 'https://example.test/evidence',
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  effective_on date not null default current_date,
  expires_on date,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_deals (
  id uuid primary key,
  workspace_id text not null,
  deleted_at timestamptz,
  deposit_status text,
  deposit_amount numeric,
  updated_at timestamptz not null default now()
);
create table public.deposits (
  id uuid primary key,
  workspace_id text not null,
  deal_id uuid not null references public.crm_deals(id),
  required_amount numeric not null,
  status text not null,
  payment_method text,
  received_at timestamptz,
  verified_at timestamptz,
  invoice_reference text,
  updated_at timestamptz not null default now()
);

create table public.customer_deposit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  deposit_kind text not null,
  source_type text not null,
  source_id uuid,
  entry_type text not null,
  amount_cents bigint not null,
  liability_delta_cents bigint generated always as (
    case when entry_type in ('receipt', 'adjustment_in')
      then amount_cents else -amount_cents end
  ) stored,
  liability_account_key text not null,
  customer_invoice_id uuid,
  rental_return_id uuid,
  original_payment_method text,
  payment_reference text,
  idempotency_key text not null,
  entry_date date not null,
  memo text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create table public.workspace_settings (
  workspace_id text primary key,
  ar_finance_charge_compounding_enabled boolean not null default false,
  ar_finance_charge_rate_pct numeric not null default 0.015,
  ar_statement_day_of_month integer not null default 32,
  ar_finance_charge_days_past_due integer not null default 30,
  ar_reminder_min_days integer not null default 5,
  ar_reminder_max_days integer not null default 15,
  ar_auto_hold_days integer not null default 60
);
create table public.ar_statement_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  run_type text not null,
  scope_filter jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  created_by uuid,
  delivered_count integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.qrm_companies (
  id uuid primary key,
  workspace_id text not null,
  assess_late_charges boolean,
  credit_hold boolean not null default false,
  credit_hold_reason text,
  credit_hold_set_by uuid,
  credit_hold_set_at timestamptz
);
create table public.customer_invoices (
  id uuid primary key,
  workspace_id text not null,
  crm_company_id uuid,
  balance_due numeric not null,
  status text not null,
  invoice_source_code text,
  due_date date not null,
  branch_id text,
  invoice_department_code text,
  invoice_type text,
  deal_id uuid,
  created_at timestamptz not null default now()
);
create table public.ar_dunning_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  crm_company_id uuid,
  invoice_id uuid,
  statement_run_id uuid,
  event_type text not null,
  cycle_date date not null,
  charge_period date,
  days_past_due integer not null default 0,
  principal_basis_cents bigint not null default 0,
  rate_pct numeric not null default 0,
  lawful_cap_rate_pct numeric not null default 0,
  charge_cents bigint not null default 0,
  compounded boolean not null default false,
  finance_charge_policy_approval_id uuid,
  generated_invoice_id uuid,
  message_stub text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index uq_ar_dunning_events_cycle
  on public.ar_dunning_events(workspace_id, invoice_id, event_type, cycle_date);
create unique index uq_ar_dunning_finance_charge_month
  on public.ar_dunning_events(workspace_id, invoice_id, event_type, charge_period)
  where event_type = 'finance_charge' and invoice_id is not null;

insert into public.profiles (id, full_name, role) values
  ('11111111-1111-4111-8111-111111111111', 'Workspace Owner', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'Foreign Owner', 'owner');
insert into public.profile_workspaces (profile_id, workspace_id) values
  ('11111111-1111-4111-8111-111111111111', 'default'),
  ('22222222-2222-4222-8222-222222222222', 'foreign');
insert into public.ar_finance_charge_policy_approvals (
  id, workspace_id, approved_by
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'default',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.workspace_settings (workspace_id) values ('default');
insert into public.qrm_companies (id, workspace_id, assess_late_charges) values
  ('33333333-3333-4333-8333-333333333333', 'default', true);
insert into public.customer_invoices (
  id, workspace_id, crm_company_id, balance_due, status,
  invoice_source_code, due_date, branch_id, invoice_department_code,
  invoice_type, created_at
)
select
  ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'default',
  '33333333-3333-4333-8333-333333333333',
  100,
  'pending',
  'EQUIPMENT',
  current_date,
  'MAIN',
  'E',
  'equipment',
  now() + (i || ' seconds')::interval
from generate_series(1, 251) as series(i);
`;

postgresBehavior("828 release behavior", () => {
  it("drains bounded claims and rejects unattributed or conflicting replays", () => {
    const root = mkdtempSync(join(tmpdir(), "qep-828-"));
    const data = join(root, "data");
    const socket = join(root, "socket");
    const log = join(root, "postgres.log");
    const port = String(25000 + Math.floor(Math.random() * 10_000));
    let started = false;

    try {
      mkdirSync(socket);
      run(initdb!, ["-D", data, "--auth=trust", "--username=postgres"]);
      run(pgCtl!, [
        "-D", data,
        "-o", `-F -k ${socket} -p ${port} -c listen_addresses=''`,
        "-l", log,
        "start",
      ]);
      started = true;

      let sequence = 0;
      const query = (sql: string): string => {
        const path = join(root, `q-${sequence++}.sql`);
        writeFileSync(path, sql);
        return run(psql!, [
          "-v", "ON_ERROR_STOP=1",
          "-h", socket,
          "-p", port,
          "-U", "postgres",
          "-d", "postgres",
          "-At",
          "-f", path,
        ]);
      };

      query(bootstrap);
      query([
        claimTableSql,
        cursorTableSql,
        extractFunction("revoke_ar_finance_charge_policy_approval"),
        extractFunction("record_customer_deposit_ledger_entry"),
        extractFunction("record_sale_deposit_receipt"),
        extractFunction("run_ar_dunning_cycle"),
        extractFunction("run_ar_dunning_cycle_all"),
      ].join("\n\n"));

      const firstBatch = query(String.raw`
        set request.jwt.claim.role = 'service_role';
        select
          result ->> 'claimed_invoices',
          result ->> 'has_more'
        from (select public.run_ar_dunning_cycle('default', current_date) result) run;
        select count(*) from public.ar_dunning_invoice_cycle_claims;
        select exists (
          select 1 from public.ar_dunning_invoice_cycle_claims
          where invoice_id = '00000000-0000-4000-8000-000000000251'
        );
      `);
      expect(firstBatch).toContain("250|true");
      expect(firstBatch).toMatch(/\n250\n/);
      expect(firstBatch.trim().endsWith("f")).toBe(true);

      const crossDate = query(String.raw`
        -- Model midnight after an interrupted 250/251 drain. The durable
        -- workspace cursor stays on invoice 250 while daily claim identity
        -- rolls to a new cycle date.
        update public.ar_dunning_invoice_cycle_claims
        set cycle_date = current_date - 1
        where workspace_id = 'default'
          and cycle_date = current_date;

        select
          result ->> 'claimed_invoices',
          result ->> 'has_more'
        from (select public.run_ar_dunning_cycle('default', current_date) result) run;
        select count(*) from public.ar_dunning_invoice_cycle_claims
        where cycle_date = current_date;
        select exists (
          select 1 from public.ar_dunning_invoice_cycle_claims
          where cycle_date = current_date
            and invoice_id = '00000000-0000-4000-8000-000000000251'
        );
        select exists (
          select 1 from public.ar_dunning_invoice_cycle_claims
          where cycle_date = current_date
            and invoice_id = '00000000-0000-4000-8000-000000000250'
        );
      `);
      expect(crossDate).toContain("250|true");
      expect(crossDate).toMatch(/\n250\nt\nf\n/);

      const drained = query(String.raw`
        select
          result ->> 'claimed_invoices',
          result ->> 'has_more'
        from (select public.run_ar_dunning_cycle('default', current_date) result) run;
        select count(*) from public.ar_dunning_invoice_cycle_claims
        where cycle_date = current_date;
        select count(*) from public.ar_dunning_invoice_cycle_claims
        where cycle_date = current_date and completed_at is null;
        select
          result ->> 'claimed_invoices',
          result ->> 'has_more'
        from (select public.run_ar_dunning_cycle('default', current_date) result) run;
      `);
      expect(drained).toContain("1|false");
      expect(drained).toMatch(/\n251\n0\n/);
      expect(drained.trim().endsWith("0|false")).toBe(true);

      const workspaceFairness = query(String.raw`
        insert into public.workspace_settings (workspace_id)
        values ('alpha'), ('zeta');
        insert into public.qrm_companies (id, workspace_id, assess_late_charges)
        values
          ('aaaaaaaa-0000-4000-8000-000000000001', 'alpha', true),
          ('aaaaaaaa-0000-4000-8000-000000000002', 'zeta', true);
        insert into public.customer_invoices (
          id, workspace_id, crm_company_id, balance_due, status,
          invoice_source_code, due_date, branch_id, invoice_department_code,
          invoice_type, created_at
        ) values
          (
            'bbbbbbbb-0000-4000-8000-000000000001', 'alpha',
            'aaaaaaaa-0000-4000-8000-000000000001', 100, 'pending',
            'EQUIPMENT', current_date, 'MAIN', 'E', 'equipment', now()
          ),
          (
            'bbbbbbbb-0000-4000-8000-000000000002', 'zeta',
            'aaaaaaaa-0000-4000-8000-000000000002', 100, 'pending',
            'EQUIPMENT', current_date, 'MAIN', 'E', 'equipment', now()
          );

        select
          result->0->>'workspace_id',
          result->0->'result'->>'claimed_invoices'
        from (select public.run_ar_dunning_cycle_all() result) run;
        select
          result->0->>'workspace_id',
          result->0->'result'->>'claimed_invoices'
        from (select public.run_ar_dunning_cycle_all() result) run;
        select jsonb_array_length(public.run_ar_dunning_cycle_all());
      `);
      expect(workspaceFairness).toContain("alpha|1");
      expect(workspaceFairness).toContain("zeta|1");
      expect(workspaceFairness.trim().endsWith("0")).toBe(true);

      const revocation = query(String.raw`
        set request.jwt.claim.role = 'service_role';
        do $$
        begin
          begin
            perform public.revoke_ar_finance_charge_policy_approval(
              'default', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'Missing actor must fail', null
            );
            raise exception 'nullable revocation actor was accepted';
          exception when others then
            if position('attributable actor' in sqlerrm) = 0 then raise; end if;
          end;

          begin
            perform public.revoke_ar_finance_charge_policy_approval(
              'default', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'Foreign actor must fail',
              '22222222-2222-4222-8222-222222222222'
            );
            raise exception 'foreign revocation actor was accepted';
          exception when others then
            if position('active workspace owner' in sqlerrm) = 0 then raise; end if;
          end;
        end
        $$;

        select (
          public.revoke_ar_finance_charge_policy_approval(
            'default', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'Owner-requested legal policy revocation',
            '11111111-1111-4111-8111-111111111111'
          )
        ).revoked_by;
      `);
      expect(revocation.trim().endsWith("11111111-1111-4111-8111-111111111111"))
        .toBe(true);

      const ledgerReplay = query(String.raw`
        set request.jwt.claim.role = 'service_role';
        select (
          public.record_customer_deposit_ledger_entry(
            'default', 'sale_deposit', 'manual', null, 'adjustment_in',
            1000, 'customer_deposits_payable', 'manual-ledger-1',
            null, null, null, null, current_date, '  Audit memo  ',
            '{"source":"test"}'::jsonb
          )
        ).id \gset first_
        select (
          public.record_customer_deposit_ledger_entry(
            'default', 'sale_deposit', 'manual', null, 'adjustment_in',
            1000, 'customer_deposits_payable', 'manual-ledger-1',
            null, null, null, null, current_date, 'Audit memo',
            '{"source":"test"}'::jsonb
          )
        ).id = :'first_id';

        do $$
        begin
          begin
            perform public.record_customer_deposit_ledger_entry(
              'default', 'sale_deposit', 'manual', null, 'adjustment_in',
              1000, 'customer_deposits_payable', 'manual-ledger-1',
              null, null, null, null, current_date - 1, 'Audit memo',
              '{"source":"test"}'::jsonb
            );
            raise exception 'different entry_date was accepted';
          exception when others then
            if position('different deposit entry' in sqlerrm) = 0 then raise; end if;
          end;
          begin
            perform public.record_customer_deposit_ledger_entry(
              'default', 'sale_deposit', 'manual', null, 'adjustment_in',
              1000, 'customer_deposits_payable', 'manual-ledger-1',
              null, null, null, null, current_date, 'Changed memo',
              '{"source":"test"}'::jsonb
            );
            raise exception 'different memo was accepted';
          exception when others then
            if position('different deposit entry' in sqlerrm) = 0 then raise; end if;
          end;
          begin
            perform public.record_customer_deposit_ledger_entry(
              'default', 'sale_deposit', 'manual', null, 'adjustment_in',
              1000, 'customer_deposits_payable', 'manual-ledger-1',
              null, null, null, null, current_date, 'Audit memo',
              '{"source":"changed"}'::jsonb
            );
            raise exception 'different metadata was accepted';
          exception when others then
            if position('different deposit entry' in sqlerrm) = 0 then raise; end if;
          end;
        end
        $$;
      `);
      expect(ledgerReplay).toMatch(/\nt\n/);

      const receiptReplay = query(String.raw`
        set request.jwt.claim.role = 'service_role';
        insert into public.crm_deals (id, workspace_id) values
          ('44444444-4444-4444-8444-444444444444', 'default');
        insert into public.deposits (
          id, workspace_id, deal_id, required_amount, status, payment_method,
          received_at, verified_at, invoice_reference
        ) values (
          '55555555-5555-4555-8555-555555555555', 'default',
          '44444444-4444-4444-8444-444444444444', 10, 'verified', 'card',
          '2026-07-20T12:34:56Z', '2026-07-20T12:34:56Z', 'pi_exact'
        );
        insert into public.customer_deposit_ledger_entries (
          workspace_id, deposit_kind, source_type, source_id, entry_type,
          amount_cents, liability_account_key, original_payment_method,
          payment_reference, idempotency_key, entry_date, memo, metadata
        ) values (
          'default', 'sale_deposit', 'sale_deposit',
          '55555555-5555-4555-8555-555555555555', 'receipt', 1000,
          'customer_deposits_payable', 'card', 'pi_exact',
          'stripe-receipt-exact', '2026-07-20', 'Sale deposit receipt',
          jsonb_build_object(
            'source', 'record_sale_deposit_receipt',
            'received_at', '2026-07-20T12:34:56Z'::timestamptz
          )
        );

        select public.record_sale_deposit_receipt(
          'default', '55555555-5555-4555-8555-555555555555', 1000,
          'card', 'pi_exact', '2026-07-20T12:34:56Z',
          'stripe-receipt-exact'
        ) ->> 'idempotent_replay';

        do $$
        begin
          begin
            perform public.record_sale_deposit_receipt(
              'default', '55555555-5555-4555-8555-555555555555', 1000,
              'card', 'pi_exact', '2026-07-20T12:35:56Z',
              'stripe-receipt-exact'
            );
            raise exception 'different received_at was accepted';
          exception when others then
            if position('different payment evidence' in sqlerrm) = 0 then raise; end if;
          end;
          begin
            perform public.record_sale_deposit_receipt(
              'default', '55555555-5555-4555-8555-555555555555', 1000,
              'card', 'pi_exact', '2026-07-20T12:34:56Z',
              'stripe-receipt-other'
            );
            raise exception 'different idempotency key was accepted';
          exception when others then
            if position('different payment evidence' in sqlerrm) = 0 then raise; end if;
          end;
        end
        $$;
      `);
      expect(receiptReplay).toMatch(/\ntrue\n/);
    } finally {
      if (started) {
        spawnSync(pgCtl!, ["-D", data, "-m", "immediate", "stop"], {
          encoding: "utf8",
        });
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
