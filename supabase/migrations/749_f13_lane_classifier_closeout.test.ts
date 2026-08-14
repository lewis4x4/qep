import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "749_f13_lane_classifier_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const logic = readText("supabase", "functions", "lane-classifier", "logic.ts");
const endpoint = readText("supabase", "functions", "lane-classifier", "handler.ts");
const logicTest = readText("supabase", "functions", "lane-classifier", "logic.test.ts");
const handlerTest = readText("supabase", "functions", "lane-classifier", "handler.test.ts");
const config = readText("supabase", "config.toml");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactLogic = compact(logic);
const compactEndpoint = compact(endpoint);
const compactLogicTest = compact(logicTest);
const compactHandlerTest = compact(handlerTest);
const compactConfig = compact(config);

describe("749_f13_lane_classifier_closeout.sql contract", () => {
  it("marks only F1.3 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f1.3'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f13_lane_classifier_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f1.4'");
    expect(compactCloseout).not.toContain("where task_id = 'f1.5'");
  });

  it("pins the canonical roadmap row and Decision Inbox V2 lane requirement", () => {
    expect(compactSeed).toContain("'f1.3','f','f1','lane classifier edge function'");
    expect(compactSeed).toContain("heuristics: touches money/contracts/schema");
    expect(compactSeed).toContain("runs on new pending_decision rows");

    expect(compactPlan).toContain("assigns auto / ratify / authorize based on reversibility heuristics");
    expect(compactPlan).toContain("touches money? touches contracts? touches schema? touches customer-facing copy?");
    expect(compactPlan).toContain("auto lane");
    expect(compactPlan).toContain("ratify lane");
    expect(compactPlan).toContain("authorize lane");
  });

  it("pins deterministic lane heuristics and AUTHORIZE precedence", () => {
    expect(compactLogic).toContain('export type decisionlane = "auto" | "ratify" | "authorize"');
    expect(compactLogic).toContain("const authorize_keywords");
    expect(compactLogic).toContain("const ratify_keywords");
    expect(compactLogic).toContain("const auto_keywords");
    expect(compactLogic).toContain("matched low-reversibility/high-risk authorize heuristics");
    expect(compactLogic).toContain("matched medium-reversibility ratify heuristics");
    expect(compactLogic).toContain("matched high-reversibility auto heuristics");

    const authorizeIndex = compactLogic.indexOf("const authorizematches");
    const ratifyIndex = compactLogic.indexOf("const ratifymatches");
    const autoIndex = compactLogic.indexOf("const automatches");
    expect(authorizeIndex).toBeGreaterThan(0);
    expect(ratifyIndex).toBeGreaterThan(authorizeIndex);
    expect(autoIndex).toBeGreaterThan(ratifyIndex);
  });

  it("pins endpoint merge, open-row fetch, and optional update behavior", () => {
    expect(compactLogic).toContain("export function mergelaneclassificationinput");
    expect(compactEndpoint).toContain("fetchopendecision");
    expect(compactEndpoint).toContain(".eq(\"status\", \"open\")");
    expect(compactEndpoint).toContain("decision_id");
    expect(compactEndpoint).toContain("decision_code");
    expect(compactEndpoint).toContain("const classification = classifydecisionlane(mergedinput)");
    expect(compactEndpoint).toContain("if (body.apply_update === true)");
    expect(compactEndpoint).toContain("updated_decision: updateddecision");
    expect(compactEndpoint).toContain("matched_keywords: classification.matchedkeywords");
    expect(compactEndpoint).toContain("isservicerolecaller");
    expect(compactConfig).toContain("[functions.lane-classifier]");
  });

  it("pins focused edge-function tests and source-control boundaries", () => {
    expect(compactLogicTest).toContain("classifies authorize when high-risk keywords are present");
    expect(compactLogicTest).toContain("classifies auto when reversible low-risk defaults are present");
    expect(compactLogicTest).toContain("classifies ratify for mid-reversibility policy/integration choices");
    expect(compactLogicTest).toContain("authorize takes precedence over auto keywords");
    expect(compactLogicTest).toContain("merged persisted payload is used for classification when request is sparse");
    expect(compactHandlerTest).toContain("rejects unauthenticated post without db access");
    expect(compactHandlerTest).toContain("accepts bearer service caller for classify-only");
    expect(compactHandlerTest).toContain("accepts internal secret caller and can apply_update");

    expect(compactCloseout).toContain("does not mark f1.4");
    expect(compactCloseout).toContain("no live supabase edge invocation");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
