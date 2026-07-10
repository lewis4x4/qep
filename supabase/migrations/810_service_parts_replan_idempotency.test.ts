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
  "810_service_parts_replan_idempotency.sql",
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
  return match?.[0].replace(/\s+/g, " ").toLowerCase() ?? "";
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
      ].filter(Boolean).join("\n"),
    );
  }
  return result.stdout;
}

function withScratchPostgres(
  callback: (
    psql: (sql: string) => string,
    connectionString: string,
  ) => void,
): void {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test invoked without server binaries");
  }
  const root = mkdtempSync(join(tmpdir(), "qep-service-parts-810-"));
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
      const path = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(path, sqlText);
      return runCommand(psqlPath, [
        "-v",
        "ON_ERROR_STOP=1",
        ...connectionArgs,
        "-f",
        path,
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
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
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
  select coalesce(nullif(current_setting('request.jwt.claim.workspace_id', true), ''), 'default')
$$;
create or replace function public.get_my_role()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.qep_role', true), ''), 'rep')
$$;
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create type public.service_parts_action_type as enum (
  'pick', 'transfer', 'order', 'substitute', 'receive', 'stage', 'consume', 'return'
);

create table public.service_jobs (
  id uuid primary key,
  workspace_id text not null,
  branch_id uuid,
  scheduled_start_at timestamptz,
  parts_delay_expected_at timestamptz
);
create table public.service_parts_requirements (
  id uuid primary key,
  workspace_id text not null,
  job_id uuid not null references public.service_jobs(id),
  part_number text not null,
  quantity integer not null default 1,
  vendor_id uuid,
  unit_cost numeric(10,2),
  status text not null default 'pending',
  intake_line_status text not null default 'accepted',
  need_by_date timestamptz,
  updated_at timestamptz not null default now()
);
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  po_number text not null,
  vendor_id uuid,
  status text not null default 'draft',
  order_type text not null default 'special_order',
  ordered_by uuid,
  ordered_at timestamptz,
  expected_at timestamptz,
  subtotal_cents bigint not null default 0,
  freight_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  purchase_order_id uuid not null references public.purchase_orders(id),
  line_number integer not null,
  part_number text not null,
  qty_ordered numeric(14,4) not null default 0,
  qty_received numeric(14,4) not null default 0,
  unit_cost_cents bigint not null default 0,
  expected_at timestamptz,
  status text not null default 'open',
  service_parts_requirement_id uuid references public.service_parts_requirements(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, line_number)
);
create table public.service_parts_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  requirement_id uuid not null references public.service_parts_requirements(id),
  job_id uuid not null references public.service_jobs(id),
  action_type public.service_parts_action_type not null,
  actor_id uuid,
  from_branch text,
  to_branch text,
  vendor_id uuid,
  po_reference text,
  expected_date timestamptz,
  completed_at timestamptz,
  superseded_at timestamptz,
  plan_batch_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.parts_locations (
  id uuid primary key,
  workspace_id text not null,
  branch_id uuid,
  branch_slug text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.parts (
  id uuid primary key,
  workspace_id text not null,
  part_number text not null,
  deleted_at timestamptz
);
create table public.parts_stock (
  id uuid primary key,
  workspace_id text not null,
  part_id uuid not null references public.parts(id),
  location_id uuid not null references public.parts_locations(id),
  branch_slug text,
  qty_on_hand numeric(14,4) not null default 0,
  qty_reserved numeric(14,4) not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.parts_transfers (
  id uuid primary key,
  workspace_id text not null,
  status text not null,
  deleted_at timestamptz
);
create table public.parts_transfer_lines (
  id uuid primary key,
  workspace_id text not null,
  transfer_id uuid not null references public.parts_transfers(id),
  status text not null,
  qty_reserved numeric(14,4) not null default 0,
  metadata jsonb not null default '{}'::jsonb
);
create table public.traffic_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  stock_number text,
  equipment_id uuid,
  from_location text,
  to_location text,
  to_contact_name text,
  to_contact_phone text,
  shipping_date date,
  department text,
  billing_comments text,
  ticket_type text,
  status text,
  requested_by uuid,
  service_job_id uuid,
  created_at timestamptz not null default now()
);
create table public.exception_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  source text not null,
  severity text not null,
  title text not null,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  entity_table text,
  entity_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.qep_resolve_parts_stock_row(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_create boolean default false
)
returns uuid language sql security definer set search_path = '' as $$
  select s.id
  from public.parts_stock s
  join public.parts p on p.id = s.part_id and p.workspace_id = s.workspace_id
  join public.parts_locations l on l.id = s.location_id and l.workspace_id = s.workspace_id
  where s.workspace_id = p_workspace_id
    and p.part_number = p_part_number
    and s.deleted_at is null
    and l.deleted_at is null
    and (l.id::text = p_branch_id or l.branch_id::text = p_branch_id or l.branch_slug = p_branch_id)
  order by s.id
  limit 1
$$;
create or replace function public.adjust_parts_inventory_delta_strict(text, text, text, integer)
returns void language plpgsql security definer as $$ begin return; end $$;
create or replace function public.reserve_service_part(text, text, text, integer)
returns boolean language plpgsql security definer as $$ begin return false; end $$;
create or replace function public.release_service_part_reservation(text, text, text, integer)
returns void language plpgsql security definer as $$ begin return; end $$;
create or replace function public.consume_reserved_part(text, text, text, integer)
returns void language plpgsql security definer as $$ begin return; end $$;

grant execute on function public.qep_resolve_parts_stock_row(text, text, text, boolean) to authenticated, service_role;
grant execute on function public.adjust_parts_inventory_delta_strict(text, text, text, integer) to authenticated, service_role;
grant execute on function public.reserve_service_part(text, text, text, integer) to authenticated, service_role;
grant execute on function public.release_service_part_reservation(text, text, text, integer) to authenticated, service_role;
grant execute on function public.consume_reserved_part(text, text, text, integer) to authenticated, service_role;

insert into public.service_jobs (id, workspace_id, branch_id) values
  ('10000000-0000-4000-8000-000000000001', 'default', '20000000-0000-4000-8000-000000000001');
insert into public.service_parts_requirements (
  id, workspace_id, job_id, part_number, quantity, unit_cost, status, intake_line_status
) values (
  '30000000-0000-4000-8000-000000000001', 'default',
  '10000000-0000-4000-8000-000000000001', 'P1', 1, 1.00, 'pending', 'accepted'
);
insert into public.parts_locations (id, workspace_id, branch_id, branch_slug) values
  ('40000000-0000-4000-8000-000000000001', 'default',
   '20000000-0000-4000-8000-000000000001', 'main');
insert into public.parts (id, workspace_id, part_number) values
  ('50000000-0000-4000-8000-000000000001', 'default', 'P1'),
  ('50000000-0000-4000-8000-000000000002', 'default', 'ORPHAN');
insert into public.parts_stock (
  id, workspace_id, part_id, location_id, branch_slug, qty_on_hand, qty_reserved
) values
  ('60000000-0000-4000-8000-000000000001', 'default',
   '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'main', 10, 5),
  ('60000000-0000-4000-8000-000000000002', 'default',
   '50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001',
   'main', 10, 1);
insert into public.service_parts_actions (
  id, workspace_id, requirement_id, job_id, action_type
) values (
  '70000000-0000-4000-8000-000000000001', 'default',
  '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'pick'
);
insert into public.parts_transfers (id, workspace_id, status) values
  ('80000000-0000-4000-8000-000000000001', 'default', 'requested');
insert into public.parts_transfer_lines (
  id, workspace_id, transfer_id, status, qty_reserved, metadata
) values (
  '90000000-0000-4000-8000-000000000001', 'default',
  '80000000-0000-4000-8000-000000000001', 'open', 2,
  jsonb_build_object('reserved_from_stock_id', '60000000-0000-4000-8000-000000000001')
);
`;

describe("810 service parts re-plan idempotency", () => {
  it("adds durable identities and one-active-demand database invariants", () => {
    expect(compactSql).toContain(
      "add column if not exists service_demand_key text",
    );
    expect(compactSql).toContain(
      "add column if not exists demand_fingerprint text",
    );
    expect(compactSql).toContain(
      "add column if not exists demand_version integer not null default 1",
    );
    expect(compactSql).toContain(
      "create unique index if not exists uq_service_parts_actions_active_demand on public.service_parts_actions (workspace_id, requirement_id)",
    );
    expect(compactSql).toContain(
      "create unique index if not exists uq_purchase_order_lines_active_service_demand on public.purchase_order_lines (workspace_id, service_demand_key)",
    );
    expect(compactSql).toContain(
      "validate constraint service_parts_actions_demand_identity_chk",
    );
    expect(compactSql).toContain(
      "validate constraint purchase_order_lines_service_demand_identity_chk",
    );
  });

  it("records one auditable active shelf reservation per requirement", () => {
    expect(compactSql).toContain(
      "create table if not exists public.service_parts_reservations",
    );
    expect(compactSql).toContain(
      "create unique index if not exists uq_service_parts_reservations_active_requirement on public.service_parts_reservations (workspace_id, requirement_id) where status = 'active'",
    );
    expect(compactSql).toContain(
      "on conflict (workspace_id, requirement_id) where status = 'active' do update set",
    );
    expect(compactSql).toContain(
      "perform public.release_service_part_reservation(",
    );
    expect(compactSql).toContain("select public.reserve_service_part(");
  });

  it("closes direct SECURITY DEFINER stock mutation and enforces tenant scope", () => {
    expect(compactSql).toContain(
      "revoke execute on function public.qep_resolve_parts_stock_row(text, text, text, boolean) from public, anon, authenticated",
    );
    expect(compactSql).toContain(
      "revoke execute on function public.release_service_part_reservation(text, text, text, integer) from public, anon, authenticated",
    );
    expect(compactSql).toContain(
      "revoke execute on function public.consume_reserved_part(text, text, text, integer) from public, anon, authenticated",
    );
    expect(compactSql).not.toContain(
      "grant execute on function public.release_service_part_reservation(text, text, text, integer) to authenticated",
    );
    expect(compactSql).not.toContain(
      "grant execute on function public.consume_reserved_part(text, text, text, integer) to authenticated",
    );

    for (
      const helper of [
        "adjust_parts_inventory_delta_strict",
        "reserve_service_part",
        "release_service_part_reservation",
        "consume_reserved_part",
      ]
    ) {
      const fn = functionSql(helper);
      expect(fn).toContain("security definer");
      expect(fn).toContain("set search_path = ''");
      expect(fn).toContain(
        "p_workspace_id is distinct from public.get_my_workspace()",
      );
      expect(fn).toContain("auth.uid() is null");
      expect(fn).toContain("'service_writer', 'dispatch'");
      expect(fn).toContain("'parts_counter'");
      expect(fn).toContain("and workspace_id = p_workspace_id");
    }
  });

  it("rebuilds legacy qty_reserved from durable owners and audits every correction", () => {
    expect(compactSql).toContain("with service_owned as (");
    expect(compactSql).toContain("transfer_owned as (");
    expect(compactSql).toContain(
      "sum(r.quantity)::numeric as owned_quantity",
    );
    expect(compactSql).toContain(
      "sum(l.qty_reserved)::numeric as owned_quantity",
    );
    expect(compactSql).toContain(
      "set qty_reserved = expected.quantity_after",
    );
    expect(compactSql).toContain(
      "parts reservation ownership reconciled during migration 810",
    );
    expect(compactSql).toContain("'released_unowned_quantity'");
    expect(compactSql).toContain("'restored_missing_quantity'");
    expect(compactSql).toContain("'data_quality'");
  });

  it("serializes concurrent callers at the job boundary in a short RPC", () => {
    const fn = functionSql("reconcile_service_parts_plan");
    expect(fn).toContain("security definer");
    expect(fn).toContain(
      "perform pg_advisory_xact_lock( hashtext('service_parts_plan:' || p_workspace_id), hashtext(p_job_id::text) )",
    );
    expect(fn).toContain("for update");
    expect(fn).toContain("on conflict do nothing");

    const requirementLock = fn.indexOf(
      "from public.service_parts_requirements r where r.workspace_id = p_workspace_id and r.job_id = p_job_id order by r.id for update",
    );
    const jobLock = fn.indexOf(
      "from public.service_jobs where id = p_job_id and workspace_id = p_workspace_id for update",
    );
    const stockLock = fn.indexOf(
      "from public.parts_stock s where s.id = v_stock_id and s.workspace_id = p_workspace_id for update",
    );
    expect(requirementLock).toBeGreaterThanOrEqual(0);
    expect(jobLock).toBeGreaterThan(requirementLock);
    expect(stockLock).toBeGreaterThan(jobLock);
    expect(fn).toContain("order by s.id");
    expect(fn).toContain("order by item->>'requirement_id'");
  });

  it("rejects terminal/post-procurement requirements inside the definer RPC", () => {
    const fn = functionSql("reconcile_service_parts_plan");
    expect(fn).toContain(
      "r.status not in ('pending', 'picking', 'transferring', 'ordering')",
    );
    expect(fn).toContain(
      "raise exception 'plan contains terminal or ineligible service requirement'",
    );
    expect(fn).toContain(
      "and status in ('pending', 'picking', 'transferring', 'ordering')",
    );
  });

  it("keeps PO header, line, action reference, and replacement audit atomic", () => {
    const fn = functionSql("reconcile_service_parts_plan");
    expect(fn).toContain("insert into public.purchase_orders");
    expect(fn).toContain("insert into public.purchase_order_lines");
    expect(fn).toContain("insert into public.service_parts_actions");
    expect(fn).toContain("purchase_order_id, purchase_order_line_id");
    expect(fn).toContain(
      "po_reference = case when v_action_type = 'order' then v_po_number else null end",
    );
    expect(fn).toContain("service_part_demand_already_received");
    expect(fn).not.toContain("exception when others");
  });

  it("creates transfer tickets inside the same transaction", () => {
    const fn = functionSql("reconcile_service_parts_plan");
    expect(fn).toContain("insert into public.traffic_tickets");
    expect(fn).toContain("'traffic_ticket_id', v_traffic_ticket_id");
  });

  it("enforces user, workspace, and service-parts role authorization", () => {
    const fn = functionSql("reconcile_service_parts_plan");
    expect(fn).toContain(
      "if auth.uid() is null or auth.uid() is distinct from p_actor_id then",
    );
    expect(fn).toContain(
      "p_workspace_id is distinct from public.get_my_workspace()",
    );
    expect(fn).toContain("'parts_counter'");
    expect(compactSql).toContain(
      "revoke execute on function public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb) from public, anon, service_role",
    );
    expect(compactSql).toContain(
      "grant execute on function public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb) to authenticated",
    );
  });

  it("wraps schema changes in one migration transaction", () => {
    expect(compactSql.startsWith("-- migration 810")).toBe(true);
    expect(compactSql).toContain("begin;");
    expect(compactSql.trim().endsWith("commit;")).toBe(true);
  });
});

postgresBehavior("810 service parts behavior on scratch Postgres", () => {
  it("enforces privileges, repairs ownership, permits parts-counter picks, and rejects terminal plans", () => {
    withScratchPostgres((psql, connectionString) => {
      psql(scratchSchemaSql);
      psql(`\\i ${migrationPath}`);
      psql(`
        do $$
        begin
          if (
            select qty_reserved
            from public.parts_stock
            where id = '60000000-0000-4000-8000-000000000001'
          ) <> 3 then
            raise exception 'known service + transfer ownership should rebuild qty_reserved to 3';
          end if;
          if (
            select qty_reserved
            from public.parts_stock
            where id = '60000000-0000-4000-8000-000000000002'
          ) <> 0 then
            raise exception 'unowned legacy reservation should be released';
          end if;
          if (select count(*) from public.exception_queue) <> 2 then
            raise exception 'every migration reservation correction must be audited';
          end if;
          if (
            select count(*)
            from public.service_parts_reservations
            where status = 'active'
          ) <> 1 then
            raise exception 'legacy open pick must own exactly one durable hold';
          end if;

          if has_function_privilege(
            'authenticated',
            'public.qep_resolve_parts_stock_row(text,text,text,boolean)',
            'EXECUTE'
          ) then
            raise exception 'authenticated must not execute stock resolver/create primitive';
          end if;
          if has_function_privilege(
            'authenticated',
            'public.release_service_part_reservation(text,text,text,integer)',
            'EXECUTE'
          ) then
            raise exception 'authenticated must not bypass reservation release ledger';
          end if;
          if has_function_privilege(
            'authenticated',
            'public.consume_reserved_part(text,text,text,integer)',
            'EXECUTE'
          ) then
            raise exception 'authenticated must not bypass reservation consume ledger';
          end if;
        end $$;

        insert into public.service_jobs (id, workspace_id, branch_id) values
          ('10000000-0000-4000-8000-000000000002', 'default', '20000000-0000-4000-8000-000000000001'),
          ('10000000-0000-4000-8000-000000000003', 'default', '20000000-0000-4000-8000-000000000001');
        insert into public.service_parts_requirements (
          id, workspace_id, job_id, part_number, quantity, unit_cost, status, intake_line_status
        ) values
          ('30000000-0000-4000-8000-000000000002', 'default',
           '10000000-0000-4000-8000-000000000002', 'P1', 1, 1.00, 'pending', 'accepted'),
          ('30000000-0000-4000-8000-000000000003', 'default',
           '10000000-0000-4000-8000-000000000003', 'P1', 1, 1.00, 'consumed', 'planned');

        set request.jwt.claim.role = 'authenticated';
        set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
        set request.jwt.claim.workspace_id = 'default';
        set request.jwt.claim.qep_role = 'parts_counter';
        set role authenticated;

        do $$
        declare
          v_result jsonb;
        begin
          begin
            perform public.adjust_parts_inventory_delta_strict(
              'other',
              '20000000-0000-4000-8000-000000000001',
              'P1',
              0
            );
            raise exception 'cross-workspace stock mutation should fail';
          exception
            when insufficient_privilege then null;
          end;

          perform public.adjust_parts_inventory_delta_strict(
            'default',
            '20000000-0000-4000-8000-000000000001',
            'P1',
            0
          );

          v_result := public.reconcile_service_parts_plan(
            'default',
            '10000000-0000-4000-8000-000000000002',
            'a0000000-0000-4000-8000-000000000001',
            'b0000000-0000-4000-8000-000000000001',
            jsonb_build_array(jsonb_build_object(
              'requirement_id', '30000000-0000-4000-8000-000000000002',
              'action_type', 'pick',
              'next_line_status', 'picking',
              'from_branch', null,
              'to_branch', null,
              'expected_date', null,
              'need_by_date', '2026-07-10T12:00:00Z',
              'vendor_id', null,
              'part_number', 'P1',
              'quantity', 1,
              'unit_cost_cents', 100,
              'demand_key', 'service-requirement:30000000-0000-4000-8000-000000000002',
              'demand_fingerprint', 'v1|pick|-|P1|1|100|-|-',
              'metadata', '{}'::jsonb
            ))
          );
          if (v_result->>'actions_created')::integer <> 1 then
            raise exception 'parts_counter should create one locally reserved pick';
          end if;

          begin
            perform public.reconcile_service_parts_plan(
              'default',
              '10000000-0000-4000-8000-000000000003',
              'a0000000-0000-4000-8000-000000000001',
              'b0000000-0000-4000-8000-000000000002',
              jsonb_build_array(jsonb_build_object(
                'requirement_id', '30000000-0000-4000-8000-000000000003',
                'action_type', 'pick',
                'next_line_status', 'picking',
                'part_number', 'P1',
                'quantity', 1,
                'unit_cost_cents', 100,
                'demand_key', 'service-requirement:30000000-0000-4000-8000-000000000003',
                'demand_fingerprint', 'v1|pick|-|P1|1|100|-|-',
                'metadata', '{}'::jsonb
              ))
            );
            raise exception 'terminal requirement should not be replanned';
          exception
            when invalid_parameter_value then null;
          end;
        end $$;

        reset role;

        do $$
        begin
          if (
            select qty_reserved
            from public.parts_stock
            where id = '60000000-0000-4000-8000-000000000001'
          ) <> 4 then
            raise exception 'parts-counter planner call should place one additional hold';
          end if;
          if (
            select count(*)
            from public.service_parts_reservations
            where status = 'active'
          ) <> 2 then
            raise exception 'new local pick should have one durable reservation row';
          end if;
        end $$;
      `);

      // Reproduce the historical inverse-lock race with two real database
      // sessions. The fulfillment-shaped session holds requirement then asks
      // for job; the planner must wait on that requirement before it can own
      // the job. If reconcile regresses to job -> requirement, PostgreSQL
      // deadlocks these sessions and dblink_get_result fails the test.
      psql(`
        create extension if not exists dblink;
        insert into public.service_jobs (id, workspace_id, branch_id) values (
          '10000000-0000-4000-8000-000000000004', 'default',
          '20000000-0000-4000-8000-000000000001'
        );
        insert into public.service_parts_requirements (
          id, workspace_id, job_id, part_number, quantity, unit_cost, status, intake_line_status
        ) values (
          '30000000-0000-4000-8000-000000000004', 'default',
          '10000000-0000-4000-8000-000000000004', 'P1', 1, 1.00, 'pending', 'accepted'
        );

        create or replace function public.test_810_fulfillment_lock_order()
        returns integer language plpgsql as $$
        begin
          perform 1
          from public.service_parts_requirements
          where id = '30000000-0000-4000-8000-000000000004'
          for update;
          perform pg_sleep(0.5);
          perform 1
          from public.service_jobs
          where id = '10000000-0000-4000-8000-000000000004'
          for update;
          return 1;
        end $$;

        create or replace function public.test_810_planner_lock_order()
        returns jsonb language plpgsql as $$
        begin
          perform set_config('request.jwt.claim.role', 'authenticated', true);
          perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
          perform set_config('request.jwt.claim.workspace_id', 'default', true);
          perform set_config('request.jwt.claim.qep_role', 'parts_counter', true);
          return public.reconcile_service_parts_plan(
            'default',
            '10000000-0000-4000-8000-000000000004',
            'a0000000-0000-4000-8000-000000000001',
            'b0000000-0000-4000-8000-000000000004',
            '[]'::jsonb
          );
        end $$;

        select dblink_connect('fulfillment', '${connectionString}');
        select dblink_connect('planner', '${connectionString}');
        select dblink_send_query(
          'fulfillment',
          'select public.test_810_fulfillment_lock_order()'
        );
        select pg_sleep(0.1);
        select dblink_send_query(
          'planner',
          'select public.test_810_planner_lock_order()'
        );

        do $$
        begin
          for attempt in 1..100 loop
            exit when dblink_is_busy('fulfillment') = 0
              and dblink_is_busy('planner') = 0;
            perform pg_sleep(0.05);
          end loop;
          if dblink_is_busy('fulfillment') <> 0
            or dblink_is_busy('planner') <> 0
          then
            raise exception 'concurrent lock-order test timed out';
          end if;
        end $$;

        select *
        from dblink_get_result('fulfillment') as result(value integer);
        select *
        from dblink_get_result('planner') as result(value jsonb);
        select dblink_disconnect('fulfillment');
        select dblink_disconnect('planner');
      `);
    });
  });
});
