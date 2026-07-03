import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "750_f14_auto_triage_pipeline_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const logic = readText("supabase", "functions", "auto-triage-pipeline", "logic.ts");
const endpoint = readText("supabase", "functions", "auto-triage-pipeline", "index.ts");
const logicTest = readText("supabase", "functions", "auto-triage-pipeline", "logic.test.ts");
const config = readText("supabase", "config.toml");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactLogic = compact(logic);
const compactEndpoint = compact(endpoint);
const compactLogicTest = compact(logicTest);
const compactConfig = compact(config);

describe("750_f14_auto_triage_pipeline_closeout.sql contract", () => {
  it("marks only F1.4 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f1.4'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f14_auto_triage_pipeline_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f1.5'");
    expect(compactCloseout).not.toContain("where task_id = 'f2.1'");
  });

  it("pins the canonical roadmap row and Decision Inbox V2 sequence", () => {
    expect(compactSeed).toContain("'f1.4','f','f1','auto-triage pipeline edge function'");
    expect(compactSeed).toContain("rewriter + classifier + router + citation finder + recommender");
    expect(compactSeed).toContain("generates a draft decision row for brian to ratify");

    expect(compactPlan).toContain("question rewriter");
    expect(compactPlan).toContain("lane classifier");
    expect(compactPlan).toContain("owner router");
    expect(compactPlan).toContain("citation finder");
    expect(compactPlan).toContain("recommendation drafter");
    expect(compactPlan).toContain("brian-review queue");
    expect(compactPlan).toContain("f1.4 auto-triage pipeline ships before the inbox ui");
  });

  it("pins the deterministic draft composition pipeline", () => {
    expect(compactLogic).toContain("export function rewritequestionplain");
    expect(compactLogic).toContain("export function routeownerrole");
    expect(compactLogic).toContain("export function builddeterministiccitations");
    expect(compactLogic).toContain("export function draftrecommendation");
    expect(compactLogic).toContain("export function buildautotriagedraft");
    expect(compactLogic).toContain("classifydecisionlane");
    expect(compactLogic).toContain("triage_version: \"auto-triage-pipeline-v1\"");
    expect(compactLogic).toContain("owner_routing_reason");
    expect(compactLogic).toContain("classifier_keywords");
  });

  it("pins precedent matching and optional upsert behavior", () => {
    expect(compactLogic).toContain("export const precedent_similarity_threshold = 0.85");
    expect(compactLogic).toContain("export function findbestprecedentmatch");
    expect(compactLogic).toContain("export function applyprecedentrecommendation");
    expect(compactLogic).toContain("precedent_match");

    expect(compactEndpoint).toContain("from(\"qep_decision_precedents\")");
    expect(compactEndpoint).toContain("findbestprecedentmatch");
    expect(compactEndpoint).toContain("applyprecedentrecommendation");
    expect(compactEndpoint).toContain("if (body.apply_update === true || body.upsert === true)");
    expect(compactEndpoint).toContain("from(\"qep_decisions\")");
    expect(compactEndpoint).toContain(".upsert(");
    expect(compactEndpoint).toContain("upserted_decision");

    expect(compactConfig).toContain("[functions.auto-triage-pipeline]");
  });

  it("pins focused tests and source-control boundaries", () => {
    expect(compactLogicTest).toContain("rewritequestionplain normalizes explicit question");
    expect(compactLogicTest).toContain("routeownerrole honors keyword mapping order");
    expect(compactLogicTest).toContain("builddeterministiccitations emits stable payload-derived references");
    expect(compactLogicTest).toContain("draftrecommendation returns conservative lane defaults");
    expect(compactLogicTest).toContain("findbestprecedentmatch returns match when similarity exceeds threshold");
    expect(compactLogicTest).toContain("buildautotriagedraft reuses lane-classifier and composes triage packet");
    expect(compactLogicTest).toContain("applyprecedentrecommendation injects precedent evidence");

    expect(compactCloseout).toContain("does not mark f1.5");
    expect(compactCloseout).toContain("brian triage ui approval is f1.5");
    expect(compactCloseout).toContain("m365, sms, linear, and voice owner-channel delivery remain separate");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
