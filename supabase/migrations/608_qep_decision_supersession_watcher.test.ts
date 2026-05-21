import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "608_qep_decision_supersession_watcher.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(functionName: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\([\\s\\S]*?as\\s+\\$\\$[\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").toLowerCase();
}

describe("608_qep_decision_supersession_watcher.sql F4.4 contract", () => {
  it("defines the DB-native watcher functions, trigger, and backfill", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.fn_qep_maybe_supersede_decision");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.fn_qep_roadmap_tasks_track_decision_scope");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.recompute_qep_decision_supersessions");
    expect(sql).toContain("CREATE TRIGGER qep_roadmap_tasks_track_decision_scope");
    expect(compactSql).toContain("insert into public.qep_decision_blocks (decision_id, task_id) select d.id, t.task_id");
    expect(compactSql).toContain("on conflict do nothing");
    expect(compactSql).not.toMatch(/delete\s+from\s+public\.qep_decision_blocks/i);
  });

  it("pins search_path on every new security-definer function", () => {
    for (const name of [
      "fn_qep_maybe_supersede_decision",
      "fn_qep_roadmap_tasks_track_decision_scope",
      "recompute_qep_decision_supersessions",
    ]) {
      const body = compact(functionSql(name));
      expect(body).toContain("language plpgsql security definer set search_path = public");
    }
  });

  it("only rewrites eligible decision statuses and leaves answered/superseded terminal", () => {
    const maybeSupersede = compact(functionSql("fn_qep_maybe_supersede_decision"));

    expect(maybeSupersede).toContain("v_previous_status not in ('open', 'escalated', 'shadow_ship')");
    expect(maybeSupersede).toContain("return false");
    expect(maybeSupersede).toContain("status = 'superseded'::public.qep_decision_status");
    expect(maybeSupersede).not.toContain("v_previous_status not in ('open', 'answered', 'superseded'");
  });

  it("keeps active blockers from superseding while allowing descoped/completed/rescoped scope", () => {
    const maybeSupersede = compact(functionSql("fn_qep_maybe_supersede_decision"));

    expect(maybeSupersede).toContain("t.blocking_decision = p_decision_code and t.ship_state::text in ('pending_decision', 'blocked', 'not_started', 'in_progress')");
    expect(maybeSupersede).toContain("if v_active_task_count > 0 then return false");
    expect(maybeSupersede).toContain("t.ship_state::text in ('deferred', 'na')");
    expect(maybeSupersede).toContain("t.ship_state::text = 'shipped'");
    expect(maybeSupersede).toContain("t.blocking_decision is distinct from p_decision_code");
    expect(maybeSupersede).toContain("if v_scoped_task_count = 0 then return false");
    expect(maybeSupersede).toContain("as is_unclassified");
    expect(maybeSupersede).toContain("if coalesce(array_length(v_unclassified_task_ids, 1), 0) > 0 then return false");
  });

  it("clears stale terminal blockers and records audit events", () => {
    const maybeSupersede = compact(functionSql("fn_qep_maybe_supersede_decision"));

    expect(maybeSupersede).toContain("v_prior_supersession_guard := current_setting('app.qep_supersession_writer', true)");
    expect(maybeSupersede).toContain("set_config('app.qep_supersession_writer', 'true', true)");
    expect(maybeSupersede).toContain("coalesce(nullif(v_prior_supersession_guard, ''), 'false')");
    expect(maybeSupersede).toContain("update public.qep_roadmap_tasks set blocking_decision = null");
    expect(maybeSupersede).toContain("and ship_state::text in ('deferred', 'na', 'shipped')");
    expect(maybeSupersede).toContain("'reason', 'stale_terminal_blocker_cleared'");
    expect(maybeSupersede).toContain("'reason', 'decision_superseded'");
    expect(maybeSupersede).toContain("'descoped_task_ids', to_jsonb(v_descoped_task_ids)");
    expect(maybeSupersede).toContain("'completed_task_ids', to_jsonb(v_completed_task_ids)");
    expect(maybeSupersede).toContain("'rescoped_task_ids', to_jsonb(v_rescoped_task_ids)");
    expect(maybeSupersede).toContain("'unclassified_task_ids', to_jsonb(v_unclassified_task_ids)");
    expect(maybeSupersede).toContain("'stale_blockers_cleared', to_jsonb(v_stale_blockers_cleared)");
  });

  it("tracks both old and new blocker codes without deleting historical scope", () => {
    const triggerFunction = compact(functionSql("fn_qep_roadmap_tasks_track_decision_scope"));

    expect(triggerFunction).toContain("current_setting('app.qep_supersession_writer', true) = 'true'");
    expect(triggerFunction).toContain("insert into public.qep_decision_blocks (decision_id, task_id)");
    expect(triggerFunction).toContain("on conflict do nothing");
    expect(triggerFunction).toContain("old.blocking_decision is distinct from new.blocking_decision");
    expect(triggerFunction).toContain("public.fn_qep_maybe_supersede_decision( old.blocking_decision");
    expect(triggerFunction).toContain("public.fn_qep_maybe_supersede_decision( new.blocking_decision");
    expect(triggerFunction).not.toMatch(/delete\s+from\s+public\.qep_decision_blocks/i);
  });

  it("exposes the sweep RPC to service_role only", () => {
    const rpc = compact(functionSql("recompute_qep_decision_supersessions"));

    expect(rpc).toContain("where status::text in ('open', 'escalated', 'shadow_ship')");
    expect(rpc).toContain("public.fn_qep_maybe_supersede_decision(v_decision.code, null, p_actor)");
    expect(compactSql).toContain("revoke execute on function public.fn_qep_maybe_supersede_decision(text, text, text) from public");
    expect(compactSql).toContain("revoke execute on function public.fn_qep_maybe_supersede_decision(text, text, text) from authenticated");
    expect(compactSql).toContain("revoke execute on function public.fn_qep_roadmap_tasks_track_decision_scope() from public");
    expect(compactSql).toContain("revoke execute on function public.fn_qep_roadmap_tasks_track_decision_scope() from authenticated");
    expect(compactSql).toContain("revoke execute on function public.recompute_qep_decision_supersessions(text) from public");
    expect(compactSql).toContain("revoke execute on function public.recompute_qep_decision_supersessions(text) from authenticated");
    expect(compactSql).toContain("grant execute on function public.recompute_qep_decision_supersessions(text) to service_role");
    expect(compactSql).not.toContain("grant execute on function public.recompute_qep_decision_supersessions(text) to authenticated");
  });
});
