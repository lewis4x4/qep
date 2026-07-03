import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "753_f42_decision_dependency_recompute_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const buildLog = readText("QEP (1)", "QEP_OS_BUILD_LOG_2026-05-21.md");
const recomputeSql = readText("supabase", "migrations", "620_qep_decision_dependency_recompute.sql");
const recomputeTest = readText("supabase", "migrations", "620_qep_decision_dependency_recompute.test.ts");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactBuildLog = compact(buildLog);
const compactRecompute = compact(recomputeSql);
const compactRecomputeTest = compact(recomputeTest);

function functionSql(source: string, functionName: string): string {
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\([\\s\\S]*?\\n\\$func\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return compact(match?.[0] ?? "");
}

describe("753_f42_decision_dependency_recompute_closeout.sql contract", () => {
  it("marks only F4.2 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f4.2'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f42_decision_dependency_recompute_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f4.1'");
    expect(compactCloseout).not.toContain("where task_id = 'f4.3'");
  });

  it("pins the roadmap row and prior done evidence", () => {
    expect(compactSeed).toContain("'f4.2','f','f4','decision dependency graph + auto-recompute'");
    expect(compactSeed).toContain("regenerate ai prep packet for dependent decisions");
    expect(compactSeed).toContain("array['f1.1']");

    expect(compactPlan).toContain("new column on `qep_decisions`: `unblocks_recompute_codes text[]`");
    expect(compactPlan).toContain("owner sees a fresh recommendation rather than a stale one");
    expect(compactCatalog).toContain("qep-160 | done | 2026-05-21 | f4.2");
    expect(compactBuildLog).toContain("decision dependency graph + recompute");
    expect(compactBuildLog).toContain("f4.2 / qep-160");
    expect(compactBuildLog).toContain("foundation built");
  });

  it("pins the dependency column, index, and trigger transition guard", () => {
    expect(compactRecompute).toContain("alter table public.qep_decisions add column if not exists unblocks_recompute_codes text[]");
    expect(compactRecompute).toContain("create index if not exists qep_decisions_unblocks_recompute_codes_gin_idx");
    expect(compactRecompute).toContain("using gin (unblocks_recompute_codes)");
    expect(compactRecompute).toContain("where unblocks_recompute_codes is not null and cardinality(unblocks_recompute_codes) > 0");

    const triggerFn = functionSql(recomputeSql, "fn_qep_decision_resolved_promote_tasks");
    expect(triggerFn).toContain("if not (new.status::text in ('answered','shadow_ship','superseded'))");
    expect(triggerFn).toContain("or (old.status::text in ('answered','shadow_ship','superseded')) then");
    expect(triggerFn).toContain("if coalesce(array_length(new.unblocks_recompute_codes, 1), 0) > 0 then");
  });

  it("pins active child filtering and recompute payload shape", () => {
    const triggerFn = functionSql(recomputeSql, "fn_qep_decision_resolved_promote_tasks");

    expect(triggerFn).toContain("where child.code = any(new.unblocks_recompute_codes)");
    expect(triggerFn).toContain("and child.code <> new.code");
    expect(triggerFn).toContain("and child.status::text in ('open', 'escalated', 'shadow_ship')");
    expect(triggerFn).toContain("'parent_code', new.code");
    expect(triggerFn).toContain("'parent_status', new.status::text");
    expect(triggerFn).toContain("'answered_option', new.answered_option");
    expect(triggerFn).toContain("'answered_rationale', new.answered_rationale");
    expect(triggerFn).toContain("'answered_at', new.answered_at");
    expect(triggerFn).toContain("'recomputed_at', now()");
    expect(triggerFn).toContain("'dependency_context'");
    expect(triggerFn).toContain("'parents'");
    expect(triggerFn).toContain("'last_parent_resolution'");
    expect(triggerFn).toContain("'dependency_recompute'");
  });

  it("pins focused tests and source-control boundaries", () => {
    expect(compactRecomputeTest).toContain("620_qep_decision_dependency_recompute.sql f4.2 contract");
    expect(compactRecomputeTest).toContain("keeps unblocks_recompute_codes available with index + column comment");
    expect(compactRecomputeTest).toContain("recomputes dependency context only when parent transitions into resolved status");
    expect(compactRecomputeTest).toContain("appends structured parent answer context into ai_prep_packet");

    expect(compactCloseout).toContain("does not mark f4.3, f4.4, f5.1, or f5.2");
    expect(compactCloseout).toContain("does not answer child decisions");
    expect(compactCloseout).toContain("no live supabase database apply");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
