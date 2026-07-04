import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "766_finance_foundation_trade_recondition_margin_gate.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(functionName: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").toLowerCase();
}

function postgresBin(name: string): string | null {
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  const candidateDirs = [
    process.env.QEP_POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@16/bin",
    ...pathDirs,
  ].filter((value): value is string => Boolean(value));

  for (const candidateDir of candidateDirs) {
    const candidate = join(candidateDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const initdbPath = postgresBin("initdb");
const pgCtlPath = postgresBin("pg_ctl");
const psqlPath = postgresBin("psql");
const postgresBehavior = initdbPath && pgCtlPath && psqlPath ? describe : describe.skip;

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
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
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result.stdout;
}

function withScratchPostgres(callback: (psql: (sql: string) => string) => void): void {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test was invoked without postgres binaries");
  }

  const root = mkdtempSync(join(tmpdir(), "qep-finance-766-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(24000 + Math.floor(Math.random() * 10000));
  const connectionArgs = ["-h", socketDir, "-p", port, "-U", "postgres", "-d", "postgres"];

  try {
    mkdirSync(socketDir);
    runCommand(initdbPath, ["-D", dataDir, "--auth=trust", "--username=postgres"]);
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
      const sqlPath = join(root, `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
      writeFileSync(sqlPath, sqlText);
      return runCommand(psqlPath, ["-v", "ON_ERROR_STOP=1", ...connectionArgs, "-f", sqlPath]);
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

const scratchSchemaSql = `
create extension if not exists pgcrypto;
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function public.get_my_workspace()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.workspace_id', true), ''), 'default');
$$;

create or replace function public.get_my_role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.qep_role', true), ''), 'rep');
$$;

create or replace function public.qep_finance_can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin');
$$;

create table public.finance_foundation_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  config_key text not null,
  config_value jsonb not null,
  safe_default jsonb not null,
  authorizing_question text,
  note text
);

create or replace function public.qep_finance_config_value(p_config_key text, p_workspace_id text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select c.config_value
      from public.finance_foundation_config c
      where c.config_key = p_config_key
        and c.workspace_id = coalesce(p_workspace_id, public.get_my_workspace())
      limit 1
    ),
    (
      select c.safe_default
      from public.finance_foundation_config c
      where c.config_key = p_config_key
        and c.workspace_id = 'default'
      limit 1
    )
  );
$$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  role text not null default 'rep',
  iron_role text
);

create table public.qb_deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default'
);

create table public.qb_brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  code text not null,
  name text not null
);

create table public.qb_margin_thresholds (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  brand_id uuid references public.qb_brands(id) on delete cascade,
  min_margin_pct numeric not null,
  notes text,
  updated_at timestamptz not null default now()
);

create table public.trade_valuations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid references public.qb_deals(id) on delete set null,
  make text,
  auction_value numeric,
  discount_percentage numeric,
  discounted_value numeric,
  reconditioning_estimate numeric,
  final_value numeric,
  suggested_resale_price numeric,
  status text not null default 'preliminary',
  approved_by uuid references public.profiles(id) on delete set null,
  approval_notes text,
  updated_at timestamptz not null default now()
);

create table public.qb_trade_ins (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid references public.qb_deals(id) on delete set null,
  make text,
  allowance_cents integer,
  book_value_cents integer,
  over_under_cents integer,
  payoff_amount_cents integer,
  payoff_good_through_date date,
  lien_holder_name text,
  lien_holder_address text,
  lien_holder_account_number text,
  lien_release_received_at date,
  title_received_at date,
  disposition text
);

