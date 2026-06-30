import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "652_qep_agent_work_orders.sql",
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

describe("652_qep_agent_work_orders.sql contract", () => {
  it("creates the vendor-neutral queue table with bounded attempts and iterations", () => {
    expect(compactSql).toContain("create table if not exists public.qep_agent_work_orders");
    expect(compactSql).toContain("task_id text not null references public.qep_roadmap_tasks(task_id) on delete cascade");
    expect(compactSql).toContain("preferred_runner text not null default 'claude_code'");
    expect(compactSql).toContain("status text not null default 'queued'");
    expect(compactSql).toContain("max_attempts integer not null default 3");
    expect(compactSql).toContain("max_iterations integer not null default 5");
    expect(compactSql).toContain("budget jsonb not null default '{}'::jsonb");
    expect(compactSql).toContain("source_comment_id text");
    expect(compactSql).toContain("lease_token uuid");
  });

  it("keeps command and runner vocabulary aligned to the comment-driven agent spec", () => {
    expect(compactSql).toContain("'build'");
    expect(compactSql).toContain("'research'");
    expect(compactSql).toContain("'answer'");
    expect(compactSql).toContain("'block'");
    expect(compactSql).toContain("'claude_code'");
    expect(compactSql).toContain("'cursor_background'");
    expect(compactSql).toContain("'repoprompt'");
    expect(compactSql).toContain("'github_action'");
    expect(compactSql).toContain("status in ('queued','running','done','failed','cancelled','blocked','dead_letter')");
  });

  it("normalizes slash commands and assigns safe default runners", () => {
    const normalizeFn = compact(functionSql("fn_qep_agent_work_order_command"));
    const runnerFn = compact(functionSql("fn_qep_agent_work_order_default_runner"));

    expect(normalizeFn).toContain("regexp_replace(btrim(coalesce(p_command, '')), '^/+', '')");
    expect(normalizeFn).toContain("unsupported qep agent command");
    expect(runnerFn).toContain("if v_command in ('answer', 'block') then");
    expect(runnerFn).toContain("return 'github_action'");
    expect(runnerFn).toContain("return 'claude_code'");
  });

  it("enqueues idempotently from Linear comments and records sync provenance", () => {
    const fn = compact(functionSql("enqueue_qep_agent_work_order"));

    expect(fn).toContain("public.get_my_role() not in ('admin', 'manager', 'owner')");
    expect(fn).toContain("where source_comment_id = v_source_comment_id");
    expect(compactSql).toContain("create unique index if not exists qep_agent_work_orders_source_comment_uidx");
    expect(fn).toContain("qep_agent_work_order_enqueued");
    expect(fn).toContain("insert into public.qep_roadmap_sync_events");
    expect(fn).toContain("case when v_source = 'linear_comment' then 'linear_to_supabase' else 'reconcile' end");
  });

  it("claims queued work with SKIP LOCKED leases and runner authorization", () => {
    const authFn = compact(functionSql("fn_qep_agent_work_order_authorized"));
    const claimFn = compact(functionSql("claim_qep_agent_work_order"));

    expect(authFn).toContain("auth.role() = 'service_role'");
    expect(authFn).toContain("p.is_agent_service_account = true");
    expect(claimFn).toContain("for update skip locked");
    expect(claimFn).toContain("status = 'queued'");
    expect(claimFn).toContain("status = 'running' and lease_expires_at < now()");
    expect(claimFn).toContain("lease_token = gen_random_uuid()");
    expect(claimFn).toContain("attempt_count = wo.attempt_count + 1");
  });

  it("finishes only active leases and emits terminal status events", () => {
    const fn = compact(functionSql("finish_qep_agent_work_order"));

    expect(fn).toContain("v_status not in ('done','failed','cancelled','blocked','dead_letter')");
    expect(fn).toContain("and lease_token = p_lease_token");
    expect(fn).toContain("and status = 'running'");
    expect(fn).toContain("completed_at = now()");
    expect(fn).toContain("qep_agent_work_order_finished");
  });

  it("enables RLS and grants RPC execution only to authenticated/service role callers", () => {
    expect(compactSql).toContain("alter table public.qep_agent_work_orders enable row level security");
    expect(compactSql).toContain("create policy qep_agent_work_orders_service_role_all");
    expect(compactSql).toContain("create policy qep_agent_work_orders_authenticated_read");
    expect(compactSql).toContain("grant select on public.qep_agent_work_orders to authenticated");
    expect(compactSql).toContain("revoke execute on function public.enqueue_qep_agent_work_order");
    expect(compactSql).toContain("from public, anon");
    expect(compactSql).toContain("grant execute on function public.claim_qep_agent_work_order(text, integer) to authenticated, service_role");
    expect(compactSql).toContain("grant execute on function public.finish_qep_agent_work_order(uuid, uuid, text, text, jsonb, text, jsonb) to authenticated, service_role");
  });

  it("adds F2.6 through F2.8 roadmap rows for the queue and follow-on slices", () => {
    expect(compactSql).toContain("'f2.6'");
    expect(compactSql).toContain("'agent work-order queue'");
    expect(compactSql).toContain("'shipped'");
    expect(compactSql).toContain("'supabase/migrations/652_qep_agent_work_orders.sql'");
    expect(compactSql).toContain("'f2.7'");
    expect(compactSql).toContain("'agent runner dispatcher'");
    expect(compactSql).toContain("'f2.8'");
    expect(compactSql).toContain("'agent progress comments back to linear'");
    expect(compactSql).toContain("array['f2.6','f2.7']");
  });
});
