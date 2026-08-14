import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "759_f41_precedent_similarity_matching_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const buildLog = readText("QEP (1)", "QEP_OS_BUILD_LOG_2026-05-21.md");
const decisionsSql = readText("supabase", "migrations", "595_qep_decisions.sql");
const endpoint = readText("supabase", "functions", "auto-triage-pipeline", "handler.ts");
const logic = readText("supabase", "functions", "auto-triage-pipeline", "logic.ts");
const logicTest = readText("supabase", "functions", "auto-triage-pipeline", "logic.test.ts");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactBuildLog = compact(buildLog);
const compactDecisions = compact(decisionsSql);
const compactEndpoint = compact(endpoint);
const compactLogic = compact(logic);
const compactLogicTest = compact(logicTest);

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

describe("759_f41_precedent_similarity_matching_closeout.sql contract", () => {
  it("marks only F4.1 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f4.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f41_precedent_similarity_matching_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f3.3'");
    expect(compactCloseout).not.toContain("where task_id = 'f4.2'");
  });

  it("pins the roadmap row and prior done evidence", () => {
    expect(compactSeed).toContain("'f4.1','f','f4','precedent similarity matching'");
    expect(compactSeed).toContain("qep_decision_precedents for matching patterns");
    expect(compactSeed).toContain("similarity > 0.85");
    expect(compactSeed).toContain("array['f1.1','f1.4']");

    expect(compactPlan).toContain("every answered decision becomes a row in `qep_decision_precedents`");
    expect(compactPlan).toContain("if similarity > 0.85");
    expect(compactPlan).toContain("f4.1");
    expect(compactCatalog).toContain("qep-152 | done | 2026-05-21 | f4.1");
    expect(compactBuildLog).toContain("decision precedent matching");
    expect(compactBuildLog).toContain("f4.1 / qep-152");
    expect(compactBuildLog).toContain("foundation built");
  });

  it("pins the precedent ledger schema, RLS, and promotion trigger", () => {
    expect(compactDecisions).toContain("create table if not exists public.qep_decision_precedents");
    expect(compactDecisions).toContain("source_decision_id uuid not null references public.qep_decisions(id)");
    expect(compactDecisions).toContain("pattern_summary text not null");
    expect(compactDecisions).toContain("applied_answer text not null");
    expect(compactDecisions).toContain("applied_rationale text");
    expect(compactDecisions).toContain("owner_role text");
    expect(compactDecisions).toContain("qep_decision_precedents_owner_idx");
    expect(compactDecisions).toContain("alter table public.qep_decision_precedents enable row level security");
    expect(compactDecisions).toContain("create policy qep_decision_precedents_service_role_all");
    expect(compactDecisions).toContain("create policy qep_decision_precedents_authenticated_read");

    const triggerFn = functionSql(decisionsSql, "fn_qep_decision_resolved_promote_tasks");
    expect(triggerFn).toContain("if new.status = 'answered' and new.answered_option is not null then");
    expect(triggerFn).toContain("insert into public.qep_decision_precedents");
    expect(triggerFn).toContain("(new.id, new.question_plain, new.answered_option, new.answered_rationale, new.owner_role)");
  });

  it("pins endpoint precedent lookup and explicit-write boundary", () => {
    expect(compactEndpoint).toContain("from(\"qep_decision_precedents\")");
    expect(compactEndpoint).toContain("id, source_decision_id, pattern_summary, applied_answer, applied_rationale, owner_role");
    expect(compactEndpoint).toContain("order(\"created_at\", { ascending: false })");
    expect(compactEndpoint).toContain("limit(200)");
    expect(compactEndpoint).toContain("findbestprecedentmatch");
    expect(compactEndpoint).toContain("applyprecedentrecommendation");
    expect(compactEndpoint).toContain("precedent_similarity_threshold");
    expect(compactEndpoint).toContain("if (body.apply_update === true || body.upsert === true)");
  });

  it("pins deterministic matching, evidence injection, and focused tests", () => {
    expect(compactLogic).toContain("export const precedent_similarity_threshold = 0.85");
    expect(compactLogic).toContain("export function findbestprecedentmatch");
    expect(compactLogic).toContain("export function applyprecedentrecommendation");
    expect(compactLogic).toContain("lexicalsimilarity");
    expect(compactLogic).toContain("jaccardsimilarity");
    expect(compactLogic).toContain("ownerbonus");
    expect(compactLogic).toContain("adjustedscore < threshold");
    expect(compactLogic).toContain("precedent_match");
    expect(compactLogic).toContain("similarity_score");
    expect(compactLogic).toContain("similarity_threshold");

    expect(compactLogicTest).toContain("findbestprecedentmatch returns match when similarity exceeds threshold");
    expect(compactLogicTest).toContain("findbestprecedentmatch returns null for low similarity");
    expect(compactLogicTest).toContain("applyprecedentrecommendation injects precedent evidence");
  });

  it("pins source-control and manual boundaries", () => {
    expect(compactCloseout).toContain("does not mark f4.2, f4.3, f4.4, f5.1, or f5.2");
    expect(compactCloseout).toContain("does not answer qep_decisions by itself");
    expect(compactCloseout).toContain("deterministic lexical matching, not semantic embeddings or pgvector search");
    expect(compactCloseout).toContain("no live supabase edge function invocation");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