insert into public.qb_brands (workspace_id, code, name)
values ('default', 'ASV', 'ASV'), ('default', 'OTHER', 'Other');

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.trade_valuations to authenticated;
grant select, insert, update, delete on public.qb_trade_ins to authenticated;
`;

describe("766_finance_foundation_trade_recondition_margin_gate.sql contract", () => {
  it("adds represented-brand config, trade valuation margin storage, and trade-in approval state columns", () => {
    expect(compactSql).toContain("alter table public.qb_brands add column if not exists represented_for_retail_trade boolean not null default false");
    expect(compactSql).toContain("alter table public.trade_valuations add column if not exists expected_gross_margin_pct numeric");
    expect(compactSql).toContain("alter table public.qb_trade_ins add column if not exists trade_valuation_id uuid");
    expect(compactSql).toContain("add column if not exists reconditioning_requires_manager_approval boolean not null default false");
    expect(compactSql).toContain("add column if not exists reconditioning_approval_status text not null default 'not_required'");
  });

  it("introduces config-driven threshold rows instead of hard-coding policy values", () => {
    expect(compactSql).toContain("'trade_recondition_material_change_threshold'");
    expect(compactSql).toContain("'trade_nonrepresented_discount_band'");
    expect(compactSql).toContain("'trade_valuation_guardrail'");
    expect(compactSql).toContain("\"percent_delta\": 0.10");
    expect(compactSql).toContain("\"min_discount_pct\": 8");
    expect(compactSql).toContain("\"max_trade_cost_pct_of_auction_value\": 1.0");
  });

  it("creates append-only trade recondition approval audit with finance-only read policy", () => {
    expect(compactSql).toContain("create table if not exists public.trade_recondition_approval_audit");
    expect(compactSql).toContain("qb_trade_in_id uuid references public.qb_trade_ins(id) on delete set null");
    expect(compactSql).toContain("trade_valuation_id uuid references public.trade_valuations(id) on delete set null");
    expect(compactSql).toContain('drop policy if exists "trade_recondition_approval_audit_finance_read"');
    expect(compactSql).toContain("create policy \"trade_recondition_approval_audit_finance_read\"");
    expect(compactSql).toContain("public.qep_finance_can_read()");
    expect(compactSql).toContain("create trigger trade_recondition_approval_audit_append_only");
  });

  it("is self-contained for foreign-key guards and does not depend on dropped migration helpers", () => {
    expect(compactSql).not.toContain("public.qep_column_has_fk(");
    expect(compactSql).not.toContain("function public.qep_column_has_fk");
    expect(compactSql).toContain("from pg_constraint c join pg_attribute a");
    expect(compactSql).toContain("a.attname = 'trade_valuation_id'");
  });

  it("computes expected margin, syncs trade/valuation state, and exposes manager approval rpc", () => {
    const calcFn = compact(functionSql("qep_trade_expected_margin_pct"));
    const approverFn = compact(functionSql("qep_is_trade_recondition_manager_approver"));
    const materialChangeFn = compact(functionSql("qep_trade_recondition_material_change"));
    const syncFn = compact(functionSql("qep_trade_sync_recondition_state"));
    const approvalFn = compact(functionSql("record_trade_recondition_manager_approval"));

    expect(calcFn).toContain("p_expected_sale_price - coalesce(p_trade_cost, 0) - coalesce(p_reconditioning_estimate, 0)");
    expect(approverFn).toContain("p.iron_role = 'iron_manager'");
    expect(approverFn).toContain("p.workspace_id = (select public.get_my_workspace())");
    expect(materialChangeFn).toContain("p_previous_reconditioning_estimate is null or p_current_reconditioning_estimate is null");
    expect(syncFn).toContain("validation_trade_recondition_workspace_scope_required");
    expect(syncFn).toContain("v_expected_margin_pct < v_floor_pct");
    expect(syncFn).toContain("public.qep_trade_recondition_material_change");
    expect(syncFn).toContain("nullif(v_trade.book_value_cents, 0)::numeric / 100.0");
    expect(syncFn).toContain("set_config('qep.trade_recondition_sync_active', 'on', true)");
    expect(syncFn).toContain("v_guardrail_breach");
    expect(syncFn).toContain("v_new_status := 'stale'");
    expect(approvalFn).toContain("validation_sales_manager_approver_required");
    expect(approvalFn).toContain("validation_sales_manager_approver_workspace_required");
    expect(approvalFn).toContain("'customer_allowance'");
    expect(approvalFn).toContain("insert into public.trade_recondition_approval_audit");
    expect(approvalFn).toContain("public.qep_trade_sync_recondition_state(v_trade.id)");
  });

  it("seeds the 15 percent trade-recondition floor into qb_margin_thresholds for represented brands", () => {
    expect(compactSql).toContain("insert into public.qb_margin_thresholds");
    expect(compactSql).toContain("where b.represented_for_retail_trade = true");
    expect(compactSql).toContain("15::numeric");
    expect(compactSql).toContain("greatest(coalesce(t.min_margin_pct, 0), 15)");
  });

  it("guards direct approval-state writes while allowing the internal sync path", () => {
    const marginGuardFn = compact(functionSql("trade_valuations_guard_expected_margin_write"));
    const guardFn = compact(functionSql("qb_trade_ins_guard_recondition_approval_state_write"));

    expect(marginGuardFn).toContain("forbidden_trade_recondition_expected_margin_write");
    expect(compactSql).toContain("revoke select on table public.trade_valuations from authenticated");
    expect(compactSql).toContain("a.attname <> 'expected_gross_margin_pct'");
    expect(compactSql).toContain("revoke execute on function public.qep_trade_sync_recondition_state(uuid) from authenticated");
    expect(compactSql).not.toContain("grant execute on function public.qep_trade_sync_recondition_state(uuid) to authenticated");
    expect(guardFn).toContain("current_setting('qep.trade_recondition_sync_active', true) = 'on'");
    expect(guardFn).toContain("forbidden_trade_recondition_approval_state_write");
    expect(compactSql).toContain("create trigger trg_qb_trade_ins_guard_recondition_approval_state");
    expect(compactSql).toContain("create trigger trg_trade_valuations_guard_expected_margin");
    expect(compactSql).toContain("before insert or update of reconditioning_requires_manager_approval, reconditioning_approval_status");
    expect(compactSql).toContain("after insert or update of trade_valuation_id, disposition, book_value_cents, over_under_cents, allowance_cents");
  });
});

postgresBehavior("766 finance trade recondition behavior on scratch Postgres", () => {
  it("executes approval, guard, reapproval, and append-only audit paths", () => {
    withScratchPostgres((psql) => {
      psql(scratchSchemaSql);
      psql(`\\i ${migrationPath}`);
      psql(`
        set request.jwt.claim.role = 'authenticated';
        set request.jwt.claim.qep_role = 'owner';
        set request.jwt.claim.workspace_id = 'default';

        insert into public.profiles (id, workspace_id, role, iron_role) values
          ('00000000-0000-0000-0000-0000000000a1', 'default', 'owner', 'iron_manager'),
          ('00000000-0000-0000-0000-0000000000b1', 'default', 'manager', 'iron_manager'),
          ('00000000-0000-0000-0000-0000000000c1', 'default', 'rep', 'iron_advisor');

        set request.jwt.claim.role = 'service_role';
        set request.jwt.claim.workspace_id = 'other';

        insert into public.profiles (id, workspace_id, role, iron_role) values
          ('00000000-0000-0000-0000-0000000000d1', 'other', 'manager', 'iron_manager');

        insert into public.qb_deals (id, workspace_id)
        values ('10000000-0000-0000-0000-000000000004', 'other');

        insert into public.trade_valuations (
          id, workspace_id, deal_id, make, auction_value, reconditioning_estimate, suggested_resale_price
        ) values (
          '20000000-0000-0000-0000-000000000004',
          'other',
          '10000000-0000-0000-0000-000000000004',
          'ASV',
          10000,
          1000,
          10000
        );

        insert into public.qb_trade_ins (
          id, workspace_id, deal_id, make, allowance_cents, book_value_cents, disposition, trade_valuation_id
        ) values (
          '30000000-0000-0000-0000-000000000004',
          'other',
          '10000000-0000-0000-0000-000000000004',
          'ASV',
          950000,
          null,
          'keep_recondition',
          '20000000-0000-0000-0000-000000000004'
        );

        set request.jwt.claim.role = 'authenticated';
        set request.jwt.claim.workspace_id = 'default';

        do $$
        begin
          if public.qep_is_trade_recondition_manager_approver('00000000-0000-0000-0000-0000000000a1') is not true then
            raise exception 'owner mapped to iron_manager should be a valid approver';
          end if;
          if public.qep_is_trade_recondition_manager_approver('00000000-0000-0000-0000-0000000000c1') is not false then
            raise exception 'rep should not be a valid approver';
          end if;
          if public.qep_is_trade_recondition_manager_approver('00000000-0000-0000-0000-0000000000d1') is not false then
            raise exception 'cross-workspace manager profile should not be visible as an approver';
          end if;
          if public.qep_trade_recondition_material_change('default', null, 500) is not true then
            raise exception 'null-to-value recon estimate must force reapproval';
          end if;
          if public.qep_trade_recondition_material_change('default', null, null) is not false then
            raise exception 'null-to-null recon estimate should not force reapproval';
          end if;
        end $$;

        insert into public.qb_deals (id, workspace_id)
        values
          ('10000000-0000-0000-0000-000000000001', 'default'),
          ('10000000-0000-0000-0000-000000000002', 'default'),
          ('10000000-0000-0000-0000-000000000003', 'default');

        insert into public.trade_valuations (
          id, workspace_id, deal_id, make, auction_value, reconditioning_estimate, suggested_resale_price
        ) values
          ('20000000-0000-0000-0000-000000000001', 'default', '10000000-0000-0000-0000-000000000001', 'ASV', 10000, 1000, 10000),
          ('20000000-0000-0000-0000-000000000002', 'default', '10000000-0000-0000-0000-000000000002', 'ASV', 10000, null, 10000),
          ('20000000-0000-0000-0000-000000000003', 'default', '10000000-0000-0000-0000-000000000003', 'ASV', 10000, 1000, 10000);

        insert into public.qb_trade_ins (
          id, workspace_id, deal_id, make, allowance_cents, book_value_cents, disposition, trade_valuation_id
        ) values
          ('30000000-0000-0000-0000-000000000001', 'default', '10000000-0000-0000-0000-000000000001', 'ASV', 950000, null, 'keep_recondition', '20000000-0000-0000-0000-000000000001'),
          ('30000000-0000-0000-0000-000000000002', 'default', '10000000-0000-0000-0000-000000000002', 'ASV', 950000, null, 'keep_recondition', '20000000-0000-0000-0000-000000000002'),
          ('30000000-0000-0000-0000-000000000003', 'default', '10000000-0000-0000-0000-000000000003', 'ASV', 950000, 500000, 'keep_recondition', '20000000-0000-0000-0000-000000000003');

        do $$
        begin
	          if (
	            select reconditioning_approval_status
	            from public.qb_trade_ins
	            where id = '30000000-0000-0000-0000-000000000001'
	          ) <> 'pending' then
	            raise exception 'low-margin trade should sync to pending approval';
	          end if;

          if (
            select reconditioning_approval_status
            from public.qb_trade_ins
            where id = '30000000-0000-0000-0000-000000000003'
          ) <> 'not_required' then
            raise exception 'high customer allowance alone should not force approval when true cost margin is healthy';
          end if;

          if (
            select expected_gross_margin_pct
            from public.trade_valuations
            where id = '20000000-0000-0000-0000-000000000003'
          ) <> 40.00 then
            raise exception 'expected margin should use book value, not customer allowance';
          end if;

          update public.qb_trade_ins
          set book_value_cents = 950000
          where id = '30000000-0000-0000-0000-000000000003';

          if (
            select reconditioning_approval_status
            from public.qb_trade_ins
            where id = '30000000-0000-0000-0000-000000000003'
          ) <> 'pending' then
            raise exception 'book value correction should resync margin approval state';
          end if;

          begin
            update public.qb_trade_ins
            set
              reconditioning_approval_status = 'approved',
              reconditioning_approved_by = '00000000-0000-0000-0000-0000000000a1',
              reconditioning_approved_at = now()
            where id = '30000000-0000-0000-0000-000000000001';
            raise exception 'direct approval-state write should fail';
          exception
	            when insufficient_privilege then
	              null;
	          end;

          begin
            update public.trade_valuations
            set expected_gross_margin_pct = 99
            where id = '20000000-0000-0000-0000-000000000001';
            raise exception 'direct expected-margin write should fail';
          exception
            when insufficient_privilege then
              null;
          end;
        end $$;

        do $$
        begin
          begin
            perform public.record_trade_recondition_manager_approval(
              '30000000-0000-0000-0000-000000000004',
              '00000000-0000-0000-0000-0000000000d1',
              'Cross-workspace approval should be rejected',
              '{}'::jsonb
            );
            raise exception 'cross-workspace trade approval should fail';
          exception
            when insufficient_privilege then
              null;
          end;

          begin
            perform public.record_trade_recondition_manager_approval(
              '30000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-0000000000d1',
              'Cross-workspace approver should be rejected',
              '{}'::jsonb
            );
            raise exception 'cross-workspace approver should fail';
          exception
            when insufficient_privilege then
              null;
          end;
        end $$;

        select public.record_trade_recondition_manager_approval(
          '30000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1',
          'Ryan approved low-margin represented-brand reconditioning path',
          '{}'::jsonb
        );

        select public.record_trade_recondition_manager_approval(
          '30000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-0000000000a1',
          'Ryan approved pending estimate path',
          '{}'::jsonb
        );

        update public.trade_valuations
        set reconditioning_estimate = 500
        where id = '20000000-0000-0000-0000-000000000002';

        do $$
        declare
          v_audit_id uuid;
        begin
          if (
            select reconditioning_approval_status
            from public.qb_trade_ins
            where id = '30000000-0000-0000-0000-000000000001'
          ) <> 'approved' then
            raise exception 'manager approval rpc should mark first trade approved';
          end if;

          if (
            select reconditioning_approval_status
            from public.qb_trade_ins
            where id = '30000000-0000-0000-0000-000000000002'
          ) <> 'stale' then
            raise exception 'null-to-value recon estimate should stale prior approval';
          end if;

          select id into v_audit_id
          from public.trade_recondition_approval_audit
          where qb_trade_in_id = '30000000-0000-0000-0000-000000000001'
          limit 1;

          begin
            update public.trade_recondition_approval_audit
            set reason = 'mutated'
            where id = v_audit_id;
            raise exception 'audit mutation should fail';
          exception
            when others then
              if sqlerrm not like '%VALIDATION_TRADE_RECONDITION_APPROVAL_AUDIT_APPEND_ONLY%' then
                raise;
              end if;
          end;
	        end $$;
	      `);

      const deniedQueries = [
        "select expected_gross_margin_pct from public.trade_valuations limit 1",
        "select reconditioning_approval_status from public.qb_trade_ins limit 1",
        "select public.qep_trade_sync_recondition_state('30000000-0000-0000-0000-000000000001')",
      ];

      for (const deniedQuery of deniedQueries) {
        let denied = false;
        try {
          psql(`
            set role authenticated;
            set request.jwt.claim.role = 'authenticated';
            set request.jwt.claim.qep_role = 'rep';
            set request.jwt.claim.workspace_id = 'default';
            ${deniedQuery};
          `);
        } catch (error) {
          denied = String(error).toLowerCase().includes("permission denied");
        }
        expect(denied).toBe(true);
      }
	    });
	  });
	});
