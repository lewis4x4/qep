import { describe, expect, it } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
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
  "812_a75_open_quote_impact_hardening.sql",
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
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

function postgresBin(name: string): string | null {
  const candidates = [
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/bin",
    "/usr/local/opt/postgresql@16/bin",
    "/usr/local/bin",
  ];
  for (const directory of candidates) {
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
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      `exit=${result.status}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function withScratchPostgres(
  callback: (psql: (sqlText: string) => string) => void,
): void {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test invoked without Postgres binaries");
  }
  const root = mkdtempSync(join(tmpdir(), "qep-a7-812-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(25000 + Math.floor(Math.random() * 10_000));
  const connectionArgs = [
    "-h", socketDir, "-p", port, "-U", "postgres", "-d", "postgres",
  ];
  try {
    mkdirSync(socketDir);
    runCommand(initdbPath, [
      "-D", dataDir, "--auth=trust", "--username=postgres",
    ]);
    runCommand(pgCtlPath, [
      "-D", dataDir,
      "-o", `-F -k ${socketDir} -p ${port} -c listen_addresses=''`,
      "-l", logPath,
      "start",
    ]);
    const psql = (sqlText: string): string => {
      const sqlPath = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(sqlPath, sqlText);
      return runCommand(psqlPath, [
        "-v", "ON_ERROR_STOP=1", ...connectionArgs, "-f", sqlPath,
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

function runCommandAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0) return resolve(stdout);
      reject(new Error([
        `Command failed: ${command} ${args.join(" ")}`,
        `exit=${status}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n")));
    });
  });
}

