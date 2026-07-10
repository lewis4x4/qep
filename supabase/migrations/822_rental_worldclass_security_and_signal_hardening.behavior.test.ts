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
    "supabase/migrations/822_rental_worldclass_security_and_signal_hardening.sql",
  ),
  "utf8",
);

function functionSql(name: string): string {
  const match = migration.match(
    new RegExp(
      `create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  if (!match) throw new Error(`missing function ${name}`);
  return match[0];
}

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
  const root = mkdtempSync(join(tmpdir(), "qep-822-"));
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
create table public.rental_contracts (
  id uuid primary key,
  workspace_id text not null,
  contract_number text,
  equipment_id uuid,
  qrm_company_id uuid,
  lifecycle_state text not null,
  on_rent_at timestamptz,
  deleted_at timestamptz
);
create table public.rental_invoices (
  id uuid primary key,
  workspace_id text not null,
  rental_contract_id uuid not null,
  period_end date not null,
  status text not null,
  deleted_at timestamptz
);
create table public.qrm_equipment (
  id uuid primary key,
  workspace_id text not null,
  category text,
  ownership text not null,
  availability text not null,
  readiness_status text,
  deleted_at timestamptz
);
create table public.rental_contract_lines (
  id uuid primary key,
  workspace_id text not null,
  equipment_id uuid,
  status text not null,
  rental_start_at timestamptz,
  rental_end_at timestamptz,
  deleted_at timestamptz
);
create table public.rental_reservation_holds (
  id uuid primary key,
  workspace_id text not null,
  equipment_id uuid,
  equipment_category text,
  rental_contract_line_id uuid,
  status text not null,
  hold_start date not null,
  hold_end date not null,
  deleted_at timestamptz
);
${functionSql("rental_cycle_due_candidates")}
${functionSql("rental_availability_pressure")}
`;

postgresBehavior("822 rental signal behavior", () => {
  it("finds first and recurring cycle boundaries at the runner's due date", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      const output = psql(String.raw`
insert into public.rental_contracts values
  ('00000000-0000-4000-8000-000000000001', 'alpha', 'FIRST', null, null, 'on_rent', '2026-01-01T08:00:00Z', null),
  ('00000000-0000-4000-8000-000000000002', 'alpha', 'SECOND', null, null, 'on_rent', '2026-01-01T08:00:00Z', null);
insert into public.rental_invoices values
  ('10000000-0000-4000-8000-000000000001', 'alpha', '00000000-0000-4000-8000-000000000002', '2026-01-28', 'posted', null);
select contract_number || ':' || next_cycle_due
from public.rental_cycle_due_candidates('2026-01-27', 2)
order by contract_number;
select contract_number || ':' || next_cycle_due
from public.rental_cycle_due_candidates('2026-02-24', 2)
order by contract_number;
`);
      expect(output).toContain("FIRST:2026-01-29");
      expect(output).toContain("SECOND:2026-02-26");
    });
  });

  it("uses peak concurrent demand, excludes service units, and deduplicates holds", () => {
    withScratchPostgres((psql) => {
      psql(schema);
      const output = psql(String.raw`
insert into public.qrm_equipment values
  ('20000000-0000-4000-8000-000000000001', 'alpha', 'loader', 'rental_fleet', 'available', 'available', null),
  ('20000000-0000-4000-8000-000000000002', 'alpha', 'loader', 'rental_fleet', 'available', 'available', null),
  ('20000000-0000-4000-8000-000000000003', 'alpha', 'dozer', 'rental_fleet', 'available', 'available', null),
  ('20000000-0000-4000-8000-000000000004', 'alpha', 'dozer', 'rental_fleet', 'available', 'in_service', null);
insert into public.rental_contract_lines values
  ('30000000-0000-4000-8000-000000000001', 'alpha', '20000000-0000-4000-8000-000000000001', 'active', '2026-07-10', '2026-07-12', null),
  ('30000000-0000-4000-8000-000000000002', 'alpha', '20000000-0000-4000-8000-000000000002', 'active', '2026-07-13', '2026-07-15', null),
  ('30000000-0000-4000-8000-000000000003', 'alpha', '20000000-0000-4000-8000-000000000003', 'held', '2026-07-10', '2026-07-10', null);
insert into public.rental_reservation_holds values
  ('40000000-0000-4000-8000-000000000001', 'alpha', '20000000-0000-4000-8000-000000000003', null, '30000000-0000-4000-8000-000000000003', 'active', '2026-07-10', '2026-07-10', null);
select category || ':' || fleet_count || ':' || peak_demand || ':' || headroom
from public.rental_availability_pressure('2026-07-10', '2026-07-15')
order by category;
`);
      expect(output).toContain("loader:2:1:1");
      expect(output).toContain("dozer:1:1:0");
      expect(output).not.toContain("dozer:1:2:-1");
    });
  });
});
