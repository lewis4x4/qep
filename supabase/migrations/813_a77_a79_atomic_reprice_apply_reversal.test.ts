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
  "813_a77_a79_atomic_reprice_apply_reversal.sql",
);
const retryHardeningMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "817_oem_publish_atomicity_and_idempotent_retry.sql",
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

describe("813 A7.7/A7.9 atomic apply and reversal contract", () => {
  it("adds exact draft/approval bindings and terminal reversed state", () => {
    expect(compactSql).toContain(
      "add column if not exists draft_version integer not null default 1",
    );
    expect(compactSql).toContain(
      "add column if not exists quote_package_version_id uuid",
    );
    expect(compactSql).toContain(
      "add column if not exists approved_draft_updated_at_snapshot timestamptz",
    );
    expect(compactSql).toContain(
      "add column if not exists quote_pricing_epoch_snapshot bigint",
    );
    expect(compactSql).toContain(
      "add column if not exists oem_reprice_draft_version integer",
    );
    expect(compactSql).toContain("'applied', 'reversed'");
    expect(compactSql).toContain(
      "create unique index if not exists uq_quote_approval_cases_oem_reprice_draft_version",
    );
  });

  it("creates an append-only, indexed, no-send audit ledger", () => {
    expect(compactSql).toContain(
      "create table if not exists public.qb_quote_reprice_audits",
    );
    expect(compactSql).toContain("unique (workspace_id, idempotency_key)");
    expect(compactSql).toContain(
      "create unique index if not exists uq_qb_quote_reprice_audits_apply_draft",
    );
    expect(compactSql).toContain(
      "create unique index if not exists uq_qb_quote_reprice_audits_reverse_apply",
    );
    expect(compactSql).toContain("customer_communication_sent = false");
    expect(compactSql).toContain(
      "payload #>> '{side_effects,customer_communication}' = 'none'",
    );
    expect(compactSql).toContain(
      "before update or delete on public.qb_quote_reprice_audits",
    );
    expect(compactSql).toContain("is append-only");
  });

  it("mirrors canonical Quote Builder totals and DP10 without split invention", () => {
    const totals = functionSql("qb_oem_reprice_canonical_totals");
    const projected = functionSql("qb_oem_reprice_projected_totals");
    expect(totals).toContain("line.cost_visibility = 'customer'");
    expect(totals).toContain("line.line_type = 'equipment'");
    expect(totals).toContain("line.metadata ->> 'misc_line_kind' = 'credit'");
    expect(totals).toContain("commercial_discount_value");
    expect(totals).toContain("margin_amount_cents");
    expect(compactSql).toContain("'rate_of_gross_margin', 0.15");
    expect(compactSql).toContain("'split_allocation', null");
    expect(projected).toContain("impact_line.new_list_price_cents");
    expect(projected).toContain(
      "then subtotal * least(100, discount_value) / 100",
    );
    expect(compactSql).toContain(
      "applied oem totals differ from the manager-approved canonical projection",
    );
  });

  it("applies under stable locks, exact CAS, approval, lock, and role gates", () => {
    const fn = functionSql("apply_qb_oem_reprice_draft");
    expect(fn).toContain("security definer set search_path = ''");
    expect(fn).toContain("pg_advisory_xact_lock");
    const quoteLock = fn.indexOf("from public.quote_packages quote");
    const draftLock = fn.indexOf(
      "from public.qb_quote_reprice_drafts draft",
      quoteLock,
    );
    const impactLock = fn.indexOf(
      "from public.qb_quote_reprice_impacts impact",
      draftLock,
    );
    const approvalLock = fn.indexOf(
      "from public.quote_approval_cases approval",
      impactLock,
    );
    const dealLock = fn.indexOf("from public.qrm_deals deal", approvalLock);
    const companyLock = fn.indexOf(
      "from public.qrm_companies company",
      dealLock,
    );
    const impactLineLock = fn.indexOf(
      "from public.qb_quote_reprice_impact_lines impact_line",
      companyLock,
    );
    const quoteLineLock = fn.indexOf(
      "from public.quote_package_line_items quote_line",
      impactLineLock,
    );
    const versionLock = fn.indexOf(
      "from public.quote_package_versions version",
      quoteLineLock,
    );
    const epochLock = fn.indexOf(
      "from public.qb_quote_pricing_epochs epoch",
      versionLock,
    );
    const eventLock = fn.indexOf(
      "from public.qb_price_change_events event",
      epochLock,
    );
    expect(fn).not.toContain("lock table");
    expect(quoteLock).toBeGreaterThanOrEqual(0);
    expect(draftLock).toBeGreaterThan(quoteLock);
    expect(impactLock).toBeGreaterThan(draftLock);
    expect(approvalLock).toBeGreaterThan(impactLock);
    expect(dealLock).toBeGreaterThan(approvalLock);
    expect(companyLock).toBeGreaterThan(dealLock);
    expect(impactLineLock).toBeGreaterThan(companyLock);
    expect(quoteLineLock).toBeGreaterThan(impactLineLock);
    expect(versionLock).toBeGreaterThan(quoteLineLock);
    expect(epochLock).toBeGreaterThan(versionLock);
    expect(eventLock).toBeGreaterThan(epochLock);
    expect(fn).toContain("actor identity, role, or workspace is not current");
    expect(fn).toContain("oem reprice draft belongs to another rep");
    expect(fn).toContain("customer has an active oem price lock");
    expect(fn).toContain(
      "oem_reprice_draft_version is distinct from v_draft.draft_version",
    );
    expect(fn).toContain("quote line compare-and-swap failed during oem apply");
    expect(fn).toContain(
      "below-floor oem reprice lacks authorized override evidence",
    );
    expect(fn).not.toContain("exception when others");
  });

  it("creates and submits the manager approval case atomically with no delivery mutation", () => {
    const fn = functionSql("create_qb_oem_reprice_draft_for_approval");
    expect(fn).toContain("security definer set search_path = ''");
    expect(fn).toContain("pg_advisory_xact_lock");
    expect(fn).toContain("insert into public.qb_quote_reprice_drafts");
    expect(fn).toContain("insert into public.quote_approval_cases");
    expect(fn).toContain("set state = 'approval_pending'");
    expect(fn).toContain("'approval_kind', 'oem_reprice'");
    expect(fn).toContain("'manager_review_required', true");
    expect(fn).toContain("'auto_send_customer', false");
    expect(fn).toContain("quote line changed before oem approval submission");
    expect(fn).toContain("'customer_communication', 'none'");
    expect(fn).toContain("quote_pricing_epoch_snapshot");
    expect(fn).toContain("from public.qb_quote_pricing_epochs epoch");
    expect(fn).not.toContain("email_drafts");
    expect(fn).not.toContain("status = 'approved'");
  });

  it("synchronizes an OEM decision to draft and impact without quote-send state", () => {
    const fn = functionSql("sync_qb_oem_reprice_approval_decision");
    expect(fn).toContain("pg_try_advisory_xact_lock");
    expect(fn).toContain("retry the decision");
    expect(fn).toContain("approval_kind");
    expect(fn).toContain("oem_reprice_draft_version");
    expect(fn).toContain("quote changed before oem approval");
    expect(fn).toContain("set state = 'approved'");
    expect(fn).toContain("status = 'approved'");
    expect(fn).toContain("requires unconditional manager approval");
    expect(fn).toContain(
      "below-floor oem approval requires an explicit exception reason",
    );
    expect(fn).toContain(
      "'margin_override_policy_id', 'oem-dp9:below_margin_floor'",
    );
    expect(fn).toContain("'margin_override_approval_case_id', new.id");
    expect(fn).toContain("'margin_override_decided_by', new.decided_by");
    expect(fn).not.toContain("email_drafts");
    expect(fn).not.toContain("update public.quote_packages");
  });

  it("creates quote version, immutable audit, state transition, and recomputed flag atomically", () => {
    const fn = functionSql("apply_qb_oem_reprice_draft");
    expect(fn).toContain("set status = 'applied', applied_at = v_now");
    expect(fn).toContain("set state = 'applied'");
    expect(fn).toContain("insert into public.quote_package_versions");
    expect(fn).toContain("insert into public.qb_quote_reprice_audits");
    expect(fn).toContain("qb_oem_reprice_recompute_quote_flag");
    expect(fn).toContain("'customer_communication', 'none'");
    expect(fn).not.toContain("email_drafts");
  });

  it("reverses inclusively through seven days and rejects later work", () => {
    const fn = functionSql("reverse_qb_oem_reprice_apply");
    expect(fn).toContain("qb_oem_reprice_reversal_within_window");
    expect(fn).toContain(
      "quote changed after oem apply; reversal would overwrite later work",
    );
    expect(fn).toContain(
      "quote has advanced to an irreversible customer state",
    );
    expect(fn).toContain(
      "reversal no longer reconstructs pre-apply totals exactly",
    );
    expect(fn).toContain("set status = 'reversed', reversed_at = v_now");
    expect(fn).toContain("set state = 'visible'");
    expect(fn).toContain("'customer_communication', 'none'");
    expect(fn).not.toContain("lock table");
    expect(fn).toContain("from public.qb_quote_pricing_epochs epoch");
    expect(fn).toContain("oem source event is no longer active");
  });

  it("keeps all mutation RPCs service-role-only and internal helpers unexposed", () => {
    for (
      const name of [
        "create_qb_oem_reprice_draft_for_approval",
        "apply_qb_oem_reprice_draft",
        "reverse_qb_oem_reprice_apply",
      ]
    ) {
      expect(functionSql(name)).toContain(
        "(select auth.role()) is distinct from 'service_role'",
      );
      expect(compactSql).toContain(
        `grant execute on function public.${name}`,
      );
    }
    expect(compactSql).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(compactSql).not.toContain(
      "grant execute on function public.apply_qb_oem_reprice_draft( text, uuid, uuid, text ) to authenticated",
    );
    expect(functionSql("guard_qb_oem_reprice_draft_version")).toContain(
      "(select auth.role()) is distinct from 'service_role'",
    );
    expect(functionSql("guard_qb_oem_reprice_service_mutation")).toContain(
      "(select auth.role()) is distinct from 'service_role'",
    );
    expect(functionSql("guard_qb_oem_approval_case_mutation")).toContain(
      "(select auth.role()) is distinct from 'service_role'",
    );
    expect(compactSql).toContain(
      "revoke insert, update, delete on table public.qb_quote_reprice_drafts from anon, authenticated",
    );
    expect(compactSql).toContain(
      "revoke insert, update, delete on table public.qb_quote_reprice_impacts from anon, authenticated",
    );
    expect(compactSql).toContain(
      "revoke insert, update, delete on table public.quote_approval_cases from anon, authenticated",
    );
    expect(compactSql).not.toContain("qep.oem_reprice_internal");
  });

  it("wraps all schema and function changes in one migration transaction", () => {
    expect(compactSql.startsWith("-- migration 813")).toBe(true);
    expect(compactSql).toContain("begin;");
    expect(compactSql.trim().endsWith("commit;")).toBe(true);
  });
});