async function withScratchPostgresAsync(
  callback: (
    psql: (sqlText: string) => string,
    startPsql: (sqlText: string) => Promise<string>,
  ) => Promise<void>,
): Promise<void> {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test invoked without Postgres binaries");
  }
  const root = mkdtempSync(join(tmpdir(), "qep-a7-812-concurrent-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(25000 + Math.floor(Math.random() * 10_000));
  const connectionArgs = [
    "-h", socketDir, "-p", port, "-U", "postgres", "-d", "postgres",
  ];
  const sqlFile = (sqlText: string): string => {
    const sqlPath = join(
      root,
      `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
    );
    writeFileSync(sqlPath, sqlText);
    return sqlPath;
  };
  try {
    mkdirSync(socketDir);
    runCommand(initdbPath, [
      "-D", dataDir, "--auth=trust", "--username=postgres",
    ]);
    runCommand(pgCtlPath, [
      "-D", dataDir,
      "-o", `-F -k ${socketDir} -p ${port} -c listen_addresses=''`,
      "-l", logPath,
      "start",
    ]);
    const psql = (sqlText: string): string =>
      runCommand(psqlPath, [
        "-v", "ON_ERROR_STOP=1", ...connectionArgs, "-f", sqlFile(sqlText),
      ]);
    const startPsql = (sqlText: string): Promise<string> =>
      runCommandAsync(psqlPath, [
        "-v", "ON_ERROR_STOP=1", ...connectionArgs, "-f", sqlFile(sqlText),
      ]);
    await callback(psql, startPsql);
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
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
$$;
create or replace function public.get_my_workspace() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.workspace_id', true), '');
$$;
create or replace function public.get_my_role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.user_role', true), '');
$$;

create table public.qb_brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  code text not null,
  name text not null
);
create table public.qb_price_sheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  brand_id uuid references public.qb_brands(id),
  status text not null,
  sheet_type text,
  effective_from date,
  effective_to date,
  published_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  supersedes_price_sheet_id uuid references public.qb_price_sheets(id)
);
create table public.qrm_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  price_lock_active boolean not null default false,
  price_lock_reason text,
  price_lock_expires_at date,
  deleted_at timestamptz
);
create table public.qrm_deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  company_id uuid references public.qrm_companies(id),
  assigned_rep_id uuid,
  deleted_at timestamptz
);
create table public.quote_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  deal_id uuid references public.qrm_deals(id),
  created_by uuid,
  status text not null,
  equipment jsonb not null default '[]'::jsonb,
  net_total numeric default 0,
  margin_amount numeric default 0,
  margin_pct numeric default 0,
  delivery_state text,
  selected_promotion_ids uuid[] not null default '{}',
  requires_requote boolean not null default false,
  requote_reason text,
  updated_at timestamptz not null default now()
);
create table public.quote_package_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  make text,
  model text,
  quantity integer not null default 1,
  quoted_list_price numeric,
  quoted_dealer_cost numeric,
  source_location text,
  line_type text not null
);

create table public.qb_price_change_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  brand_id uuid not null references public.qb_brands(id),
  price_sheet_id uuid not null unique references public.qb_price_sheets(id),
  prior_price_sheet_id uuid references public.qb_price_sheets(id),
  source_type text,
  source_metadata jsonb not null default '{}'::jsonb,
  effective_date date,
  materiality_rule jsonb not null default '{}'::jsonb,
  approval_policy jsonb not null default '{}'::jsonb,
  status text not null,
  created_by uuid,
  published_at timestamptz
);
create table public.qb_price_change_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.qb_price_change_events(id) on delete cascade,
  workspace_id text not null,
  item_type text not null,
  model_code text,
  normalized_code text,
  name_display text,
  old_price_cents bigint,
  new_price_cents bigint,
  delta_cents bigint not null default 0,
  delta_pct numeric,
  change_kind text not null,
  prior_item_id uuid,
  new_item_id uuid,
  metadata jsonb not null default '{}'::jsonb
);
create table public.qb_quote_reprice_impacts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.qb_price_change_events(id) on delete cascade,
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  deal_id uuid,
  assigned_rep_id uuid,
  quote_status_snapshot text,
  quote_updated_at_snapshot timestamptz,
  total_delta_cents bigint not null default 0,
  max_line_delta_pct numeric,
  old_margin_pct numeric,
  projected_margin_pct numeric,
  margin_floor_pct numeric,
  below_margin_floor boolean not null default false,
  materiality_trigger text,
  requires_manager_review boolean not null default false,
  approval_required_reasons text[] not null default '{}',
  old_commission_cents bigint,
  projected_commission_cents bigint,
  commission_delta_cents bigint,
  state text not null,
  dismissed_reason text,
  created_at timestamptz not null default now()
);
create table public.qb_quote_reprice_impact_lines (
  id uuid primary key default gen_random_uuid(),
  impact_id uuid not null references public.qb_quote_reprice_impacts(id) on delete cascade,
  quote_package_line_item_id uuid references public.quote_package_line_items(id),
  equipment_line_id text,
  model_code text not null,
  make text,
  quantity integer not null default 1,
  old_list_price_cents bigint,
  new_list_price_cents bigint,
  delta_cents bigint not null default 0,
  delta_pct numeric,
  source_location text,
  is_yard_stock boolean not null default false,
  suppressed_by_stock_lock boolean not null default false,
  suppression_reason text,
  metadata jsonb not null default '{}'::jsonb
);

create table public.qb_equipment_models (
  id uuid primary key default gen_random_uuid(), workspace_id text not null,
  brand_id uuid not null, model_code text not null, family text, name_display text,
  standard_config text, list_price_cents bigint not null, specs jsonb, active boolean not null default true
);
create table public.qb_attachments (
  id uuid primary key default gen_random_uuid(), workspace_id text not null,
  brand_id uuid not null, part_number text not null, name text not null, category text,
  list_price_cents bigint not null, compatible_model_ids uuid[], attachment_type text,
  active boolean not null default true
);
create table public.qb_freight_zones (
  id uuid primary key default gen_random_uuid(), workspace_id text not null,
  brand_id uuid not null, zone_name text not null, state_codes text[] not null,
  freight_large_cents bigint not null, freight_small_cents bigint not null,
  effective_from date, effective_to date
);
create table public.qb_programs (
  id uuid primary key default gen_random_uuid(), workspace_id text not null,
  brand_id uuid not null, program_code text not null, program_type text not null,
  name text not null, effective_from date, effective_to date, details jsonb,
  active boolean not null default true
);
create table public.qb_price_sheet_items (
  id uuid primary key default gen_random_uuid(),
  price_sheet_id uuid not null references public.qb_price_sheets(id),
  item_type text not null, action text not null, review_status text not null,
  extracted jsonb not null, proposed_model_id uuid, proposed_attachment_id uuid,
  applied_at timestamptz
);
create table public.qb_price_sheet_programs (
  id uuid primary key default gen_random_uuid(),
  price_sheet_id uuid not null references public.qb_price_sheets(id),
  program_code text not null, program_type text not null, action text not null,
  review_status text not null, extracted jsonb not null, proposed_program_id uuid,
  applied_at timestamptz
);
`;

describe("812 A7.5 atomic open-quote impact contract", () => {
  it("adds contextual categories, price-lock snapshots, and hot-path indexes", () => {
    expect(compactSql).toContain(
      "add column if not exists change_categories text[] not null",
    );
    expect(compactSql).toContain(
      "add column if not exists catalog_changes jsonb not null",
    );
    expect(compactSql).toContain(
      "add column if not exists suppressed_by_customer_lock boolean not null",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_qb_price_change_events_prior_sheet",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_qb_quote_reprice_impact_lines_quote_line",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_quote_packages_oem_open_keyset",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_qp_line_items_oem_scan_keyset",
    );
    expect(compactSql).toContain(
      "change_categories <@ array['list_price', 'freight', 'rebate', 'incentive']::text[]",
    );
  });

  it("persists every event mutation through one short transaction-scoped RPC", () => {
    const fn = functionSql("persist_qb_oem_price_change_event");
    expect(compactSql.trim().startsWith("-- migration 812")).toBe(true);
    expect(compactSql).toContain("begin;");
    expect(compactSql.trim().endsWith("commit;")).toBe(true);
    expect(fn).toContain("security definer");
    expect(fn).toContain("pg_advisory_xact_lock");
    expect(fn).toContain("insert into public.qb_price_change_events");
    expect(fn).toContain("insert into public.qb_price_change_items");
    expect(fn).toContain("insert into public.qb_quote_reprice_impacts");
    expect(fn).toContain("insert into public.qb_quote_reprice_impact_lines");
    expect(fn).toContain("update public.quote_packages quote");
    expect(fn).not.toContain("exception when others");
  });

  it("locks quotes, context, per-quote/workspace epochs, then events in deterministic order", () => {
    const fn = functionSql("persist_qb_oem_price_change_event");
    expect(fn).toContain("from public.qb_price_sheets s where s.id = p_price_sheet_id for update");
    const quoteLock = fn.indexOf("order by q.id for update");
    const lineLock = fn.indexOf("order by line.id for share");
    const dealLock = fn.indexOf("order by deal.id for share");
    const companyLock = fn.indexOf("order by company.id for share");
    const quoteEpochLock = fn.indexOf("order by epoch.quote_package_id for update");
    const workspaceEpochLock = fn.indexOf("from public.qb_workspace_pricing_epochs where workspace_id = p_workspace_id for update");
    const eventLock = fn.indexOf("order by event.id for update");
    expect(quoteLock).toBeGreaterThanOrEqual(0);
    expect(lineLock).toBeGreaterThan(quoteLock);
    expect(dealLock).toBeGreaterThan(lineLock);
    expect(companyLock).toBeGreaterThan(dealLock);
    expect(quoteEpochLock).toBeGreaterThan(companyLock);
    expect(workspaceEpochLock).toBeGreaterThan(quoteEpochLock);
    expect(eventLock).toBeGreaterThan(workspaceEpochLock);
    expect(fn).toContain("using errcode = '40001'");
    expect(fn).toContain("oem_scan_conflict: quote package changed during scan");
    expect(fn).toContain("oem_scan_conflict: an impacted quote line changed during scan");
    expect(fn).toContain("q.updated_at is distinct from");
  });

  it("enforces exact workspace/OEM identity and current unexpired customer locks", () => {
    const fn = functionSql("persist_qb_oem_price_change_event");
    expect(fn).toContain("v_sheet.workspace_id is distinct from p_workspace_id");
    expect(fn).toContain("v_sheet.brand_id is distinct from p_brand_id");
    expect(fn).toContain("canonical diff item is outside the requested workspace/oem scope");
    expect(fn).toContain("one or more impacts do not match the requested oem brand");
    expect(fn).toContain(
      "current customer company is inactive or cross-workspace",
    );
    expect(fn).toContain("company.workspace_id = p_workspace_id");
    expect(fn).toContain("company.deleted_at is null");
    expect(fn).toContain("regexp_replace(upper(coalesce(line.make, '')), '[^a-z0-9]+', '', 'g')");
    expect(fn).toContain("company.price_lock_active = true");
    expect(fn).toContain(
      "company.price_lock_expires_at is null or company.price_lock_expires_at >= current_date",
    );
    expect(fn).toContain("when computed.customer_lock_active then 'quiet'");
  });

  it("derives strict materiality and exact yard suppression inside SQL", () => {
    const fn = functionSql("persist_qb_oem_price_change_event");
    expect(fn).toContain("abs(computed.effective_line_pct) > 2");
    expect(fn).toContain("abs(computed.effective_delta) > 100000");
    expect(fn).not.toContain("abs(computed.effective_line_pct) >= 2");
    expect(fn).not.toContain("abs(computed.effective_delta) >= 100000");
    expect(fn).toContain("line_input ->> 'sourcelocation' = 'yard_stock'");
    expect(fn).toContain("calculated_delta");
    expect(fn).toContain("calculated_line_pct");
    expect(fn).toContain("'yard_stock_price_locked'");
  });

  it("is replay-safe and preserves another active event or non-OEM flag owner", () => {
    const fn = functionSql("persist_qb_oem_price_change_event");
    expect(fn).toContain("event.status not in ('active', 'closed')");
    expect(fn).toContain("'idempotent', true");
    expect(fn).toContain("quote.requote_reason <> v_requote_reason");
    expect(fn).toContain("event.status = 'active'");
    expect(fn).toContain("quote.requote_reason = v_requote_reason");
    expect(fn).toContain("and not exists");
  });

  it("pins lane-specific lineage and publishes every catalog mutation atomically", () => {
    const pin = functionSql("pin_qb_price_sheet_lineage");
    const publish = functionSql("publish_qb_price_sheet_atomic");
    const specs = functionSql("qb_has_meaningful_catalog_specs");
    expect(compactSql).toContain("primary key (price_sheet_id, lane)");
    expect(compactSql).toContain("unique (price_sheet_id, stream_kind)");
    expect(pin).toContain("price-sheet lineage changed concurrently");
    expect(pin).toContain("when 'both' then array['price_book', 'retail_programs']");
    expect(publish).toContain("price-sheet lineage must be pinned before publish");
    expect(publish).toContain("update public.qb_price_sheet_items set applied_at = v_now");
    expect(publish).toContain("update public.qb_price_sheet_programs set applied_at = v_now");
    expect(publish).toContain("public.qb_has_meaningful_catalog_specs");
    expect(specs).toContain("'ai_summary'");
    expect(specs).toContain("p_depth > 3");
    expect(publish).not.toContain("exception when others");
  });

  it("separates workspace scan completeness from per-quote draft invalidation", () => {
    expect(compactSql).toContain("create table if not exists public.qb_workspace_pricing_epochs");
    expect(compactSql).toContain("create table if not exists public.qb_quote_pricing_epochs");
    expect(compactSql).toContain("primary key (workspace_id, quote_package_id)");
    expect(functionSql("touch_qb_quote_pricing_epoch_from_deal")).toContain(
      "order by quote.workspace_id, quote.id",
    );
    expect(functionSql("touch_qb_quote_pricing_epoch_from_company")).toContain(
      "order by quote.workspace_id, quote.id",
    );
  });

  it("dismisses and recomputes the shared requote flag atomically", () => {
    const fn = functionSql("dismiss_qb_oem_reprice_impact");
    const quoteLock = fn.indexOf("from public.quote_packages quote");
    const dealLock = fn.indexOf("from public.qrm_deals deal", quoteLock);
    const impactLock = fn.indexOf(
      "from public.qb_quote_reprice_impacts impact",
      dealLock,
    );
    expect(quoteLock).toBeGreaterThanOrEqual(0);
    expect(dealLock).toBeGreaterThan(quoteLock);
    expect(impactLock).toBeGreaterThan(dealLock);
    expect(fn).toContain("for update");
    expect(fn).toContain("deal.deleted_at is null");
    expect(fn).toContain("v_deal.assigned_rep_id, v_quote.created_by");
    expect(fn).toContain("another current rep");
    expect(fn).not.toContain(
      "v_impact.assigned_rep_id is distinct from p_actor_id",
    );
    expect(fn).toContain("set state = 'dismissed'");
    expect(fn).toContain("quote.requote_reason = v_requote_reason");
    expect(fn).toContain("event.status = 'active'");
    expect(fn).toContain("'idempotent', true");
  });

  it("keeps mutation RPCs service-role-only", () => {
    for (
      const functionName of [
        "pin_qb_price_sheet_lineage",
        "publish_qb_price_sheet_atomic",
        "persist_qb_oem_price_change_event",
        "dismiss_qb_oem_reprice_impact",
      ]
    ) {
      expect(functionSql(functionName)).toContain(
        "(select auth.role()) is distinct from 'service_role'",
      );
    }
    expect(compactSql).toContain(
      "grant execute on function public.persist_qb_oem_price_change_event",
    );
    expect(compactSql).toContain(
      "grant execute on function public.dismiss_qb_oem_reprice_impact",
    );
    expect(compactSql).toContain("to service_role");
  });
});

postgresBehavior("812 behavior on scratch Postgres", () => {
  it("installs against the pre-812 schema and exposes only service mutation RPCs", () => {
    withScratchPostgres((psql) => {
      psql(scratchSchemaSql);
      psql(`\\i ${migrationPath}`);
      psql(`
        do $$
        declare fn text;
        begin
          foreach fn in array array[
            'public.pin_qb_price_sheet_lineage(text,uuid,jsonb)',
            'public.publish_qb_price_sheet_atomic(text,uuid,uuid,boolean)',
            'public.persist_qb_oem_price_change_event(text,uuid,uuid,uuid,uuid,jsonb,date,bigint,jsonb,jsonb,jsonb)',
            'public.dismiss_qb_oem_reprice_impact(text,uuid,uuid,text,text)'
          ] loop
            if has_function_privilege('anon', fn, 'EXECUTE')
               or has_function_privilege('authenticated', fn, 'EXECUTE')
               or not has_function_privilege('service_role', fn, 'EXECUTE') then
              raise exception 'mutation RPC privilege mismatch: %', fn;
            end if;
          end loop;
          if has_function_privilege(
               'service_role',
               'public.qb_has_meaningful_catalog_specs(jsonb,integer)',
               'EXECUTE'
             ) or has_function_privilege(
               'service_role',
               'public.normalize_qb_program_details_atomic(text,jsonb)',
               'EXECUTE'
             ) then
            raise exception 'internal catalog helper leaked to service_role';
          end if;
          if not has_table_privilege(
               'service_role', 'public.qb_workspace_pricing_epochs', 'SELECT'
             )
             or not has_table_privilege(
               'service_role', 'public.qb_quote_pricing_epochs', 'SELECT'
             )
             or not has_table_privilege(
               'authenticated', 'public.qb_price_sheet_lineage', 'SELECT'
             )
             or has_table_privilege(
               'authenticated', 'public.qb_price_sheet_lineage', 'INSERT'
             )
             or has_table_privilege(
               'authenticated', 'public.qb_workspace_pricing_epochs', 'SELECT'
             )
             or has_table_privilege(
               'anon', 'public.qb_price_sheet_lineage', 'SELECT'
             ) then
            raise exception 'lineage/epoch table privilege mismatch';
          end if;
        end $$;
      `);
    });
  });

  it("maintains independent workspace and per-quote epochs without unrelated invalidation", () => {
    withScratchPostgres((psql) => {
      psql(scratchSchemaSql);
      psql(`\\i ${migrationPath}`);
      psql(`
        set request.jwt.claim.role = 'service_role';
        insert into public.qrm_companies(id, workspace_id) values
          ('10000000-0000-0000-0000-000000000001', 'workspace-a');
        insert into public.qrm_deals(id, workspace_id, company_id, assigned_rep_id) values
          ('20000000-0000-0000-0000-000000000001', 'workspace-a',
           '10000000-0000-0000-0000-000000000001',
           '00000000-0000-0000-0000-000000000001');
        insert into public.quote_packages(
          id, workspace_id, deal_id, created_by, status
        ) values
          ('30000000-0000-0000-0000-000000000001', 'workspace-a',
           '20000000-0000-0000-0000-000000000001',
           '00000000-0000-0000-0000-000000000001', 'draft'),
          ('30000000-0000-0000-0000-000000000002', 'workspace-a',
           '20000000-0000-0000-0000-000000000001',
           '00000000-0000-0000-0000-000000000001', 'draft');
        insert into public.quote_package_line_items(
          id, workspace_id, quote_package_id, make, model, line_type,
          quoted_list_price, quantity
        ) values
          ('40000000-0000-0000-0000-000000000001', 'workspace-a',
           '30000000-0000-0000-0000-000000000001', 'ASV', 'RT-40',
           'equipment', 10000, 1),
          ('40000000-0000-0000-0000-000000000002', 'workspace-a',
           '30000000-0000-0000-0000-000000000002', 'ASV', 'RT-50',
           'equipment', 12000, 1);

        create temporary table epoch_before as
        select quote_package_id, epoch from public.qb_quote_pricing_epochs;

        update public.quote_package_line_items
        set quoted_list_price = 10100
        where id = '40000000-0000-0000-0000-000000000001';

        do $$
        begin
          if not exists (
            select 1 from public.qb_quote_pricing_epochs current_epoch
            join epoch_before prior using (quote_package_id)
            where current_epoch.quote_package_id = '30000000-0000-0000-0000-000000000001'
              and current_epoch.epoch = prior.epoch + 1
          ) then
            raise exception 'target quote epoch did not advance once';
          end if;
          if exists (
            select 1 from public.qb_quote_pricing_epochs current_epoch
            join epoch_before prior using (quote_package_id)
            where current_epoch.quote_package_id = '30000000-0000-0000-0000-000000000002'
              and current_epoch.epoch <> prior.epoch
          ) then
            raise exception 'unrelated quote epoch advanced';
          end if;
        end $$;

        truncate epoch_before;
        insert into epoch_before select quote_package_id, epoch from public.qb_quote_pricing_epochs;
        update public.qrm_companies
        set price_lock_active = true, price_lock_reason = 'contract'
        where id = '10000000-0000-0000-0000-000000000001';
        do $$
        begin
          if exists (
            select 1 from public.qb_quote_pricing_epochs current_epoch
            join epoch_before prior using (quote_package_id)
            where current_epoch.epoch <> prior.epoch + 1
          ) then
            raise exception 'company context did not bump every linked quote exactly once';
          end if;
          if (select count(*) from public.qb_workspace_pricing_epochs
              where workspace_id = 'workspace-a' and epoch > 0) <> 1 then
            raise exception 'workspace scan epoch was not maintained';
          end if;
        end $$;
      `);
    });
  });

  it("rolls back partial catalog publication and persists exact dual-stream lineage", () => {
    withScratchPostgres((psql) => {
      psql(scratchSchemaSql);
      psql(`\\i ${migrationPath}`);
      psql(`
        set request.jwt.claim.role = 'service_role';
        insert into public.qb_brands(id, workspace_id, code, name) values (
          '50000000-0000-0000-0000-000000000001', 'workspace-a', 'as-v', 'ASV Inc'
        );
        insert into public.qb_price_sheets(
          id, workspace_id, brand_id, status, sheet_type, published_at
        ) values
          ('60000000-0000-0000-0000-000000000001', 'workspace-a',
           '50000000-0000-0000-0000-000000000001', 'published',
           'price_book', '2026-01-01T00:00:00Z'),
          ('60000000-0000-0000-0000-000000000002', 'workspace-a',
           '50000000-0000-0000-0000-000000000001', 'published',
           'retail_programs', '2026-02-01T00:00:00Z'),
          ('60000000-0000-0000-0000-000000000003', 'workspace-a',
           '50000000-0000-0000-0000-000000000001', 'extracted',
           'both', null);

        select public.pin_qb_price_sheet_lineage(
          'workspace-a',
          '60000000-0000-0000-0000-000000000003',
          '[{"lane":"price_book","predecessorPriceSheetId":"60000000-0000-0000-0000-000000000001"},
            {"lane":"retail_programs","predecessorPriceSheetId":"60000000-0000-0000-0000-000000000002"}]'::jsonb
        );
        insert into public.qb_price_sheet_items(
          id, price_sheet_id, item_type, action, review_status, extracted
        ) values
          ('61000000-0000-0000-0000-000000000001',
           '60000000-0000-0000-0000-000000000003', 'model', 'create',
           'approved', '{"model_code":"RT-40","list_price_cents":1100000,"specs":{"notes":"marketing prose only"}}'::jsonb),
          ('61000000-0000-0000-0000-000000000002',
           '60000000-0000-0000-0000-000000000003', 'model', 'create',
           'approved', '{"model_code":"RT-50","specs":{"engine":{"horsepower":55}}}'::jsonb);

        do $$
        begin
          perform public.publish_qb_price_sheet_atomic(
            'workspace-a', '60000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000001', false
          );
          raise exception 'invalid second row unexpectedly published';
        exception when sqlstate '22023' then
          null;
        end $$;
        do $$
        begin
          if exists (select 1 from public.qb_equipment_models)
             or exists (select 1 from public.qb_price_sheet_items where applied_at is not null)
             or (select status from public.qb_price_sheets
                 where id = '60000000-0000-0000-0000-000000000003') <> 'extracted' then
            raise exception 'atomic publisher left partial catalog state';
          end if;
        end $$;

        update public.qb_price_sheet_items
        set extracted = extracted || '{"list_price_cents":1200000}'::jsonb
        where id = '61000000-0000-0000-0000-000000000002';
        select public.publish_qb_price_sheet_atomic(
          'workspace-a', '60000000-0000-0000-0000-000000000003',
          '00000000-0000-0000-0000-000000000001', false
        );
        do $$
        begin
          if (select count(*) from public.qb_equipment_models) <> 2
             or (select count(*) from public.qb_equipment_models
                 where specs is not null) <> 1
             or (select specs from public.qb_equipment_models
                 where model_code = 'RT-40') is not null
             or (select count(*) from public.qb_price_sheet_items where applied_at is not null) <> 2
             or (select status from public.qb_price_sheets
                 where id = '60000000-0000-0000-0000-000000000003') <> 'published'
             or (select count(*) from public.qb_price_sheets
                 where id in ('60000000-0000-0000-0000-000000000001',
                              '60000000-0000-0000-0000-000000000002')
                   and status = 'superseded') <> 2 then
            raise exception 'successful atomic publish did not commit every catalog/lineage mutation';
          end if;
        end $$;

        insert into public.qrm_companies(id, workspace_id) values
          ('10000000-0000-0000-0000-000000000001', 'workspace-a');
        insert into public.qrm_deals(id, workspace_id, company_id, assigned_rep_id) values (
          '20000000-0000-0000-0000-000000000001', 'workspace-a',
          '10000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001'
        );
        insert into public.quote_packages(
          id, workspace_id, deal_id, created_by, status, updated_at
        ) values (
          '30000000-0000-0000-0000-000000000001', 'workspace-a',
          '20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001', 'draft',
          '2026-07-09T12:00:00Z'
        );
        insert into public.quote_package_line_items(
          id, workspace_id, quote_package_id, make, model, quantity,
          quoted_list_price, quoted_dealer_cost, source_location, line_type
        ) values (
          '40000000-0000-0000-0000-000000000001', 'workspace-a',
          '30000000-0000-0000-0000-000000000001', 'ASV', 'RT-40', 1,
          10000, 8000, 'factory_order', 'equipment'
        );
        insert into public.qb_price_change_events(
          id, workspace_id, brand_id, price_sheet_id, prior_price_sheet_id,
          publish_group_id, stream_kind, status
        ) values
          ('70000000-0000-0000-0000-000000000001', 'workspace-a',
           '50000000-0000-0000-0000-000000000001',
           '60000000-0000-0000-0000-000000000001', null,
           '71000000-0000-0000-0000-000000000001', 'price_book', 'active'),
          ('70000000-0000-0000-0000-000000000002', 'workspace-a',
           '50000000-0000-0000-0000-000000000001',
           '60000000-0000-0000-0000-000000000002', null,
           '71000000-0000-0000-0000-000000000002', 'retail_programs', 'active');

        do $$
        declare
          v_epoch bigint;
          v_quote_updated_at timestamptz;
          v_streams jsonb;
          v_result jsonb;
        begin
          select epoch into v_epoch from public.qb_workspace_pricing_epochs
          where workspace_id = 'workspace-a';
          select updated_at into v_quote_updated_at from public.quote_packages
          where id = '30000000-0000-0000-0000-000000000001';
          v_streams := jsonb_build_array(
            jsonb_build_object(
              'streamKind', 'price_book',
              'priorPriceSheetId', '60000000-0000-0000-0000-000000000001',
              'itemDiffs', jsonb_build_array(jsonb_build_object(
                'itemType', 'list_price', 'modelCode', 'RT-40',
                'normalizedCode', 'RT40', 'nameDisplay', 'RT-40',
                'oldPriceCents', 1000000, 'newPriceCents', 1100000,
                'deltaCents', 100000, 'deltaPct', 10, 'changeKind', 'increased',
                'metadata', jsonb_build_object(
                  'workspace_id', 'workspace-a',
                  'brand_id', '50000000-0000-0000-0000-000000000001'
                )
              )),
              'impacts', jsonb_build_array(jsonb_build_object(
                'quotePackageId', '30000000-0000-0000-0000-000000000001',
                'quoteStatusSnapshot', 'draft',
                'quoteUpdatedAtSnapshot', v_quote_updated_at,
                'customerCompanyId', '10000000-0000-0000-0000-000000000001',
                'assignedRepId', '00000000-0000-0000-0000-000000000001',
                'changeCategories', jsonb_build_array('list_price'),
                'approvalRequiredReasons', jsonb_build_array('manager_review_policy'),
                'lines', jsonb_build_array(jsonb_build_object(
                  'quotePackageLineItemId', '40000000-0000-0000-0000-000000000001',
                  'modelCode', 'RT-40', 'make', 'ASV', 'quantity', 1,
                  'oldListPriceCents', 1000000, 'newListPriceCents', 1100000,
                  'deltaCents', 100000, 'deltaPct', 10,
                  'sourceLocation', 'factory_order', 'isYardStock', false,
                  'quoteLineSnapshot', jsonb_build_object(
                    'make', 'ASV', 'model', 'RT-40', 'quantity', 1,
                    'quoted_list_price_cents', 1000000,
                    'quoted_dealer_cost_cents', 800000,
                    'source_location', 'factory_order'
                  )
                ))
              ))
            ),
            jsonb_build_object(
              'streamKind', 'retail_programs',
              'priorPriceSheetId', '60000000-0000-0000-0000-000000000002',
              'itemDiffs', jsonb_build_array(jsonb_build_object(
                'itemType', 'rebate', 'nameDisplay', 'Summer cash',
                'oldPriceCents', 50000, 'newPriceCents', 75000,
                'deltaCents', 25000, 'deltaPct', 50, 'changeKind', 'increased',
                'metadata', jsonb_build_object(
                  'workspace_id', 'workspace-a',
                  'brand_id', '50000000-0000-0000-0000-000000000001'
                )
              )),
              'impacts', jsonb_build_array(jsonb_build_object(
                'quotePackageId', '30000000-0000-0000-0000-000000000001',
                'quoteStatusSnapshot', 'draft',
                'quoteUpdatedAtSnapshot', v_quote_updated_at,
                'customerCompanyId', '10000000-0000-0000-0000-000000000001',
                'assignedRepId', '00000000-0000-0000-0000-000000000001',
                'changeCategories', jsonb_build_array('rebate'),
                'approvalRequiredReasons', jsonb_build_array('manager_review_policy'),
                'catalogChanges', jsonb_build_array(jsonb_build_object(
                  'itemType', 'rebate', 'quoteDeltaCents', null
                )),
                'lines', '[]'::jsonb
              ))
            )
          );
          update public.qrm_companies
          set deleted_at = now()
          where id = '10000000-0000-0000-0000-000000000001';
          select epoch into v_epoch from public.qb_workspace_pricing_epochs
          where workspace_id = 'workspace-a';
          begin
            perform public.persist_qb_oem_price_change_event(
              'workspace-a', '50000000-0000-0000-0000-000000000001',
              '60000000-0000-0000-0000-000000000003',
              '72000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000001',
              '{"scan_complete":true}'::jsonb, current_date, v_epoch,
              '{"line_pct_gt":2,"quote_delta_cents_gt":100000}'::jsonb,
              '{"manager_review":true}'::jsonb, v_streams
            );
            raise exception 'deleted customer context was accepted';
          exception when serialization_failure then
            null;
          end;
          update public.qrm_companies
          set deleted_at = null, workspace_id = 'workspace-b'
          where id = '10000000-0000-0000-0000-000000000001';
          select epoch into v_epoch from public.qb_workspace_pricing_epochs
          where workspace_id = 'workspace-a';
          begin
            perform public.persist_qb_oem_price_change_event(
              'workspace-a', '50000000-0000-0000-0000-000000000001',
              '60000000-0000-0000-0000-000000000003',
              '72000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000001',
              '{"scan_complete":true}'::jsonb, current_date, v_epoch,
              '{"line_pct_gt":2,"quote_delta_cents_gt":100000}'::jsonb,
              '{"manager_review":true}'::jsonb, v_streams
            );
            raise exception 'cross-workspace customer context was accepted';
          exception when serialization_failure then
            null;
          end;
          update public.qrm_companies
          set workspace_id = 'workspace-a'
          where id = '10000000-0000-0000-0000-000000000001';
          select epoch into v_epoch from public.qb_workspace_pricing_epochs
          where workspace_id = 'workspace-a';
          v_result := public.persist_qb_oem_price_change_event(
            'workspace-a', '50000000-0000-0000-0000-000000000001',
            '60000000-0000-0000-0000-000000000003',
            '72000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001',
            '{"scan_complete":true}'::jsonb, current_date, v_epoch,
            '{"line_pct_gt":2,"quote_delta_cents_gt":100000}'::jsonb,
            '{"manager_review":true}'::jsonb, v_streams
          );
          if (select count(*) from jsonb_object_keys(v_result -> 'event_ids')) <> 2 then
            raise exception 'dual-stream persistence did not return both event IDs';
          end if;
        end $$;

        do $$
        begin
          if (select count(*) from public.qb_price_change_events
              where price_sheet_id = '60000000-0000-0000-0000-000000000003'
                and status = 'active') <> 2
             or exists (select 1 from public.qb_price_change_events
                        where id in ('70000000-0000-0000-0000-000000000001',
                                     '70000000-0000-0000-0000-000000000002')
                          and status <> 'superseded')
             or (select count(*) from public.qb_quote_reprice_impacts) <> 2
             or not (select requires_requote from public.quote_packages
                     where id = '30000000-0000-0000-0000-000000000001') then
            raise exception 'dual-stream persistence result is incomplete';
          end if;
        end $$;

        update public.qrm_deals
        set assigned_rep_id = '00000000-0000-0000-0000-000000000002'
        where id = '20000000-0000-0000-0000-000000000001';
        do $$
        declare v_impact_id uuid;
        begin
          select impact.id into v_impact_id
          from public.qb_quote_reprice_impacts impact
          join public.qb_price_change_events event on event.id = impact.event_id
          where event.stream_kind = 'price_book';
          begin
            perform public.dismiss_qb_oem_reprice_impact(
              'workspace-a', v_impact_id,
              '00000000-0000-0000-0000-000000000001', 'rep', 'former owner'
            );
            raise exception 'former rep dismissed a reassigned impact';
          exception when insufficient_privilege then
            null;
          end;
          perform public.dismiss_qb_oem_reprice_impact(
            'workspace-a', v_impact_id,
            '00000000-0000-0000-0000-000000000002', 'rep', 'current owner'
          );
          if (select state from public.qb_quote_reprice_impacts
              where id = v_impact_id) <> 'dismissed' then
            raise exception 'current rep could not dismiss reassigned impact';
          end if;
        end $$;

        insert into public.qb_price_sheets(
          id, workspace_id, brand_id, status, sheet_type, published_at
        ) values
          ('60000000-0000-0000-0000-000000000004', 'workspace-a',
           '50000000-0000-0000-0000-000000000001', 'published', 'both',
           '2026-07-10T00:00:00Z'),
          ('60000000-0000-0000-0000-000000000005', 'workspace-a',
           '50000000-0000-0000-0000-000000000001', 'extracted', 'price_book',
           null);
        select public.pin_qb_price_sheet_lineage(
          'workspace-a', '60000000-0000-0000-0000-000000000005',
          '[{"lane":"price_book","predecessorPriceSheetId":"60000000-0000-0000-0000-000000000004"}]'::jsonb
        );
        select public.publish_qb_price_sheet_atomic(
          'workspace-a', '60000000-0000-0000-0000-000000000005',
          '00000000-0000-0000-0000-000000000001', false
        );
        do $$
        begin
          if (select status from public.qb_price_sheets
              where id = '60000000-0000-0000-0000-000000000004') <> 'published' then
            raise exception 'single-lane publish retired the other lane of a both sheet';
          end if;
        end $$;
      `);
    });
  });

  it("serializes apply-shaped and publish-shaped sessions without lock inversion", async () => {
    await withScratchPostgresAsync(async (psql, startPsql) => {
      psql(scratchSchemaSql);
      psql(`\\i ${migrationPath}`);
      psql(`
        set request.jwt.claim.role = 'service_role';
        insert into public.quote_packages(id, workspace_id, status) values (
          '30000000-0000-0000-0000-000000000001', 'workspace-a', 'draft'
        );
        insert into public.quote_package_line_items(
          id, workspace_id, quote_package_id, make, model, line_type,
          quoted_list_price
        ) values (
          '40000000-0000-0000-0000-000000000001', 'workspace-a',
          '30000000-0000-0000-0000-000000000001', 'ASV', 'RT-40',
          'equipment', 10000
        );
      `);

      const applySession = startPsql(`
        set request.jwt.claim.role = 'service_role';
        set lock_timeout = '5s';
        begin;
        select 1 from public.quote_packages
        where id = '30000000-0000-0000-0000-000000000001' for update;
        select 1 from public.quote_package_line_items
        where id = '40000000-0000-0000-0000-000000000001' for update;
        select 1 from public.qb_quote_pricing_epochs
        where workspace_id = 'workspace-a'
          and quote_package_id = '30000000-0000-0000-0000-000000000001'
        for update;
        select pg_sleep(0.35);
        update public.quote_package_line_items
        set quoted_list_price = 10100
        where id = '40000000-0000-0000-0000-000000000001';
        commit;
      `);
      await new Promise((resolve) => setTimeout(resolve, 75));
      const publishSession = startPsql(`
        set request.jwt.claim.role = 'service_role';
        set lock_timeout = '5s';
        begin;
        select 1 from public.quote_packages
        where id = '30000000-0000-0000-0000-000000000001' for update;
        select 1 from public.quote_package_line_items
        where id = '40000000-0000-0000-0000-000000000001' for share;
        select 1 from public.qb_quote_pricing_epochs
        where workspace_id = 'workspace-a'
          and quote_package_id = '30000000-0000-0000-0000-000000000001'
        for update;
        select 1 from public.qb_workspace_pricing_epochs
        where workspace_id = 'workspace-a' for update;
        commit;
      `);
      await Promise.all([applySession, publishSession]);
      psql(`
        do $$
        begin
          if (select quoted_list_price from public.quote_package_line_items
              where id = '40000000-0000-0000-0000-000000000001') <> 10100 then
            raise exception 'apply-shaped writer did not commit';
          end if;
        end $$;
      `);
    });
  });

  it("scans 50,123 persisted quotes and lines by keyset within a five-second DB budget", () => {
    withScratchPostgres((psql) => {
      psql(scratchSchemaSql);
      psql(`
        insert into public.quote_packages(id, workspace_id, status)
        select md5('quote-' || value)::uuid, 'fixture-workspace', 'draft'
        from generate_series(1, 50123) value;
        insert into public.quote_package_line_items(
          id, workspace_id, quote_package_id, make, model, line_type,
          quoted_list_price
        )
        select md5('line-' || value)::uuid, 'fixture-workspace',
               md5('quote-' || value)::uuid, 'ASV', 'RT-' || value,
               'equipment', 10000
        from generate_series(1, 50123) value;
      `);
      psql(`\\i ${migrationPath}`);
      psql(`
        do $$
        declare
          v_after uuid;
          v_page uuid[];
          v_quote_count integer := 0;
          v_line_count integer := 0;
          v_page_count integer := 0;
          v_started_at timestamptz := clock_timestamp();
          v_elapsed interval;
        begin
          loop
            select array_agg(page.id order by page.id) into v_page
            from (
              select quote.id
              from public.quote_packages quote
              where quote.workspace_id = 'fixture-workspace'
                and quote.status in (
                  'draft', 'draft_low_margin', 'pending_approval', 'approved',
                  'approved_with_conditions', 'changes_requested', 'ready',
                  'sent', 'viewed'
                )
                and (v_after is null or quote.id > v_after)
              order by quote.id
              limit 1000
            ) page;
            exit when coalesce(cardinality(v_page), 0) = 0;
            v_page_count := v_page_count + 1;
            v_quote_count := v_quote_count + cardinality(v_page);
            select v_line_count + count(*) into v_line_count
            from public.quote_package_line_items line
            where line.workspace_id = 'fixture-workspace'
              and line.quote_package_id = any(v_page);
            v_after := v_page[cardinality(v_page)];
          end loop;
          v_elapsed := clock_timestamp() - v_started_at;
          if v_quote_count <> 50123 or v_line_count <> 50123 or v_page_count <> 51 then
            raise exception 'large DB scan truncated: quotes %, lines %, pages %',
              v_quote_count, v_line_count, v_page_count;
          end if;
          if v_elapsed > interval '5 seconds' then
            raise exception 'large DB scan exceeded five-second budget: %', v_elapsed;
          end if;
          raise notice 'A7.5 DB scan budget: 50123 quotes + lines in % across % pages',
            v_elapsed, v_page_count;
        end $$;
      `);
    });
  });
});
