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
    process.env.QEP_POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/libpq/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
  ].filter((value): value is string => Boolean(value))) {
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
    "supabase/migrations/833_ar_dunning_brand_copy_fix_forward.sql",
  ),
  "utf8",
);

function withScratchPostgres(
  callback: (query: (sql: string) => string) => void,
): void {
  if (!initdb || !pgCtl || !psql) {
    throw new Error("Postgres behavior test invoked without server binaries");
  }

  const root = mkdtempSync(join(tmpdir(), "qep-833-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  const port = String(25000 + Math.floor(Math.random() * 10000));

  try {
    mkdirSync(socketDir);
    run(initdb, ["-D", dataDir, "--auth=trust", "--username=postgres"]);
    run(pgCtl, [
      "-D",
      dataDir,
      "-o",
      `-F -k ${socketDir} -p ${port} -c listen_addresses=''`,
      "-l",
      logPath,
      "start",
    ]);

    const query = (sql: string): string => {
      const queryPath = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(queryPath, sql);
      return run(psql, [
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

    callback(query);
  } finally {
    if (existsSync(dataDir)) {
      spawnSync(pgCtl, ["-D", dataDir, "-m", "fast", "stop"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const bootstrap = String.raw`
create role authenticated;
create role service_role;

create table public.ar_dunning_events (
  id bigint generated always as identity primary key,
  workspace_id text not null,
  event_type text not null,
  message_stub text
);

create table public.customer_invoices (
  id bigint generated always as identity primary key,
  workspace_id text not null,
  description text
);

create table public.customer_invoice_line_items (
  id bigint generated always as identity primary key,
  workspace_id text not null,
  invoice_id bigint not null references public.customer_invoices(id),
  description text
);

create or replace function public.run_ar_dunning_cycle(
  p_workspace_id text,
  p_cycle_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id bigint;
begin
  insert into public.ar_dunning_events (
    workspace_id, event_type, message_stub
  ) values (
    p_workspace_id, 'statement', 'TODO: brand-voice'
  );

  insert into public.ar_dunning_events (
    workspace_id, event_type, message_stub
  ) values (
    p_workspace_id, 'finance_charge', 'TODO: brand-voice'
  );

  insert into public.customer_invoices (workspace_id, description)
  values (p_workspace_id, 'TODO: brand-voice finance charge')
  returning id into v_invoice_id;

  insert into public.customer_invoice_line_items (
    workspace_id, invoice_id, description
  ) values (
    p_workspace_id, v_invoice_id, 'TODO: brand-voice finance charge'
  );

  insert into public.ar_dunning_events (
    workspace_id, event_type, message_stub
  ) values (
    p_workspace_id, 'reminder_email', 'TODO: brand-voice'
  );

  insert into public.ar_dunning_events (
    workspace_id, event_type, message_stub
  ) values (
    p_workspace_id, 'auto_hold', 'TODO: brand-voice'
  );

  return jsonb_build_object('cycle_date', p_cycle_date);
end;
$$;

revoke all on function public.run_ar_dunning_cycle(text, date) from public;
grant execute on function public.run_ar_dunning_cycle(text, date)
  to authenticated, service_role;

insert into public.ar_dunning_events (
  workspace_id, event_type, message_stub
) values
  ('alpha', 'statement', 'TODO: brand-voice'),
  ('alpha', 'finance_charge', 'TODO: brand-voice'),
  ('beta', 'reminder_email', 'TODO: brand-voice'),
  ('beta', 'auto_hold', 'TODO: brand-voice'),
  ('beta', 'other', 'TODO: brand-voice'),
  ('alpha', 'statement', 'Existing approved copy');

insert into public.customer_invoices (workspace_id, description)
values
  ('alpha', 'TODO: brand-voice finance charge'),
  ('beta', 'TODO: brand-voice finance charge'),
  ('alpha', 'Existing approved invoice copy');

insert into public.customer_invoice_line_items (
  workspace_id, invoice_id, description
)
select workspace_id, id, 'TODO: brand-voice finance charge'
from public.customer_invoices
where description = 'TODO: brand-voice finance charge';
`;

postgresBehavior("833 behavior on scratch Postgres", () => {
  it("repairs existing rows and future function output without changing security", () => {
    withScratchPostgres((query) => {
      query(bootstrap);

      const before = query(String.raw`
select concat_ws('|',
  proc.proowner::regrole::text,
  proc.prosecdef::text,
  coalesce(array_to_string(proc.proconfig, ','), ''),
  has_function_privilege('authenticated', proc.oid, 'EXECUTE')::text,
  has_function_privilege('service_role', proc.oid, 'EXECUTE')::text,
  has_function_privilege('public', proc.oid, 'EXECUTE')::text
)
from pg_proc proc
where proc.oid = 'public.run_ar_dunning_cycle(text,date)'::regprocedure;
`).trim();

      expect(before).toBe('postgres|true|search_path=""|true|true|false');

      query(migration);

      const definition = query(String.raw`
select concat_ws('|',
  (position('TODO: brand-voice' in pg_get_functiondef(proc.oid)) = 0)::text,
  (position('Account statement generated' in pg_get_functiondef(proc.oid)) > 0)::text,
  (position('Monthly finance charge assessed' in pg_get_functiondef(proc.oid)) > 0)::text,
  (position('Monthly finance charge' in pg_get_functiondef(proc.oid)) > 0)::text,
  (position('Past-due payment reminder queued' in pg_get_functiondef(proc.oid)) > 0)::text,
  (position('Credit hold applied for past-due balance' in pg_get_functiondef(proc.oid)) > 0)::text
)
from pg_proc proc
where proc.oid = 'public.run_ar_dunning_cycle(text,date)'::regprocedure;
`).trim();

      expect(definition).toBe("true|true|true|true|true|true");

      const repaired = query(String.raw`
select string_agg(workspace_id || ':' || event_type || ':' || message_stub, E'\n'
  order by workspace_id, event_type, message_stub)
from public.ar_dunning_events;
`).trim();

      expect(repaired).toContain(
        "alpha:finance_charge:Monthly finance charge assessed",
      );
      expect(repaired).toContain("alpha:statement:Account statement generated");
      expect(repaired).toContain("alpha:statement:Existing approved copy");
      expect(repaired).toContain(
        "beta:auto_hold:Credit hold applied for past-due balance",
      );
      expect(repaired).toContain(
        "beta:reminder_email:Past-due payment reminder queued",
      );
      expect(repaired).toContain("beta:other:Accounts receivable event recorded");
      expect(repaired).not.toContain("TODO: brand-voice");

      const repairedInvoiceCopy = query(String.raw`
select concat_ws('|',
  count(*) filter (where description = 'Monthly finance charge'),
  count(*) filter (where position('TODO: brand-voice' in coalesce(description, '')) > 0),
  count(*) filter (where description = 'Existing approved invoice copy')
)
from public.customer_invoices;
`).trim();
      expect(repairedInvoiceCopy).toBe("2|0|1");

      const repairedLineCopy = query(String.raw`
select concat_ws('|',
  count(*) filter (where description = 'Monthly finance charge'),
  count(*) filter (where position('TODO: brand-voice' in coalesce(description, '')) > 0)
)
from public.customer_invoice_line_items;
`).trim();
      expect(repairedLineCopy).toBe("2|0");

      query("select public.run_ar_dunning_cycle('gamma', current_date);");

      const futureCopy = query(String.raw`
select concat_ws('|',
  count(*) filter (where workspace_id = 'gamma' and message_stub = 'Account statement generated'),
  count(*) filter (where workspace_id = 'gamma' and message_stub = 'Monthly finance charge assessed'),
  count(*) filter (where workspace_id = 'gamma' and message_stub = 'Past-due payment reminder queued'),
  count(*) filter (where workspace_id = 'gamma' and message_stub = 'Credit hold applied for past-due balance'),
  count(*) filter (where position('TODO: brand-voice' in coalesce(message_stub, '')) > 0)
)
from public.ar_dunning_events;
`).trim();
      expect(futureCopy).toBe("1|1|1|1|0");

      const after = query(String.raw`
select concat_ws('|',
  proc.proowner::regrole::text,
  proc.prosecdef::text,
  coalesce(array_to_string(proc.proconfig, ','), ''),
  has_function_privilege('authenticated', proc.oid, 'EXECUTE')::text,
  has_function_privilege('service_role', proc.oid, 'EXECUTE')::text,
  has_function_privilege('public', proc.oid, 'EXECUTE')::text
)
from pg_proc proc
where proc.oid = 'public.run_ar_dunning_cycle(text,date)'::regprocedure;
`).trim();

      expect(after).toBe(before);
    });
  });
});
