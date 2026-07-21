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

function runAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error([stdout, stderr].filter(Boolean).join("\n")));
      }
    });
  });
}

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/834_sales_availability_alert_mute_idempotency.sql",
  ),
  "utf8",
);

async function withScratchPostgres(
  callback: (
    query: (sql: string) => string,
    queryAsync: (sql: string) => Promise<string>,
  ) => void | Promise<void>,
): Promise<void> {
  if (!initdb || !pgCtl || !psql) {
    throw new Error("Postgres behavior test invoked without server binaries");
  }

  const root = mkdtempSync(join(tmpdir(), "qep-834-"));
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

    const queryArgs = (sql: string): string[] => {
      const queryPath = join(
        root,
        `query-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
      );
      writeFileSync(queryPath, sql);
      return [
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
      ];
    };

    const query = (sql: string): string => run(psql, queryArgs(sql));
    const queryAsync = (sql: string): Promise<string> => runAsync(psql, queryArgs(sql));

    await callback(query, queryAsync);
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
create extension if not exists pgcrypto;
create schema auth;
create role anon;
create role authenticated;
create role service_role;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create function public.get_my_workspace() returns text language sql stable as $$
  select nullif(current_setting('app.workspace_id', true), '')
$$;

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create table public.profiles (
  id uuid primary key,
  role text not null default 'rep',
  is_active boolean not null default true
);

create table public.profile_workspaces (
  profile_id uuid not null references public.profiles(id),
  workspace_id text not null,
  primary key (profile_id, workspace_id)
);

create table public.sales_availability_alert_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid not null references public.profiles(id),
  muted_channel text,
  muted_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (workspace_id, user_id)
);

create trigger set_sales_availability_alert_preferences_updated_at
  before update on public.sales_availability_alert_preferences
  for each row execute function public.set_updated_at();

create table public.quote_availability_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  requested_by uuid not null references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  quote_package_id uuid,
  requested_machine_label text not null,
  customer_need text,
  urgency text not null,
  sla_due_at timestamptz
);

create table public.sales_availability_alert_queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  availability_request_id uuid not null references public.quote_availability_requests(id),
  requested_by uuid not null references public.profiles(id),
  business_dedupe_key text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  unique (workspace_id, availability_request_id),
  unique (workspace_id, business_dedupe_key)
);

create table public.sales_availability_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  alert_query_id uuid references public.sales_availability_alert_queries(id),
  recipient_user_id uuid not null references public.profiles(id),
  channel text not null,
  provider text,
  status text not null,
  next_attempt_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (workspace_id, alert_query_id, recipient_user_id, channel)
);

create trigger set_sales_availability_alert_deliveries_updated_at
  before update on public.sales_availability_alert_deliveries
  for each row execute function public.set_updated_at();

create table public.qrm_in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid not null references public.profiles(id),
  kind text not null,
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb
);

insert into public.profiles (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

insert into public.profile_workspaces (profile_id, workspace_id) values
  ('11111111-1111-4111-8111-111111111111', 'default'),
  ('22222222-2222-4222-8222-222222222222', 'default'),
  ('33333333-3333-4333-8333-333333333333', 'secondary'),
  ('44444444-4444-4444-8444-444444444444', 'default');
`;

const caller = String.raw`
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set app.workspace_id = 'default';
`;

const ownSnapshot = String.raw`
select md5(string_agg(
  concat_ws('|',
    metadata ->> 'key',
    status,
    coalesce(next_attempt_at::text, ''),
    metadata::text,
    updated_at::text
  ),
  E'\n' order by metadata ->> 'key'
))
from public.sales_availability_alert_deliveries
where workspace_id = 'default'
  and recipient_user_id = '11111111-1111-4111-8111-111111111111';
select concat_ws('|', muted_channel, coalesce(muted_until::text, ''), updated_at::text)
from public.sales_availability_alert_preferences
where workspace_id = 'default'
  and user_id = '11111111-1111-4111-8111-111111111111';
`;

postgresBehavior("834 behavior on scratch Postgres", () => {
  it("preserves schedules on repeats and changes only effective transitions", async () => {
    await withScratchPostgres(async (query, queryAsync) => {
      query(bootstrap);
      query(migration);

      const privileges = query(String.raw`
select concat_ws('|',
  has_function_privilege('authenticated', 'public.set_sales_availability_alert_mute(text,timestamptz)', 'execute')::text,
  has_function_privilege('service_role', 'public.set_sales_availability_alert_mute(text,timestamptz)', 'execute')::text,
  has_function_privilege('anon', 'public.set_sales_availability_alert_mute(text,timestamptz)', 'execute')::text,
  has_function_privilege('authenticated', 'public.reconcile_my_sales_availability_alert_mute_expiry()', 'execute')::text,
  has_function_privilege('service_role', 'public.reconcile_expired_sales_availability_alert_mutes()', 'execute')::text,
  has_function_privilege('service_role', 'public.enqueue_sales_availability_alert(uuid)', 'execute')::text,
  has_function_privilege('authenticated', 'public.enqueue_sales_availability_alert(uuid)', 'execute')::text
);
`).trim();
      expect(privileges).toBe("true|false|false|true|true|true|false");

      const authenticatedExecution = query(String.raw`
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
set app.workspace_id = 'default';
set role authenticated;
select muted_channel is null
from public.set_sales_availability_alert_mute(null, null);
select (public.reconcile_my_sales_availability_alert_mute_expiry()).id is not null;
reset role;
`).trim();
      expect(authenticatedExecution).toContain("t\nt");

      query(String.raw`
insert into public.sales_availability_alert_deliveries (
  workspace_id, recipient_user_id, channel, status, next_attempt_at, metadata
) values
  ('default', '11111111-1111-4111-8111-111111111111', 'sms', 'queued', '2030-01-01T00:00:00Z', '{"key":"sms-queued"}'),
  ('default', '11111111-1111-4111-8111-111111111111', 'sms', 'failed', '2030-01-02T00:00:00Z', '{"key":"sms-failed"}'),
  ('default', '11111111-1111-4111-8111-111111111111', 'eight_by_eight', 'queued', '2030-02-01T00:00:00Z', '{"key":"eight-queued"}'),
  ('default', '11111111-1111-4111-8111-111111111111', 'eight_by_eight', 'failed', '2030-02-02T00:00:00Z', '{"key":"eight-failed"}'),
  ('default', '11111111-1111-4111-8111-111111111111', 'sms', 'sending', null, '{"key":"terminal-sending"}'),
  ('default', '11111111-1111-4111-8111-111111111111', 'sms', 'sent', null, '{"key":"terminal-sent"}'),
  ('default', '11111111-1111-4111-8111-111111111111', 'sms', 'delivered', null, '{"key":"terminal-delivered"}'),
  ('default', '11111111-1111-4111-8111-111111111111', 'sms', 'dead_letter', '2030-03-01T00:00:00Z', '{"key":"terminal-dead"}'),
  ('default', '11111111-1111-4111-8111-111111111111', 'sms', 'cancelled', null, '{"key":"terminal-cancelled"}'),
  ('default', '22222222-2222-4222-8222-222222222222', 'sms', 'queued', '2030-04-01T00:00:00Z', '{"key":"other-user"}'),
  ('secondary', '33333333-3333-4333-8333-333333333333', 'sms', 'queued', '2030-05-01T00:00:00Z', '{"key":"other-workspace"}');
`);

      const unaffectedBefore = query(String.raw`
select md5(string_agg(row_to_json(delivery)::text, E'\n' order by metadata ->> 'key'))
from public.sales_availability_alert_deliveries delivery
where metadata ->> 'key' in (
  'eight-queued', 'eight-failed', 'terminal-sending', 'terminal-sent',
  'terminal-delivered', 'terminal-dead', 'terminal-cancelled',
  'other-user', 'other-workspace'
);
`).trim();

      query(`${caller}\nselect muted_channel from public.set_sales_availability_alert_mute('sms', null);`);

      const targetAfterMute = query(String.raw`
select string_agg(
  metadata ->> 'key' || ':' || status || ':' || coalesce(next_attempt_at::text, 'NULL'),
  E'\n' order by metadata ->> 'key'
)
from public.sales_availability_alert_deliveries
where metadata ->> 'key' in ('sms-queued', 'sms-failed');
`).trim();
      expect(targetAfterMute).toBe("sms-failed:muted:NULL\nsms-queued:muted:NULL");

      const unaffectedAfter = query(String.raw`
select md5(string_agg(row_to_json(delivery)::text, E'\n' order by metadata ->> 'key'))
from public.sales_availability_alert_deliveries delivery
where metadata ->> 'key' in (
  'eight-queued', 'eight-failed', 'terminal-sending', 'terminal-sent',
  'terminal-delivered', 'terminal-dead', 'terminal-cancelled',
  'other-user', 'other-workspace'
);
`).trim();
      expect(unaffectedAfter).toBe(unaffectedBefore);

      const firstMuteSnapshot = query(`${caller}\n${ownSnapshot}`).trim();
      query("select pg_sleep(0.02);");
      query(`${caller}\nselect muted_channel from public.set_sales_availability_alert_mute('sms', null);`);
      expect(query(`${caller}\n${ownSnapshot}`).trim()).toBe(firstMuteSnapshot);

      query(`${caller}\nselect muted_channel from public.set_sales_availability_alert_mute('eight_by_eight', null);`);
      const switched = query(String.raw`
select string_agg(metadata ->> 'key' || ':' || status, E'\n' order by metadata ->> 'key')
from public.sales_availability_alert_deliveries
where metadata ->> 'key' in ('sms-queued', 'sms-failed', 'eight-queued', 'eight-failed');
`).trim();
      expect(switched).toBe(
        "eight-failed:muted\neight-queued:muted\nsms-failed:queued\nsms-queued:queued",
      );

      const switchedSnapshot = query(`${caller}\n${ownSnapshot}`).trim();
      query("select pg_sleep(0.02);");
      query(`${caller}\nselect muted_channel from public.set_sales_availability_alert_mute('eight_by_eight', null);`);
      expect(query(`${caller}\n${ownSnapshot}`).trim()).toBe(switchedSnapshot);

      const smsBeforeUnmute = query(String.raw`
select md5(string_agg(row_to_json(delivery)::text, E'\n' order by metadata ->> 'key'))
from public.sales_availability_alert_deliveries delivery
where metadata ->> 'key' in ('sms-queued', 'sms-failed');
`).trim();
      query(`${caller}\nselect muted_channel is null from public.set_sales_availability_alert_mute(null, null);`);
      const smsAfterUnmute = query(String.raw`
select md5(string_agg(row_to_json(delivery)::text, E'\n' order by metadata ->> 'key'))
from public.sales_availability_alert_deliveries delivery
where metadata ->> 'key' in ('sms-queued', 'sms-failed');
`).trim();
      expect(smsAfterUnmute).toBe(smsBeforeUnmute);

      const allEnabledSnapshot = query(`${caller}\n${ownSnapshot}`).trim();
      query("select pg_sleep(0.02);");
      query(`${caller}\nselect muted_channel is null from public.set_sales_availability_alert_mute(null, null);`);
      expect(query(`${caller}\n${ownSnapshot}`).trim()).toBe(allEnabledSnapshot);

      query(`${caller}\nselect muted_channel from public.set_sales_availability_alert_mute('sms', null);`);
      query(String.raw`
insert into public.quote_availability_requests (
  id, workspace_id, requested_by, assigned_to,
  requested_machine_label, customer_need, urgency, sla_due_at
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'default',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'ASV RT-135',
  'Customer demo',
  'normal',
  '2030-06-01T00:00:00Z'
);
set role service_role;
select public.enqueue_sales_availability_alert(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
reset role;
`);
      const enqueuedStatuses = query(String.raw`
select string_agg(channel || ':' || status, E'\n' order by channel)
from public.sales_availability_alert_deliveries
where alert_query_id is not null
  and recipient_user_id = '11111111-1111-4111-8111-111111111111';
`).trim();
      expect(enqueuedStatuses).toBe("eight_by_eight:queued\nsms:muted");

      const enqueueSnapshot = query(String.raw`
select md5(string_agg(row_to_json(delivery)::text, E'\n' order by channel))
from public.sales_availability_alert_deliveries delivery
where alert_query_id is not null
  and recipient_user_id = '11111111-1111-4111-8111-111111111111';
`).trim();
      query("select pg_sleep(0.02);");
      query(String.raw`
set role service_role;
select public.enqueue_sales_availability_alert(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
reset role;
`);
      const repeatedEnqueueSnapshot = query(String.raw`
select md5(string_agg(row_to_json(delivery)::text, E'\n' order by channel))
from public.sales_availability_alert_deliveries delivery
where alert_query_id is not null
  and recipient_user_id = '11111111-1111-4111-8111-111111111111';
`).trim();
      expect(repeatedEnqueueSnapshot).toBe(enqueueSnapshot);

      query(`${caller}\nselect muted_channel is null from public.set_sales_availability_alert_mute(null, null);`);
      query(String.raw`
update public.sales_availability_alert_deliveries
set status = 'failed',
    next_attempt_at = '2035-01-01T00:00:00Z',
    metadata = metadata || '{"failed_backoff":true}'::jsonb
where alert_query_id is not null
  and recipient_user_id = '11111111-1111-4111-8111-111111111111'
  and channel = 'eight_by_eight';
`);
      const failedBeforeEnqueue = query(String.raw`
select row_to_json(delivery)::text
from public.sales_availability_alert_deliveries delivery
where alert_query_id is not null
  and recipient_user_id = '11111111-1111-4111-8111-111111111111'
  and channel = 'eight_by_eight';
`).trim();
      query(String.raw`
set role service_role;
select public.enqueue_sales_availability_alert(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
reset role;
`);
      const failedAfterEnqueue = query(String.raw`
select row_to_json(delivery)::text
from public.sales_availability_alert_deliveries delivery
where alert_query_id is not null
  and recipient_user_id = '11111111-1111-4111-8111-111111111111'
  and channel = 'eight_by_eight';
`).trim();
      expect(failedAfterEnqueue).toBe(failedBeforeEnqueue);

      const muteTransaction = queryAsync(String.raw`
begin;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set app.workspace_id = 'default';
set role authenticated;
select muted_channel
from public.set_sales_availability_alert_mute('sms', null);
reset role;
select pg_sleep(1);
commit;
`);

      let muteLockHeld = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        muteLockHeld = query(String.raw`
select exists (
  select 1 from pg_catalog.pg_locks
  where locktype = 'advisory' and granted
);
`).trim() === "t";
        if (muteLockHeld) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(muteLockHeld).toBe(true);

      const concurrentEnqueue = queryAsync(String.raw`
set role service_role;
select public.enqueue_sales_availability_alert(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
reset role;
`);

      let enqueueWaitedOnLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        enqueueWaitedOnLock = query(String.raw`
select exists (
  select 1
  from pg_catalog.pg_stat_activity
  where wait_event_type = 'Lock'
    and wait_event = 'advisory'
);
`).trim() === "t";
        if (enqueueWaitedOnLock) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(enqueueWaitedOnLock).toBe(true);
      await Promise.all([muteTransaction, concurrentEnqueue]);

      const concurrentResult = query(String.raw`
select muted_channel
from public.sales_availability_alert_preferences
where workspace_id = 'default'
  and user_id = '11111111-1111-4111-8111-111111111111';
select string_agg(channel || ':' || status, E'\n' order by channel)
from public.sales_availability_alert_deliveries
where alert_query_id is not null
  and recipient_user_id = '11111111-1111-4111-8111-111111111111';
`).trim();
      expect(concurrentResult).toBe(
        "sms\neight_by_eight:failed\nsms:muted",
      );

      query(String.raw`
insert into public.sales_availability_alert_deliveries (
  workspace_id, recipient_user_id, channel, status, next_attempt_at, metadata
) values (
  'default',
  '22222222-2222-4222-8222-222222222222',
  'sms',
  'queued',
  '2031-01-01T00:00:00Z',
  '{"key":"default-no-row"}'
);
`);
      const defaultBefore = query(String.raw`
select row_to_json(delivery)::text
from public.sales_availability_alert_deliveries delivery
where metadata ->> 'key' = 'default-no-row';
`).trim();
      query(String.raw`
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set app.workspace_id = 'default';
select muted_channel is null
from public.set_sales_availability_alert_mute(null, null);
`);
      const defaultAfter = query(String.raw`
select row_to_json(delivery)::text
from public.sales_availability_alert_deliveries delivery
where metadata ->> 'key' = 'default-no-row';
`).trim();
      expect(defaultAfter).toBe(defaultBefore);

      query(`${caller}\nselect muted_channel from public.set_sales_availability_alert_mute('sms', '2000-01-01T00:00:00Z');`);
      query(String.raw`
update public.sales_availability_alert_deliveries
set status = 'muted', next_attempt_at = null, metadata = '{"key":"sms-queued","stale":true}'
where metadata ->> 'key' = 'sms-queued';
`);
      query(String.raw`
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set app.workspace_id = 'default';
set role authenticated;
select (public.reconcile_my_sales_availability_alert_mute_expiry()).muted_channel is null;
reset role;
`);
      const repaired = query(String.raw`
select status || ':' || (next_attempt_at is not null)::text
from public.sales_availability_alert_deliveries
where metadata ->> 'key' = 'sms-queued';
select muted_channel is null and muted_until is null
from public.sales_availability_alert_preferences
where workspace_id = 'default'
  and user_id = '11111111-1111-4111-8111-111111111111';
`).trim().split("\n");
      expect(repaired[0]).toBe("queued:true");
      expect(repaired[1]).toBe("t");

      query(String.raw`
update public.sales_availability_alert_preferences
set muted_channel = 'sms', muted_until = '2000-01-01T00:00:00Z'
where workspace_id = 'default'
  and user_id = '22222222-2222-4222-8222-222222222222';
update public.sales_availability_alert_deliveries
set status = 'muted', next_attempt_at = null
where metadata ->> 'key' = 'default-no-row';
`);
      const sweepResult = query(String.raw`
set role service_role;
select public.reconcile_expired_sales_availability_alert_mutes();
reset role;
`).trim();
      expect(sweepResult).toContain("\n1\n");

      const swept = query(String.raw`
select status || ':' || (next_attempt_at is not null)::text
from public.sales_availability_alert_deliveries
where metadata ->> 'key' = 'default-no-row';
select muted_channel is null and muted_until is null
from public.sales_availability_alert_preferences
where workspace_id = 'default'
  and user_id = '22222222-2222-4222-8222-222222222222';
`).trim().split("\n");
      expect(swept).toEqual(["queued:true", "t"]);
    });
  });
});
