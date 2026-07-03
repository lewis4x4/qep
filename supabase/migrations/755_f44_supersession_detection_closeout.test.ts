import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "755_f44_supersession_detection_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const watcherSql = readText("supabase", "migrations", "608_qep_decision_supersession_watcher.sql");
const watcherTest = readText("supabase", "migrations", "608_qep_decision_supersession_watcher.test.ts");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactWatcher = compact(watcherSql);
const compactWatcherTest = compact(watcherTest);

function functionSql(source: string, functionName: string): string {
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\([\\s\\S]*?as\\s+\\$\\$[\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return compact(match?.[0] ?? "");
}

describe("755_f44_supersession_detection_closeout.sql contract", () => {
  it("marks only F4.4 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f4.4'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f44_supersession_detection_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f4.1'");
    expect(compactCloseout).not.toContain("where task_id = 'f4.2'");
    expect(compactCloseout).not.toContain("where task_id = 'f4.3'");
    expect(compactCloseout).not.toContain("where task_id = 'f5.1'");
  });

  it("pins the roadmap row and prior done evidence", () => {
    expect(compactSeed).toContain("'f4.4','f','f4','supersession detection'");
    expect(compactSeed).toContain("scope-change watcher marks decisions as superseded");
    expect(compactSeed).toContain("array['f1.1']");

    expect(compactPlan).toContain("f4.4 | f4 | supersession detection (scope-change watcher)");
    expect(compactCatalog).toContain("qep-156 | done | 2026-05-21 | f4.4");
    expect(compactCloseout).toContain("qep-156 / f4.4 supersession detection as done on 2026-05-21");
  });

  it("pins historical scope tracking and eligible decision supersession", () => {
    expect(compactWatcher).toContain("insert into public.qep_decision_blocks (decision_id, task_id) select d.id, t.task_id");
    expect(compactWatcher).toContain("on conflict do nothing");
    expect(compactWatcher).not.toMatch(/delete\s+from\s+public\.qep_decision_blocks/i);

    const maybeSupersede = functionSql(watcherSql, "fn_qep_maybe_supersede_decision");
    expect(maybeSupersede).toContain("v_previous_status not in ('open', 'escalated', 'shadow_ship')");
    expect(maybeSupersede).toContain("if v_active_task_count > 0 then return false");
    expect(maybeSupersede).toContain("t.ship_state::text in ('deferred', 'na')");
    expect(maybeSupersede).toContain("t.ship_state::text = 'shipped'");
    expect(maybeSupersede).toContain("t.blocking_decision is distinct from p_decision_code");
    expect(maybeSupersede).toContain("status = 'superseded'::public.qep_decision_status");
  });

  it("pins stale-blocker cleanup and audit payloads", () => {
    const maybeSupersede = functionSql(watcherSql, "fn_qep_maybe_supersede_decision");

    expect(maybeSupersede).toContain("v_prior_supersession_guard := current_setting('app.qep_supersession_writer', true)");
    expect(maybeSupersede).toContain("set_config('app.qep_supersession_writer', 'true', true)");
    expect(maybeSupersede).toContain("update public.qep_roadmap_tasks set blocking_decision = null");
    expect(maybeSupersede).toContain("'reason', 'stale_terminal_blocker_cleared'");
    expect(maybeSupersede).toContain("'reason', 'decision_superseded'");
    expect(maybeSupersede).toContain("'descoped_task_ids', to_jsonb(v_descoped_task_ids)");
    expect(maybeSupersede).toContain("'completed_task_ids', to_jsonb(v_completed_task_ids)");
    expect(maybeSupersede).toContain("'rescoped_task_ids', to_jsonb(v_rescoped_task_ids)");
    expect(maybeSupersede).toContain("'stale_blockers_cleared', to_jsonb(v_stale_blockers_cleared)");
  });

  it("pins trigger coverage and service-role-only sweep boundaries", () => {
    const triggerFunction = functionSql(watcherSql, "fn_qep_roadmap_tasks_track_decision_scope");
    const sweepRpc = functionSql(watcherSql, "recompute_qep_decision_supersessions");

    expect(compactWatcher).toContain("create trigger qep_roadmap_tasks_track_decision_scope");
    expect(compactWatcher).toContain("after insert or update of ship_state, blocking_decision");
    expect(triggerFunction).toContain("old.blocking_decision is distinct from new.blocking_decision");
    expect(triggerFunction).toContain("public.fn_qep_maybe_supersede_decision( old.blocking_decision");
    expect(triggerFunction).toContain("public.fn_qep_maybe_supersede_decision( new.blocking_decision");
    expect(sweepRpc).toContain("where status::text in ('open', 'escalated', 'shadow_ship')");
    expect(sweepRpc).toContain("public.fn_qep_maybe_supersede_decision(v_decision.code, null, p_actor)");
    expect(compactWatcher).toContain("revoke execute on function public.recompute_qep_decision_supersessions(text) from authenticated");
    expect(compactWatcher).toContain("grant execute on function public.recompute_qep_decision_supersessions(text) to service_role");
    expect(compactWatcher).not.toContain("grant execute on function public.recompute_qep_decision_supersessions(text) to authenticated");
  });

  it("pins focused tests and source-control boundaries", () => {
    expect(compactWatcherTest).toContain("608_qep_decision_supersession_watcher.sql f4.4 contract");
    expect(compactWatcherTest).toContain("clears stale terminal blockers and records audit events");
    expect(compactWatcherTest).toContain("tracks both old and new blocker codes without deleting historical scope");
    expect(compactWatcherTest).toContain("exposes the sweep rpc to service_role only");

    expect(compactCloseout).toContain("does not alter runtime supersession behavior");
    expect(compactCloseout).toContain("does not mark f5.1 or f5.2");
    expect(compactCloseout).toContain("no live supabase database apply");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