function postgresBin(name: string): string | null {
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  const candidateDirs = [
    process.env.QEP_POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/libpq/bin",
    "/usr/local/opt/postgresql@16/bin",
    ...pathDirs,
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
  callback: (psql: (sqlText: string) => string) => void,
): void {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test invoked without Postgres binaries");
  }
  const root = mkdtempSync(join(tmpdir(), "qep-a7-813-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(25000 + Math.floor(Math.random() * 10_000));
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
      const sqlPath = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(sqlPath, sqlText);
      return runCommand(psqlPath, [
        "-v",
        "ON_ERROR_STOP=1",
        ...connectionArgs,
        "-f",
        sqlPath,
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

const scratchSchemaSql = `
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
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key,
  full_name text,
  role text not null,
  active_workspace_id text not null
);

create table public.qrm_companies (
  id uuid primary key,
  workspace_id text not null,
  price_lock_active boolean not null default false,
  price_lock_reason text,
  price_lock_expires_at date,
  deleted_at timestamptz
);

create table public.qrm_deals (
  id uuid primary key,
  workspace_id text not null,
  company_id uuid references public.qrm_companies(id),
  assigned_rep_id uuid references public.profiles(id)
);

create table public.quote_packages (
  id uuid primary key,
  workspace_id text not null,
  deal_id uuid references public.qrm_deals(id),
  created_by uuid references public.profiles(id),
  status text not null,
  equipment_total numeric default 0,
  attachment_total numeric default 0,
  subtotal numeric default 0,
  discount_total numeric default 0,
  trade_allowance numeric default 0,
  trade_credit numeric default 0,
  net_total numeric default 0,
  tax_total numeric default 0,
  cash_down numeric default 0,
  amount_financed numeric default 0,
  margin_amount numeric default 0,
  margin_pct numeric default 0,
  commercial_discount_type text default 'flat',
  commercial_discount_value numeric default 0,
  requires_requote boolean default false,
  requote_reason text,
  updated_at timestamptz not null default now()
);
create trigger set_quote_packages_updated_at
before update on public.quote_packages
for each row execute function public.set_updated_at();

create table public.qb_quote_pricing_epochs (
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  epoch bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, quote_package_id)
);

create function public.scratch_bump_quote_pricing_epoch()
returns trigger language plpgsql as $$
declare v_workspace text; v_quote uuid;
begin
  v_workspace := case when tg_op = 'DELETE' then old.workspace_id else new.workspace_id end;
  v_quote := case when tg_op = 'DELETE' then old.quote_package_id else new.quote_package_id end;
  insert into public.qb_quote_pricing_epochs(workspace_id, quote_package_id, epoch)
  values (v_workspace, v_quote, 1)
  on conflict (workspace_id, quote_package_id) do update
  set epoch = public.qb_quote_pricing_epochs.epoch + 1,
      updated_at = now();
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create table public.quote_package_line_items (
  id uuid primary key,
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  make text,
  model text,
  quoted_list_price numeric,
  quoted_dealer_cost numeric,
  quantity integer default 1,
  source_location text,
  line_type text not null,
  unit_price numeric,
  extended_price numeric,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  cost_visibility text not null default 'customer',
  equipment_override_price_cents bigint
);
create trigger scratch_line_pricing_epoch
after insert or update or delete on public.quote_package_line_items
for each row execute function public.scratch_bump_quote_pricing_epoch();

create table public.qb_brands (
  id uuid primary key,
  workspace_id text not null,
  code text,
  name text
);

create table public.qb_price_sheets (
  id uuid primary key,
  workspace_id text not null,
  brand_id uuid references public.qb_brands(id),
  status text not null
);

create table public.qb_price_change_events (
  id uuid primary key,
  workspace_id text not null,
  brand_id uuid not null references public.qb_brands(id),
  price_sheet_id uuid not null references public.qb_price_sheets(id),
  prior_price_sheet_id uuid references public.qb_price_sheets(id),
  status text not null
);

-- Minimal pre-817 publisher/persister doubles let this scratch database prove
-- that the new composed RPC has real transaction rollback semantics. Migration
-- 812 separately exercises the production implementations in depth.
create function public.publish_qb_price_sheet_atomic(
  p_workspace_id text,
  p_price_sheet_id uuid,
  p_actor_id uuid,
  p_auto_approve boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  update public.qb_price_sheets
  set status = 'published'
  where id = p_price_sheet_id
    and workspace_id = p_workspace_id
    and status = 'extracted';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 and not exists (
    select 1 from public.qb_price_sheets
    where id = p_price_sheet_id
      and workspace_id = p_workspace_id
      and status = 'published'
  ) then
    raise exception 'scratch publish rejected';
  end if;
  return jsonb_build_object(
    'itemsApplied', case when v_rows = 1 then 1 else 0 end,
    'programsApplied', 0,
    'actorId', p_actor_id,
    'autoApprove', p_auto_approve
  );
end;
$$;

create function public.persist_qb_oem_price_change_event(
  p_workspace_id text,
  p_brand_id uuid,
  p_price_sheet_id uuid,
  p_publish_group_id uuid,
  p_created_by uuid,
  p_source_metadata jsonb,
  p_effective_date date,
  p_quote_pricing_epoch bigint,
  p_materiality_rule jsonb,
  p_approval_policy jsonb,
  p_streams jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((p_source_metadata->>'force_failure')::boolean, false) then
    raise exception 'scratch persistence failure';
  end if;
  if not exists (
    select 1 from public.qb_price_sheets
    where id = p_price_sheet_id
      and workspace_id = p_workspace_id
      and brand_id = p_brand_id
      and status = 'published'
  ) then
    raise exception 'scratch persistence observed unpublished sheet';
  end if;
  return jsonb_build_object(
    'event_id', p_publish_group_id,
    'event_ids', jsonb_build_object('price_book', p_publish_group_id),
    'publish_group_id', p_publish_group_id,
    'created_by', p_created_by,
    'effective_date', p_effective_date,
    'quote_pricing_epoch', p_quote_pricing_epoch,
    'materiality_rule', p_materiality_rule,
    'approval_policy', p_approval_policy,
    'stream_count', jsonb_array_length(p_streams)
  );
end;
$$;

create table public.qb_quote_reprice_impacts (
  id uuid primary key,
  event_id uuid not null references public.qb_price_change_events(id),
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  deal_id uuid,
  assigned_rep_id uuid references public.profiles(id),
  quote_status_snapshot text,
  quote_updated_at_snapshot timestamptz,
  total_delta_cents bigint not null default 0,
  old_margin_pct numeric,
  projected_margin_pct numeric,
  margin_floor_pct numeric,
  below_margin_floor boolean not null default false,
  requires_manager_review boolean not null default true,
  approval_required_reasons text[] not null default '{}',
  old_commission_cents bigint,
  projected_commission_cents bigint,
  state text not null,
  change_categories text[] not null default '{}',
  customer_company_id uuid references public.qrm_companies(id),
  updated_at timestamptz not null default now()
);
create trigger set_qb_quote_reprice_impacts_updated_at
before update on public.qb_quote_reprice_impacts
for each row execute function public.set_updated_at();

create table public.qb_quote_reprice_impact_lines (
  id uuid primary key,
  impact_id uuid not null references public.qb_quote_reprice_impacts(id),
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
  metadata jsonb not null default '{}'
);

create table public.quote_package_versions (
  id uuid primary key,
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  version_number integer not null,
  snapshot_json jsonb not null,
  computed_metrics_json jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (quote_package_id, version_number)
);

create table public.quote_approval_cases (
  id uuid primary key,
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id),
  quote_package_version_id uuid not null references public.quote_package_versions(id),
  version_number integer not null,
  deal_id uuid references public.qrm_deals(id),
  net_total numeric,
  margin_pct numeric,
  submitted_by uuid references public.profiles(id),
  assigned_role text,
  route_mode text not null,
  policy_snapshot_json jsonb not null default '{}',
  reason_summary_json jsonb not null default '{}',
  status text not null,
  submission_note text,
  decision_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_quote_approval_cases_updated_at
before update on public.quote_approval_cases
for each row execute function public.set_updated_at();

create table public.qb_quote_reprice_drafts (
  id uuid primary key default gen_random_uuid(),
  impact_id uuid not null references public.qb_quote_reprice_impacts(id),
  quote_package_id uuid not null references public.quote_packages(id),
  workspace_id text not null,
  created_by uuid references public.profiles(id),
  status text not null,
  proposed_patch jsonb not null default '{}',
  before_snapshot jsonb not null default '{}',
  projected_totals jsonb not null default '{}',
  approval_case_id uuid,
  email_draft_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint qb_quote_reprice_drafts_status_check check (
    status in ('draft','approval_pending','approved','applied','rejected','stale','cancelled')
  )
);
create trigger set_qb_quote_reprice_drafts_updated_at
before update on public.qb_quote_reprice_drafts
for each row execute function public.set_updated_at();

create table public.qb_margin_thresholds (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  brand_id uuid references public.qb_brands(id),
  min_margin_pct numeric not null
);
`;

postgresBehavior("813 + 817 behavior on scratch Postgres", () => {
  it("creates, approves, applies, rejects conflicts, reverses, and replays idempotently", () => {
    withScratchPostgres((psql) => {
      psql(scratchSchemaSql);
      psql(`\\i ${migrationPath}`);
      psql(`\\i ${retryHardeningMigrationPath}`);
      psql(`
        do $$
        declare fn text;
        begin
          foreach fn in array array[
            'public.create_qb_oem_reprice_draft_for_approval(text,uuid,uuid,text,text)',
            'public.apply_qb_oem_reprice_draft(text,uuid,uuid,text)',
            'public.reverse_qb_oem_reprice_apply(text,uuid,uuid,text)'
          ] loop
            if has_function_privilege('anon', fn, 'EXECUTE')
               or has_function_privilege('authenticated', fn, 'EXECUTE')
               or not has_function_privilege('service_role', fn, 'EXECUTE') then
              raise exception 'mutation RPC privilege mismatch: %', fn;
            end if;
          end loop;
          if has_function_privilege(
            'service_role',
            'public.qb_oem_reprice_canonical_totals(uuid)',
            'EXECUTE'
          ) then
            raise exception 'internal totals helper leaked to service_role';
          end if;
          if has_function_privilege(
               'service_role',
               'public.apply_qb_oem_reprice_draft_v813(text,uuid,uuid,text)',
               'EXECUTE'
             ) or has_function_privilege(
               'service_role',
               'public.reverse_qb_oem_reprice_apply_v813(text,uuid,uuid,text)',
               'EXECUTE'
             ) then
            raise exception 'legacy mutation implementation leaked to service_role';
          end if;
          if not has_table_privilege(
            'service_role', 'public.qb_quote_reprice_audits', 'SELECT'
          ) or has_table_privilege(
            'service_role', 'public.qb_quote_reprice_audits', 'INSERT'
          ) or has_table_privilege(
            'authenticated', 'public.qb_quote_reprice_audits', 'SELECT'
          ) then
            raise exception 'audit ledger privilege mismatch';
          end if;
        end $$;
      `);
      psql(`
        set request.jwt.claim.role = 'service_role';

        insert into public.qb_brands(id, workspace_id, code, name) values (
          'f1000000-0000-0000-0000-000000000001',
          'workspace-atomic', 'ATOMIC', 'Atomic Test'
        );
        insert into public.qb_price_sheets(
          id, workspace_id, brand_id, status
        ) values (
          'f2000000-0000-0000-0000-000000000001',
          'workspace-atomic',
          'f1000000-0000-0000-0000-000000000001',
          'extracted'
        );
        do $$
        declare v_result jsonb;
        begin
          begin
            perform public.publish_and_persist_qb_oem_price_change_event(
              'workspace-atomic',
              'f1000000-0000-0000-0000-000000000001',
              'f2000000-0000-0000-0000-000000000001',
              'f3000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000003',
              '{"force_failure":true}'::jsonb,
              current_date, 0, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, false
            );
            raise exception 'forced event failure unexpectedly committed';
          exception when others then
            if sqlerrm not like '%scratch persistence failure%' then raise; end if;
          end;
          if (select status from public.qb_price_sheets
              where id = 'f2000000-0000-0000-0000-000000000001')
             <> 'extracted' then
            raise exception 'event failure did not roll catalog publication back';
          end if;
          v_result := public.publish_and_persist_qb_oem_price_change_event(
            'workspace-atomic',
            'f1000000-0000-0000-0000-000000000001',
            'f2000000-0000-0000-0000-000000000001',
            'f3000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000003',
            '{}'::jsonb,
            current_date, 0, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, false
          );
          if (select status from public.qb_price_sheets
              where id = 'f2000000-0000-0000-0000-000000000001')
             <> 'published'
             or (v_result #>> '{publish,itemsApplied}')::integer <> 1 then
            raise exception 'composed OEM publication did not commit both results';
          end if;
        end $$;

        do $$
        declare v_applied timestamptz := '2026-07-09T12:00:00Z';
        begin
          if not public.qb_oem_reprice_reversal_within_window(
            v_applied, v_applied + interval '7 days'
          ) then
            raise exception 'exact seven-day boundary was rejected';
          end if;
          if public.qb_oem_reprice_reversal_within_window(
            v_applied, v_applied + interval '7 days 0.001 seconds'
          ) then
            raise exception 'post-boundary reversal was accepted';
          end if;
        end $$;

        begin;
        insert into public.profiles (id, full_name, role, active_workspace_id) values
          ('00000000-0000-0000-0000-000000000001', 'Rep One', 'rep', 'workspace-a'),
          ('00000000-0000-0000-0000-000000000002', 'Rep Two', 'rep', 'workspace-a'),
          ('00000000-0000-0000-0000-000000000003', 'Manager', 'manager', 'workspace-a');

        insert into public.qrm_companies (
          id, workspace_id, price_lock_active, price_lock_reason
        ) values (
          '10000000-0000-0000-0000-000000000001', 'workspace-a', true,
          'annual agreement'
        );
        insert into public.qrm_deals (
          id, workspace_id, company_id, assigned_rep_id
        ) values (
          '20000000-0000-0000-0000-000000000001', 'workspace-a',
          '10000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001'
        );
        insert into public.quote_packages (
          id, workspace_id, deal_id, created_by, status,
          equipment_total, attachment_total, subtotal, discount_total,
          trade_credit, net_total, tax_total, cash_down, amount_financed,
          margin_amount, margin_pct, commercial_discount_type,
          commercial_discount_value, requires_requote, requote_reason,
          updated_at
        ) values (
          '30000000-0000-0000-0000-000000000001', 'workspace-a',
          '20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001', 'approved',
          30000, 1000, 31000, 2050, 1000, 27950, 2000, 5000, 24950,
          4100, 14.67, 'percent', 5, true,
          'OEM price update created a material reprice impact for this quote.',
          now()
        );
        insert into public.quote_package_line_items (
          id, workspace_id, quote_package_id, make, model,
          quoted_list_price, quoted_dealer_cost, quantity, source_location,
          line_type, unit_price, extended_price, display_order,
          cost_visibility, metadata
        ) values
          ('40000000-0000-0000-0000-000000000001', 'workspace-a',
           '30000000-0000-0000-0000-000000000001', 'ASV', 'RT-40',
           10000, 8000, 1, 'factory_order', 'equipment', 10000, 10000, 1,
           'customer', '{}'),
          ('40000000-0000-0000-0000-000000000002', 'workspace-a',
           '30000000-0000-0000-0000-000000000001', 'ASV', 'RT-65',
           20000, 15000, 1, 'yard_stock', 'equipment', 20000, 20000, 2,
           'customer', '{}'),
          ('40000000-0000-0000-0000-000000000003', 'workspace-a',
           '30000000-0000-0000-0000-000000000001', null, null,
           1000, 600, 1, null, 'attachment', 1000, 1000, 3,
           'customer', '{}'),
          ('40000000-0000-0000-0000-000000000004', 'workspace-a',
           '30000000-0000-0000-0000-000000000001', null, null,
           500, null, 1, null, 'discount', 500, 500, 4,
           'customer', '{}'),
          ('40000000-0000-0000-0000-000000000005', 'workspace-a',
           '30000000-0000-0000-0000-000000000001', null, null,
           250, null, 1, null, 'pdi', 250, 250, 5,
           'internal', '{}');

        insert into public.qb_brands (id, workspace_id, code, name) values
          ('50000000-0000-0000-0000-000000000001', 'workspace-a', 'ASV', 'ASV');
        insert into public.qb_price_sheets (id, workspace_id, brand_id, status) values
          ('60000000-0000-0000-0000-000000000001', 'workspace-a',
           '50000000-0000-0000-0000-000000000001', 'superseded'),
          ('60000000-0000-0000-0000-000000000002', 'workspace-a',
           '50000000-0000-0000-0000-000000000001', 'published');
        insert into public.qb_price_change_events (
          id, workspace_id, brand_id, price_sheet_id, prior_price_sheet_id, status
        ) values (
          '70000000-0000-0000-0000-000000000001', 'workspace-a',
          '50000000-0000-0000-0000-000000000001',
          '60000000-0000-0000-0000-000000000002',
          '60000000-0000-0000-0000-000000000001', 'active'
        );
        insert into public.qb_quote_reprice_impacts (
          id, event_id, workspace_id, quote_package_id, deal_id,
          assigned_rep_id, quote_status_snapshot, quote_updated_at_snapshot,
          total_delta_cents, old_margin_pct, projected_margin_pct,
          margin_floor_pct, below_margin_floor, requires_manager_review,
          approval_required_reasons, old_commission_cents,
          projected_commission_cents, state, change_categories,
          customer_company_id, updated_at
        ) values (
          '80000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-000000000001', 'workspace-a',
          '30000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001', 'approved', now(),
          100000, 14.67, 17.47, 20, true, true,
          array['manager_review_policy','below_margin_floor'], 61500, 75750,
          'visible', array['list_price'],
          '10000000-0000-0000-0000-000000000001', now()
        );
        insert into public.qb_quote_reprice_impact_lines (
          id, impact_id, quote_package_line_item_id, model_code, make,
          quantity, old_list_price_cents, new_list_price_cents, delta_cents,
          delta_pct, source_location, is_yard_stock,
          suppressed_by_stock_lock, suppression_reason
        ) values
          ('90000000-0000-0000-0000-000000000001',
           '80000000-0000-0000-0000-000000000001',
           '40000000-0000-0000-0000-000000000001', 'RT-40', 'ASV', 1,
           1000000, 1100000, 100000, 10, 'factory_order', false, false, null),
          ('90000000-0000-0000-0000-000000000002',
           '80000000-0000-0000-0000-000000000001',
           '40000000-0000-0000-0000-000000000002', 'RT-65', 'ASV', 1,
           2000000, 2200000, 200000, 10, 'yard_stock', true, true,
           'yard_stock_price_locked');
        insert into public.quote_package_versions (
          id, workspace_id, quote_package_id, version_number,
          snapshot_json, computed_metrics_json, created_by
        ) values (
          'a0000000-0000-0000-0000-000000000001', 'workspace-a',
          '30000000-0000-0000-0000-000000000001', 7, '{}', '{}',
          '00000000-0000-0000-0000-000000000001'
        );
        insert into public.qb_margin_thresholds (
          workspace_id, brand_id, min_margin_pct
        ) values (
          'workspace-a', '50000000-0000-0000-0000-000000000001', 20
        );
        commit;
      `);

      psql(`
        set request.jwt.claim.role = 'service_role';
        do $$
        begin
          begin
            perform public.create_qb_oem_reprice_draft_for_approval(
              'workspace-a', '80000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000001', 'rep', 'review'
            );
            raise exception 'expected active customer lock failure';
          exception when others then
            if sqlerrm not like '%active OEM price lock%' then raise; end if;
          end;
        end $$;
        update public.qrm_companies
        set price_lock_active = true, price_lock_expires_at = current_date - 1
        where id = '10000000-0000-0000-0000-000000000001';

        update public.quote_package_line_items
        set equipment_override_price_cents = 999999
        where id = '40000000-0000-0000-0000-000000000001';
        do $$
        begin
          begin
            perform public.create_qb_oem_reprice_draft_for_approval(
              'workspace-a', '80000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000001', 'rep', 'review'
            );
            raise exception 'expected override projection rejection';
          exception when others then
            if sqlerrm not like '%quote line changed before OEM approval%' then raise; end if;
          end;
        end $$;
        update public.quote_package_line_items
        set equipment_override_price_cents = null
        where id = '40000000-0000-0000-0000-000000000001';

        update public.qb_quote_reprice_impact_lines
        set new_list_price_cents = null
        where id = '90000000-0000-0000-0000-000000000001';
        do $$
        begin
          begin
            perform public.create_qb_oem_reprice_draft_for_approval(
              'workspace-a', '80000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000001', 'rep', 'review'
            );
            raise exception 'expected null projection rejection';
          exception when others then
            if sqlerrm not like '%quote line changed before OEM approval%' then raise; end if;
          end;
        end $$;
        update public.qb_quote_reprice_impact_lines
        set new_list_price_cents = 1100000
        where id = '90000000-0000-0000-0000-000000000001';

        create temp table create_result as
        select public.create_qb_oem_reprice_draft_for_approval(
          'workspace-a', '80000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001', 'rep',
          'Apply current OEM list change'
        ) as payload;
        create temp table create_replay as
        select public.create_qb_oem_reprice_draft_for_approval(
          'workspace-a', '80000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001', 'rep',
          'Apply current OEM list change'
        ) as payload;

        do $$
        declare v_draft uuid; v_case uuid;
        begin
          select (payload->>'draft_id')::uuid,
                 (payload->>'approval_case_id')::uuid
            into v_draft, v_case from create_result;
          if (select status from public.qb_quote_reprice_drafts where id = v_draft)
             <> 'approval_pending' then
            raise exception 'draft was not submitted atomically';
          end if;
          if (select state from public.qb_quote_reprice_impacts
              where id = '80000000-0000-0000-0000-000000000001')
             <> 'approval_pending' then
            raise exception 'impact was not moved to approval_pending';
          end if;
          if (select policy_snapshot_json #>> '{approval_kind}'
              from public.quote_approval_cases where id = v_case)
             <> 'oem_reprice' then
            raise exception 'OEM approval kind missing';
          end if;
          if (select net_total from public.quote_approval_cases where id = v_case)
             <> 28900 then
            raise exception 'manager case did not use canonical projected net';
          end if;
          if (select (reason_summary_json ->> 'total_delta_cents')::bigint
              from public.quote_approval_cases where id = v_case)
             <> 95000 then
            raise exception 'percent-discount projected net delta mismatch';
          end if;
          if (select (projected_totals ->> 'discount_total_cents')::bigint
              from public.qb_quote_reprice_drafts where id = v_draft)
             <> 210000 then
            raise exception 'projected percent discount was not recomputed';
          end if;
          if (select (payload->>'idempotent')::boolean from create_replay)
             <> true then
            raise exception 'double create was not idempotent';
          end if;
          if (select count(*) from public.quote_approval_cases
              where oem_reprice_draft_id = v_draft) <> 1 then
            raise exception 'double create duplicated approval case';
          end if;
          perform set_config('qep.oem_reprice_internal', 'on', true);
          perform set_config(
            'request.jwt.claim.role', 'authenticated', true
          );
          begin
            update public.qb_quote_reprice_drafts
            set status = 'approved'
            where id = v_draft;
            raise exception 'expected governed status guard';
          exception when others then
            if sqlerrm not like '%governed OEM reprice service%' then raise; end if;
          end;
          begin
            update public.quote_approval_cases
            set policy_snapshot_json = policy_snapshot_json - 'approval_kind'
            where id = v_case;
            raise exception 'expected immutable OEM approval identity';
          exception when others then
            if sqlerrm not like '%governed service%' then raise; end if;
          end;
          begin
            insert into public.qb_quote_reprice_drafts (
              impact_id, quote_package_id, workspace_id, created_by, status
            ) values (
              '80000000-0000-0000-0000-000000000001',
              '40000000-0000-0000-0000-000000000001',
              'workspace-a',
              '00000000-0000-0000-0000-000000000001',
              'approval_pending'
            );
            raise exception 'expected direct draft insert rejection';
          exception when others then
            if sqlerrm not like '%governed OEM reprice service%' then raise; end if;
          end;
          perform set_config(
            'request.jwt.claim.role', 'service_role', true
          );
          begin
            update public.qb_quote_reprice_drafts
            set proposed_patch = proposed_patch || '{"tampered":true}'::jsonb
            where id = v_draft;
            raise exception 'expected submitted draft edit guard';
          exception when others then
            if sqlerrm not like '%cannot be edited in place%' then raise; end if;
          end;
        end $$;

        -- A same-quote pricing edit invalidates the long-lived approval
        -- snapshot, while the surrounding rollback restores the draft for the
        -- happy path below.
        begin;
        update public.quote_package_line_items
        set unit_price = 1001, extended_price = 1001
        where id = '40000000-0000-0000-0000-000000000003';
        do $$
        begin
          begin
            update public.quote_approval_cases approval
            set status = 'approved',
                decided_by = '00000000-0000-0000-0000-000000000003',
                decided_at = now(),
                decision_note = 'Should be stale'
            where approval.id = (
              select (payload->>'approval_case_id')::uuid from create_result
            );
            raise exception 'expected same-quote epoch conflict';
          exception when others then
            if sqlerrm not like '%pricing changed before OEM approval%' then raise; end if;
          end;
        end $$;
        rollback;

        -- Unrelated quote traffic gets a different per-quote epoch and must
        -- not invalidate this approval.
        insert into public.quote_packages (
          id, workspace_id, created_by, status, updated_at
        ) values (
          '30000000-0000-0000-0000-000000000099', 'workspace-a',
          '00000000-0000-0000-0000-000000000002', 'draft', now()
        );
        insert into public.quote_package_line_items (
          id, workspace_id, quote_package_id, quoted_list_price,
          quoted_dealer_cost, quantity, line_type, unit_price,
          extended_price, cost_visibility
        ) values (
          '40000000-0000-0000-0000-000000000099', 'workspace-a',
          '30000000-0000-0000-0000-000000000099', 5000, 4000, 1,
          'equipment', 5000, 5000, 'customer'
        );

        do $$
        begin
          begin
            update public.quote_approval_cases approval
            set
              status = 'approved',
              decided_by = '00000000-0000-0000-0000-000000000003',
              decided_at = now(),
              decision_note = '   '
            where approval.id = (
              select (payload->>'approval_case_id')::uuid from create_result
            );
            raise exception 'expected explicit margin exception reason failure';
          exception when others then
            if sqlerrm not like '%explicit exception reason%' then
              raise;
            end if;
          end;
        end $$;

        update public.quote_approval_cases approval
        set
          status = 'approved',
          decided_by = '00000000-0000-0000-0000-000000000003',
          decided_at = now(),
          decision_note = 'Approved strategic account exception'
        where approval.id = (
          select (payload->>'approval_case_id')::uuid from create_result
        );

        do $$
        declare v_draft uuid;
        begin
          select (payload->>'draft_id')::uuid into v_draft from create_result;
          if (select status from public.qb_quote_reprice_drafts where id = v_draft)
             <> 'approved' then
            raise exception 'approval did not promote draft';
          end if;
          if (select state from public.qb_quote_reprice_impacts
              where id = '80000000-0000-0000-0000-000000000001')
             <> 'approved' then
            raise exception 'approval did not promote impact';
          end if;
          if (select policy_snapshot_json #>>
                '{oem_reprice,margin_override_authorized}'
              from public.quote_approval_cases where id = (
                select (payload->>'approval_case_id')::uuid from create_result
              )) is distinct from 'true' then
            raise exception 'approval did not stamp margin authorization';
          end if;
          if (select policy_snapshot_json #>>
                '{oem_reprice,margin_override_policy_id}'
              from public.quote_approval_cases where id = (
                select (payload->>'approval_case_id')::uuid from create_result
              )) is distinct from 'OEM-DP9:below_margin_floor' then
            raise exception 'approval did not stamp concrete margin policy';
          end if;
          if (select policy_snapshot_json #>>
                '{oem_reprice,margin_override_approval_case_id}'
              from public.quote_approval_cases where id = (
                select (payload->>'approval_case_id')::uuid from create_result
              )) is distinct from (
                select payload->>'approval_case_id' from create_result
              ) then
            raise exception 'approval did not stamp exact case evidence';
          end if;
          if (select policy_snapshot_json #>>
                '{oem_reprice,margin_override_decided_by}'
              from public.quote_approval_cases where id = (
                select (payload->>'approval_case_id')::uuid from create_result
              )) is distinct from
                '00000000-0000-0000-0000-000000000003' then
            raise exception 'approval did not stamp decider evidence';
          end if;
        end $$;

        do $$
        declare v_draft uuid;
        begin
          select (payload->>'draft_id')::uuid into v_draft from create_result;
          begin
            perform public.apply_qb_oem_reprice_draft(
              'workspace-a', v_draft,
              '00000000-0000-0000-0000-000000000002', 'rep'
            );
            raise exception 'expected wrong rep failure';
          exception when others then
            if sqlerrm not like '%another rep%' then raise; end if;
          end;
        end $$;

        create temp table apply_result as
        select public.apply_qb_oem_reprice_draft(
          'workspace-a', (select (payload->>'draft_id')::uuid from create_result),
          '00000000-0000-0000-0000-000000000001', 'rep'
        ) as payload;

        -- A successful retry must resolve from immutable audit evidence even
        -- after the live assignment and source-event state have advanced.
        update public.qrm_deals
        set assigned_rep_id = '00000000-0000-0000-0000-000000000002'
        where id = (
          select quote.deal_id
          from public.quote_packages quote
          join apply_result result
            on quote.id = (result.payload->>'quote_package_id')::uuid
        );
        update public.qb_price_change_events
        set status = 'superseded'
        where id = (
          select audit.source_event_id
          from public.qb_quote_reprice_audits audit
          join apply_result result
            on audit.id = (result.payload->>'audit_id')::uuid
        );
        create temp table apply_replay as
        select public.apply_qb_oem_reprice_draft(
          'workspace-a', (select (payload->>'draft_id')::uuid from create_result),
          '00000000-0000-0000-0000-000000000001', 'rep'
        ) as payload;
        update public.qrm_deals
        set assigned_rep_id = '00000000-0000-0000-0000-000000000001'
        where assigned_rep_id = '00000000-0000-0000-0000-000000000002';
        update public.qb_price_change_events
        set status = 'active'
        where id = (
          select audit.source_event_id
          from public.qb_quote_reprice_audits audit
          join apply_result result
            on audit.id = (result.payload->>'audit_id')::uuid
        );

        do $$
        declare v_apply uuid;
        begin
          select (payload->>'audit_id')::uuid into v_apply from apply_result;
          if (select quoted_list_price from public.quote_package_line_items
              where id = '40000000-0000-0000-0000-000000000001') <> 11000 then
            raise exception 'factory line was not applied';
          end if;
          if (select quoted_list_price from public.quote_package_line_items
              where id = '40000000-0000-0000-0000-000000000002') <> 20000 then
            raise exception 'yard line was not preserved';
          end if;
          if (select net_total from public.quote_packages
              where id = '30000000-0000-0000-0000-000000000001') <> 28900 then
            raise exception 'canonical after total mismatch';
          end if;
          if (select requires_requote from public.quote_packages
              where id = '30000000-0000-0000-0000-000000000001') then
            raise exception 'single applied impact did not clear OEM flag';
          end if;
          if (select count(*) from public.qb_quote_reprice_audits
              where action = 'apply') <> 1 then
            raise exception 'double apply mutated audit twice';
          end if;
          if (select (payload->>'idempotent')::boolean from apply_replay) <> true then
            raise exception 'double apply was not idempotent';
          end if;
          if (select customer_communication_sent
              from public.qb_quote_reprice_audits where id = v_apply) then
            raise exception 'no-send invariant violated';
          end if;
        end $$;

        update public.quote_package_line_items
        set unit_price = 11000.01, extended_price = 11000.01
        where id = '40000000-0000-0000-0000-000000000001';
        do $$
        begin
          begin
            perform public.reverse_qb_oem_reprice_apply(
              'workspace-a',
              (select (payload->>'audit_id')::uuid from apply_result),
              '00000000-0000-0000-0000-000000000001', 'rep'
            );
            raise exception 'expected conflicting edit failure';
          exception when others then
            if sqlerrm not like '%totals changed%' then raise; end if;
          end;
        end $$;
        update public.quote_package_line_items
        set unit_price = 11000, extended_price = 11000
        where id = '40000000-0000-0000-0000-000000000001';

        begin;
        update public.quote_packages set status = 'accepted'
        where id = '30000000-0000-0000-0000-000000000001';
        do $$
        begin
          begin
            perform public.reverse_qb_oem_reprice_apply(
              'workspace-a',
              (select (payload->>'audit_id')::uuid from apply_result),
              '00000000-0000-0000-0000-000000000001', 'rep'
            );
            raise exception 'expected irreversible state failure';
          exception when others then
            if sqlerrm not like '%irreversible customer state%' then raise; end if;
          end;
        end $$;
        rollback;

        create temp table reverse_result as
        select public.reverse_qb_oem_reprice_apply(
          'workspace-a', (select (payload->>'audit_id')::uuid from apply_result),
          '00000000-0000-0000-0000-000000000001', 'rep'
        ) as payload;
        update public.qrm_deals
        set assigned_rep_id = '00000000-0000-0000-0000-000000000002'
        where assigned_rep_id = '00000000-0000-0000-0000-000000000001';
        update public.qb_price_change_events
        set status = 'superseded'
        where id = (
          select audit.source_event_id
          from public.qb_quote_reprice_audits audit
          join reverse_result result
            on audit.id = (result.payload->>'audit_id')::uuid
        );
        create temp table reverse_replay as
        select public.reverse_qb_oem_reprice_apply(
          'workspace-a', (select (payload->>'audit_id')::uuid from apply_result),
          '00000000-0000-0000-0000-000000000001', 'rep'
        ) as payload;

        do $$
        begin
          if (select quoted_list_price from public.quote_package_line_items
              where id = '40000000-0000-0000-0000-000000000001') <> 10000 then
            raise exception 'reversal did not restore line';
          end if;
          if (select net_total from public.quote_packages
              where id = '30000000-0000-0000-0000-000000000001') <> 27950 then
            raise exception 'reversal did not restore totals';
          end if;
          if not (select requires_requote from public.quote_packages
                  where id = '30000000-0000-0000-0000-000000000001') then
            raise exception 'reversal did not restore requote state';
          end if;
          if (select count(*) from public.qb_quote_reprice_audits) <> 2 then
            raise exception 'double reversal mutated audit twice';
          end if;
          if (select (payload->>'idempotent')::boolean from reverse_replay) <> true then
            raise exception 'double reversal was not idempotent';
          end if;
          if (select status from public.qb_quote_reprice_drafts
              where id = (select (payload->>'draft_id')::uuid from create_result))
             <> 'reversed' then
            raise exception 'draft not marked reversed';
          end if;
        end $$;

        do $$
        begin
          begin
            update public.qb_quote_reprice_audits
            set actor_role = 'owner'
            where id = (select (payload->>'audit_id')::uuid from apply_result);
            raise exception 'expected immutable audit failure';
          exception when others then
            if sqlerrm not like '%append-only%' then raise; end if;
          end;
        end $$;
      `);
    });
  });
});
