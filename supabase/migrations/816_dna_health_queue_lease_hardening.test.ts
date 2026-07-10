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
  "816_dna_health_queue_lease_hardening.sql",
);
const refreshPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "_shared",
  "customer-profile-refresh.ts",
);
const workerPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "_shared",
  "dge-refresh-worker.ts",
);
const healthPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "health-score-refresh",
  "handler.ts",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();
const refreshSource = readFileSync(refreshPath, "utf8");
const workerSource = readFileSync(workerPath, "utf8");
const healthSource = readFileSync(healthPath, "utf8");

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

describe("816 DNA and health fix-forward contracts", () => {
  it("keeps the release fix-forward and transaction-bound", () => {
    expect(compactSql.trim().startsWith("-- migration 816")).toBe(true);
    expect(compactSql).toContain("migration 814 is already deployed");
    expect(compactSql).toContain("intentionally not amended");
    expect(compactSql).toContain("begin;");
    expect(compactSql.trim().endsWith("commit;")).toBe(true);
    // Managed Supabase has no legacy app-settings service-role GUCs; cron must
    // use vault x-internal-service-secret (N5.1 / m787-m788 pattern).
    expect(compactSql).toContain("x-internal-service-secret");
    expect(compactSql).toContain(
      "from vault.decrypted_secrets where name = 'internal_service_secret'",
    );
    expect(compactSql).toContain("health-score-refresh");
    expect(compactSql).not.toMatch(
      /authorization',\s*format\(\s*'bearer/i,
    );
    expect(compactSql).not.toMatch(/current_setting\(\s*'app\.settings\./i);
  });

  it("deduplicates normalized external identities across different contacts", () => {
    const fn = functionSql("get_or_create_customer_dna_profile");
    expect(compactSql).toContain(
      "primary key (workspace_id, identity_type, normalized_identifier)",
    );
    expect(compactSql).toContain(
      "normalized_identifier = lower(btrim(normalized_identifier))",
    );
    expect(fn).toContain("lower(btrim(v_hubspot_raw))");
    expect(fn).toContain("lower(btrim(v_intellidealer_raw))");
    expect(fn).toContain("order by key");
    expect(fn).toContain("pg_advisory_xact_lock");
    expect(fn).toContain("qep:customer-dna-external:");
    expect(fn.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      fn.indexOf("get_or_create_customer_dna_profile_contact_locked_814"),
    );
    expect(fn).toContain("on conflict do nothing");
    expect(compactSql).toContain(
      "revoke all on function public.get_or_create_customer_dna_profile_contact_locked_814",
    );
  });

  it("uses a non-null stable alert entity key for pending-alert idempotency", () => {
    const fn = functionSql("generate_cross_department_alerts");
    expect(compactSql).toContain(
      "alter column dedupe_entity_key set not null",
    );
    expect(compactSql).toContain(
      "workspace_id, dedupe_entity_key, alert_type, source_department",
    );
    expect(compactSql).toContain(
      "row_number() over ( partition by alert.workspace_id, alert.dedupe_entity_key, alert.alert_type, alert.source_department order by alert.created_at, alert.id )",
    );
    expect(compactSql).toContain("and ranked.duplicate_rank > 1");
    expect(compactSql).toContain("set status = 'resolved'");
    expect(compactSql).toContain(
      "resolved duplicate pending alert after stable entity-key backfill",
    );
    expect(fn).toContain(
      "'portal_customer:' || v_rec.portal_customer_id::text",
    );
    expect(fn).toContain("'fleet_item:' || v_rec.fleet_item_id::text");
    expect(fn).toContain("contact.dge_customer_profile_id");
    expect(fn).toContain(
      "on conflict ( workspace_id, dedupe_entity_key, alert_type, source_department ) where status = 'pending' do nothing",
    );
  });

  it("renews only an owned unexpired DGE lease and heartbeats in the worker", () => {
    const fn = functionSql("renew_dge_refresh_job_lease");
    expect(fn).toContain("status = 'running'");
    expect(fn).toContain("lease_token = p_lease_token");
    expect(fn).toContain("lease_expires_at > now()");
    expect(fn).toContain("get diagnostics v_rows = row_count");
    expect(compactSql).toContain(
      "grant execute on function public.renew_dge_refresh_job_lease(uuid, uuid, integer) to service_role",
    );
    expect(workerSource).toContain('p_lease_seconds: leaseSeconds');
    expect(workerSource).toContain("setInterval(() =>");
    expect(workerSource).toContain('"renew_dge_refresh_job_lease"');
    expect(workerSource).toContain("clearInterval(heartbeatId)");
  });

  it("uses leased SKIP LOCKED health jobs with bounded resumable slices", () => {
    const claim = functionSql("claim_health_score_refresh_jobs");
    const complete = functionSql("complete_health_score_refresh_job");
    const page = functionSql("list_customer_health_profiles_page");
    expect(compactSql).toContain(
      "unique (workspace_id, refresh_on)",
    );
    expect(claim).toContain("for update skip locked");
    expect(claim).toContain(
      "least(greatest(coalesce(p_limit, 2), 1), 10)",
    );
    expect(claim).toContain("lease_token = gen_random_uuid()");
    expect(complete).toContain("p_status not in ('queued', 'succeeded', 'failed')");
    expect(complete).toContain("lease_token = p_lease_token");
    expect(complete).toContain("lease_expires_at > now()");
    expect(compactSql).toContain("failure_count integer not null default 0");
    expect(complete).toContain(
      "when p_last_error is not null then failure_count + 1 else 0",
    );
    expect(page).toContain("p_after_updated_at");
    expect(page).toContain("p_after_id");
    expect(page).toContain("company.workspace_id = v_workspace_id");
    expect(page).toContain("contact.workspace_id = v_workspace_id");
    expect(compactSql).toContain(
      "create index if not exists idx_customer_profiles_health_stale_page on public.customer_profiles_extended ( coalesce(health_score_updated_at, '-infinity'::timestamptz), id )",
    );
    expect(healthSource).toContain("const CRON_JOB_BATCH_SIZE = 2");
    expect(healthSource).toContain("const SCORE_SLICE_SIZE = 20");
    expect(healthSource).toContain("const DNA_SLICE_SIZE = 5");
    expect(healthSource).not.toContain(
      ": await discoverServiceWorkspaces(admin)",
    );
    expect(compactSql).toContain("'* * * * *'");
  });

  it("keyset-pages the complete workspace DNA activity set in SQL", () => {
    const fn = functionSql("list_active_customer_dna_profiles_page");
    expect(fn).toContain("p_after_id is null or profile.id > p_after_id");
    expect(fn).toContain("parts_order.workspace_id = v_workspace_id");
    expect(fn).toContain("invoice.workspace_id = v_workspace_id");
    expect(fn).toContain("deal.workspace_id = v_workspace_id");
    expect(fn).toContain("rental_invoice.workspace_id = v_workspace_id");
    expect(fn).toContain("rental_contract.workspace_id = v_workspace_id");
    expect(fn).toContain("rental_contract.qrm_company_id = profile.crm_company_id");
    expect(fn).toContain("created_at <= p_snapshot_at");
    expect(fn).toContain("updated_at <= p_snapshot_at");
    expect(fn).not.toContain("limit 500");
    expect(fn).not.toContain("limit 200");
    expect(healthSource).not.toContain("activeCompanies");
    expect(healthSource).not.toContain(".limit(500)");
    expect(compactSql).toContain(
      "create index if not exists idx_parts_orders_health_dna_activity on public.parts_orders (workspace_id, crm_company_id, created_at desc) where crm_company_id is not null",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_customer_invoices_health_dna_activity on public.customer_invoices (workspace_id, crm_company_id, created_at desc) where crm_company_id is not null",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_qrm_deals_health_dna_activity on public.qrm_deals (workspace_id, company_id, updated_at desc) where company_id is not null and deleted_at is null",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_rental_contracts_health_dna_company on public.rental_contracts (workspace_id, qrm_company_id, id) where qrm_company_id is not null",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_rental_invoices_health_dna_activity on public.rental_invoices ( workspace_id, rental_contract_id, created_at desc ) where deleted_at is null",
    );
  });

  it("workspace-scopes every tenant-bearing DNA source query", () => {
    for (
      const table of [
        "customer_deal_history",
        "crm_deals",
        "parts_orders",
        "portal_customers",
        "customer_invoices",
        "rental_contracts",
        "rental_invoices",
      ]
    ) {
      const tableOffset = refreshSource.indexOf(`.from("${table}")`);
      expect(tableOffset).toBeGreaterThanOrEqual(0);
      const queryTail = refreshSource.slice(tableOffset, tableOffset + 500);
      expect(queryTail).toContain('.eq("workspace_id", params.workspaceId)');
    }
  });
});

function postgresBin(name: string): string | null {
  const directories = [
    process.env.QEP_POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@16/bin",
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
  ].filter((value): value is string => Boolean(value));
  for (const directory of directories) {
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

function withScratchPostgres(callback: (psql: (text: string) => string) => void) {
  if (!initdbPath || !pgCtlPath || !psqlPath) {
    throw new Error("Postgres behavior test invoked without server binaries");
  }
  const root = mkdtempSync(join(tmpdir(), "qep-dna-health-816-"));
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
    const psql = (text: string): string => {
      const path = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(path, text);
      return runCommand(psqlPath, [
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

const migration814Path = join(
  process.cwd(),
  "supabase",
  "migrations",
  "814_dna_profile_atomic_link_and_workspace_refresh.sql",
);
const migration814TestSource = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "814_dna_profile_atomic_link_and_workspace_refresh.test.ts",
  ),
  "utf8",
);
const scratch814Match = migration814TestSource.match(
  /const scratchSchemaSql = String\.raw`([\s\S]*?)`;\n\npostgresBehavior/,
);

postgresBehavior("816 behavior on scratch PostgreSQL", () => {
  it("applies after 814 and enforces identity, alert, lease, and queue invariants", () => {
    expect(scratch814Match).not.toBeNull();
    withScratchPostgres((psql) => {
      psql(scratch814Match?.[1] ?? "");
      psql(`\\i ${migration814Path}`);
      psql(`
        create table public.cross_department_alerts (
          id uuid primary key default gen_random_uuid(),
          workspace_id text not null,
          source_department text not null,
          target_department text not null,
          alert_type text not null,
          severity text not null,
          customer_profile_id uuid references public.customer_profiles_extended(id),
          title text not null,
          body text,
          context_entity_type text,
          context_entity_id uuid,
          status text not null default 'pending',
          resolved_at timestamptz,
          resolution_notes text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create table public.customer_deal_history (
          id uuid primary key default gen_random_uuid(),
          customer_profile_id uuid not null
            references public.customer_profiles_extended(id),
          deal_date timestamptz not null default now()
        );
        create unique index uq_xdept_alerts_dedup
          on public.cross_department_alerts (
            workspace_id, customer_profile_id, alert_type, source_department
          ) where status = 'pending';
        insert into public.cross_department_alerts (
          id, workspace_id, source_department, target_department, alert_type,
          severity, title, context_entity_type, context_entity_id, status,
          created_at
        ) values
          (
            '01000000-0000-4000-8000-000000000001', 'workspace-a',
            'finance', 'sales', 'legacy_duplicate', 'warning', 'Oldest',
            'portal_customer', '02000000-0000-4000-8000-000000000001',
            'pending', '2026-01-01T00:00:00Z'
          ),
          (
            '01000000-0000-4000-8000-000000000002', 'workspace-a',
            'finance', 'sales', 'legacy_duplicate', 'warning', 'Duplicate',
            'portal_customer', '02000000-0000-4000-8000-000000000001',
            'pending', '2026-01-02T00:00:00Z'
          );
        create table public.portal_customers (
          id uuid primary key,
          workspace_id text not null,
          crm_contact_id uuid,
          first_name text not null,
          last_name text not null
        );
        create table public.customer_invoices (
          id uuid primary key,
          workspace_id text not null,
          portal_customer_id uuid not null references public.portal_customers(id),
          crm_company_id uuid references public.crm_companies(id),
          balance_due numeric not null,
          status text not null,
          due_date date not null,
          created_at timestamptz not null default now()
        );
        create table public.parts_orders (
          id uuid primary key,
          workspace_id text not null,
          crm_company_id uuid references public.crm_companies(id),
          created_at timestamptz not null default now()
        );
        create table public.qrm_deals (
          id uuid primary key,
          workspace_id text not null,
          company_id uuid references public.crm_companies(id),
          updated_at timestamptz not null default now(),
          deleted_at timestamptz
        );
        -- Match production: crm_deals is a view over the physical qrm_deals table.
        create view public.crm_deals as select * from public.qrm_deals;
        create table public.rental_contracts (
          id uuid primary key,
          workspace_id text not null,
          qrm_company_id uuid references public.crm_companies(id)
        );
        create table public.rental_invoices (
          id uuid primary key,
          workspace_id text not null,
          rental_contract_id uuid not null references public.rental_contracts(id),
          created_at timestamptz not null default now(),
          deleted_at timestamptz
        );
        create table public.customer_fleet (
          id uuid primary key,
          workspace_id text not null,
          portal_customer_id uuid not null references public.portal_customers(id),
          make text not null,
          model text not null,
          trade_in_interest boolean not null,
          is_active boolean not null
        );
      `);
      psql(`\\i ${migrationPath}`);
      psql(`
        select set_config('request.jwt.claim.role', 'service_role', false);
        do $$
        begin
          if not exists (
            select 1 from public.cross_department_alerts
            where id = '01000000-0000-4000-8000-000000000001'
              and status = 'pending'
          ) then raise exception 'deterministic oldest alert was not preserved'; end if;
          if not exists (
            select 1 from public.cross_department_alerts
            where id = '01000000-0000-4000-8000-000000000002'
              and status = 'resolved'
              and resolved_at is not null
              and resolution_notes like '%migration 816%'
          ) then raise exception 'duplicate pending alert audit was not retained'; end if;
          if (
            select count(*) from public.cross_department_alerts
            where workspace_id = 'workspace-a'
              and dedupe_entity_key =
                'portal_customer:02000000-0000-4000-8000-000000000001'
              and alert_type = 'legacy_duplicate'
              and source_department = 'finance'
              and status = 'pending'
          ) <> 1 then raise exception 'stable alert key still has duplicate pending rows'; end if;
        end $$;
        insert into public.crm_companies (id, workspace_id, name) values
          ('10000000-0000-4000-8000-000000000001', 'workspace-a', 'A');
        insert into public.profiles (id, role, active_workspace_id) values
          ('90000000-0000-4000-8000-000000000001', 'manager', 'workspace-a');
        insert into public.crm_contacts (
          id, workspace_id, first_name, last_name, primary_company_id,
          hubspot_contact_id
        ) values
          ('20000000-0000-4000-8000-000000000001', 'workspace-a', 'One', 'A',
           '10000000-0000-4000-8000-000000000001', 'Shared-ID'),
          ('20000000-0000-4000-8000-000000000002', 'workspace-a', 'Two', 'A',
           '10000000-0000-4000-8000-000000000001', 'shared-id');

        do $$
        declare v_first uuid; v_second uuid;
        begin
          v_first := public.get_or_create_customer_dna_profile(
            'workspace-a', '20000000-0000-4000-8000-000000000001',
            null, 'SHARED-ID', null
          );
          v_second := public.get_or_create_customer_dna_profile(
            'workspace-a', '20000000-0000-4000-8000-000000000002',
            null, 'shared-id', null
          );
          if v_first is distinct from v_second then
            raise exception 'normalized identity created duplicate profiles';
          end if;
          if (select count(*) from public.customer_dna_profile_identities
              where workspace_id = 'workspace-a'
                and identity_type = 'hubspot_contact'
                and normalized_identifier = 'shared-id') <> 1 then
            raise exception 'identity registry was not idempotent';
          end if;
        end $$;

        insert into public.portal_customers (
          id, workspace_id, crm_contact_id, first_name, last_name
        ) values (
          '40000000-0000-4000-8000-000000000001', 'workspace-a',
          '20000000-0000-4000-8000-000000000001', 'Portal', 'Customer'
        );
        insert into public.customer_invoices (
          id, workspace_id, portal_customer_id, crm_company_id, balance_due,
          status, due_date
        ) values (
          '50000000-0000-4000-8000-000000000001', 'workspace-a',
          '40000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001', 125, 'overdue',
          current_date - 90
        );
        insert into public.customer_fleet values (
          '60000000-0000-4000-8000-000000000001', 'workspace-a',
          '40000000-0000-4000-8000-000000000001', 'Case', '580', true, true
        );
        do $$
        begin
          if public.generate_cross_department_alerts('workspace-a') <> 2 then
            raise exception 'expected initial alerts';
          end if;
          if public.generate_cross_department_alerts('workspace-a') <> 0 then
            raise exception 'alert replay was not idempotent';
          end if;
          if exists (select 1 from public.cross_department_alerts
                     where dedupe_entity_key is null) then
            raise exception 'alert lacks stable dedupe identity';
          end if;
        end $$;

        -- More than the removed application source cap proves SQL keyset
        -- continuation sees the complete workspace activity set.
        insert into public.crm_companies (id, workspace_id, name)
        select md5('company-' || value::text)::uuid,
               'workspace-bulk',
               'Company ' || value::text
        from generate_series(1, 505) series(value);
        insert into public.customer_profiles_extended (
          id, customer_name, crm_company_id
        )
        select md5('profile-' || value::text)::uuid,
               'Profile ' || value::text,
               md5('company-' || value::text)::uuid
        from generate_series(1, 505) series(value);
        insert into public.parts_orders (
          id, workspace_id, crm_company_id, created_at
        )
        select md5('parts-' || value::text)::uuid,
               'workspace-bulk',
               md5('company-' || value::text)::uuid,
               now() - interval '1 hour'
        from generate_series(1, 505) series(value);
        do $$
        declare
          v_cursor uuid := null;
          v_page_count integer;
          v_total integer := 0;
          v_snapshot timestamptz := now();
        begin
          loop
            select count(*), (array_agg(page.id order by page.id desc))[1]
            into v_page_count, v_cursor
            from public.list_active_customer_dna_profiles_page(
              'workspace-bulk', v_snapshot, v_cursor, 100
            ) page;
            v_total := v_total + v_page_count;
            exit when v_page_count = 0;
          end loop;
          if v_total <> 505 then
            raise exception 'active DNA keyset omitted profiles: %', v_total;
          end if;
        end $$;

        insert into public.dge_refresh_jobs (
          id, workspace_id, job_type, dedupe_key, status, lease_token,
          lease_expires_at
        ) values (
          '70000000-0000-4000-8000-000000000001', 'workspace-a',
          'economic_sync_refresh', 'lease-test', 'running',
          '71000000-0000-4000-8000-000000000001', now() + interval '1 minute'
        );
        select public.renew_dge_refresh_job_lease(
          '70000000-0000-4000-8000-000000000001',
          '71000000-0000-4000-8000-000000000001', 300
        );
        do $$
        declare v_job record;
        begin
          if public.enqueue_health_score_refresh_jobs(current_date) <> 2 then
            raise exception 'health workspace enqueue was not bounded/idempotent';
          end if;
          if public.enqueue_health_score_refresh_jobs(current_date) <> 0 then
            raise exception 'health workspace enqueue duplicated daily job';
          end if;
          select * into v_job from public.claim_health_score_refresh_jobs(1, 300);
          if v_job.job_id is null or v_job.lease_token is null then
            raise exception 'health job was not leased';
          end if;
          perform public.complete_health_score_refresh_job(
            v_job.job_id, v_job.lease_token, 'queued', 'dna',
            null, null, null, null
          );
          if not exists (
            select 1 from public.health_score_refresh_jobs
            where id = v_job.job_id and status = 'queued' and phase = 'dna'
          ) then raise exception 'health continuation was not checkpointed'; end if;
        end $$;
      `);
    });
  });
});
