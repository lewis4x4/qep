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
  "supabase/migrations/818_quote_send_oem_authorization_fence.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const compact = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(name: string): string {
  const match = sql.match(
    new RegExp(
      `create function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

describe("818 quote send/OEM authorization fence", () => {
  it("is transactional and keeps legacy delivery implementation private", () => {
    expect(compact).toContain("begin;");
    expect(compact.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain("rename to quote_send_package_commit_v599");
    expect(compact).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(compact).not.toContain(
      "grant execute on function public.quote_send_package_commit_v599",
    );
  });

  it("authorizes only current quote/version/artifact state under a quote lock", () => {
    const fn = functionSql("begin_quote_send_authorization");
    expect(fn).toContain("from public.quote_packages quote");
    expect(fn).toContain("for update");
    expect(fn).toContain("v_quote.requires_requote");
    expect(fn).toContain("version.superseded_at is null");
    expect(fn).toContain("artifact.customer_visible_at is null");
  });

  it("blocks requote transitions during delivery and rechecks at commit", () => {
    const guard = functionSql("guard_quote_requote_during_authorized_send");
    const commit = functionSql("quote_send_package_commit");
    expect(guard).toContain("quote_send_in_progress");
    expect(guard).toContain("send_auth.expires_at > now()");
    expect(commit).toContain("quote.requires_requote is not true");
    expect(commit).toContain("send_auth.status = 'authorized'");
    expect(commit).toContain("set status = 'sent'");
  });
});

function postgresBin(name: string): string | null {
  for (
    const directory of [
      "/opt/homebrew/opt/postgresql@18/bin",
      "/opt/homebrew/opt/postgresql@17/bin",
      "/opt/homebrew/opt/postgresql@16/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ]
  ) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const initdb = postgresBin("initdb");
const pgCtl = postgresBin("pg_ctl");
const psqlBin = postgresBin("psql");
const postgresBehavior = initdb && pgCtl && psqlBin ? describe : describe.skip;

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

postgresBehavior("818 behavior on scratch PostgreSQL", () => {
  it("serializes OEM requote state against authorized external delivery", () => {
    const root = mkdtempSync(join(tmpdir(), "qep-818-"));
    const data = join(root, "data");
    const socket = join(root, "socket");
    const log = join(root, "postgres.log");
    const port = String(25000 + Math.floor(Math.random() * 10_000));
    try {
      mkdirSync(socket);
      run(initdb!, ["-D", data, "--auth=trust", "--username=postgres"]);
      run(pgCtl!, [
        "-D",
        data,
        "-o",
        `-F -k ${socket} -p ${port} -c listen_addresses=''`,
        "-l",
        log,
        "start",
      ]);
      const query = (text: string) => {
        const path = join(root, `q-${Date.now()}-${Math.random()}.sql`);
        writeFileSync(path, text);
        return run(psqlBin!, [
          "-v",
          "ON_ERROR_STOP=1",
          "-h",
          socket,
          "-p",
          port,
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-f",
          path,
        ]);
      };
      query(`
        create extension pgcrypto;
        create schema auth;
        create role anon; create role authenticated; create role service_role;
        create function auth.role() returns text language sql stable as $$
          select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
        $$;
        create table public.quote_packages (
          id uuid primary key, workspace_id text not null,
          requires_requote boolean not null default false
        );
        create table public.quote_package_versions (
          id uuid primary key, workspace_id text not null,
          quote_package_id uuid not null references public.quote_packages(id),
          superseded_at timestamptz
        );
        create table public.quote_document_artifacts (
          id uuid primary key, workspace_id text not null,
          quote_package_id uuid not null references public.quote_packages(id),
          quote_package_version_id uuid not null references public.quote_package_versions(id),
          artifact_type text, storage_provider text, status text,
          customer_visible_at timestamptz
        );
        create function public.quote_send_package_commit(
          text, uuid, timestamptz, uuid, text, text, text, text,
          timestamptz, uuid, jsonb
        ) returns uuid language sql security definer as $$
          select gen_random_uuid()
        $$;
        \\i ${migrationPath}
        set request.jwt.claim.role = 'service_role';
        insert into public.quote_packages values (
          '10000000-0000-4000-8000-000000000001', 'ws', false
        );
        insert into public.quote_package_versions values (
          '20000000-0000-4000-8000-000000000001', 'ws',
          '10000000-0000-4000-8000-000000000001', null
        );
        insert into public.quote_document_artifacts values (
          '30000000-0000-4000-8000-000000000001', 'ws',
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          'customer_quote_pdf', 'r2', 'generated', null
        );
        create temp table send_auth_result as
        select public.begin_quote_send_authorization(
          'ws', '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000001', 300
        ) as id;
        do $$ begin
          begin
            update public.quote_packages set requires_requote = true;
            raise exception 'requote escaped active send fence';
          exception when serialization_failure then null;
          end;
        end $$;
        select public.quote_send_package_commit(
          'ws', '10000000-0000-4000-8000-000000000001', now(),
          '30000000-0000-4000-8000-000000000001', 'a@example.com',
          'subject', 'body', 'resend', null,
          '40000000-0000-4000-8000-000000000001', '{}'::jsonb,
          (select id from send_auth_result)
        );
        update public.quote_packages set requires_requote = true;
        do $$ begin
          if (select status from public.quote_send_authorizations
              where id = (select id from send_auth_result)) <> 'sent' then
            raise exception 'authorization did not terminalize';
          end if;
        end $$;
      `);
    } finally {
      if (existsSync(data)) {
        spawnSync(pgCtl!, ["-D", data, "-m", "fast", "stop"]);
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});
