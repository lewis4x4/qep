import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "753_f23_linear_comment_bot_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const endpoint = readText("supabase", "functions", "decision-linear-comment", "index.ts");
const logic = readText("supabase", "functions", "decision-linear-comment", "logic.ts");
const logicTest = readText("supabase", "functions", "decision-linear-comment", "logic.test.ts");
const silenceRunner = readText("supabase", "functions", "ratify-silence-runner", "index.ts");
const config = readText("supabase", "config.toml");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactEndpoint = compact(endpoint);
const compactLogic = compact(logic);
const compactLogicTest = compact(logicTest);
const compactSilenceRunner = compact(silenceRunner);
const compactConfig = compact(config);

describe("753_f23_linear_comment_bot_closeout.sql contract", () => {
  it("marks only F2.3 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f2.3'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f23_linear_comment_bot_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'f2.5'");
  });

  it("pins the canonical roadmap row and V2 Linear-channel requirement", () => {
    expect(compactSeed).toContain("'f2.3','f','f2','linear comment bot'");
    expect(compactSeed).toContain("qep-bot user posts recommendation as a linear comment");
    expect(compactSeed).toContain("array['f1.5']");

    expect(compactPlan).toContain("linear comment");
    expect(compactPlan).toContain("a qep-bot user posts the recommendation as a comment");
    expect(compactPlan).toContain("@-mentions the owner");
    expect(compactPlan).toContain("owner can reply in linear");
  });

  it("pins auth, issue resolution, dry-run, and live comment-post behavior", () => {
    expect(compactEndpoint).toContain("isservicerolecaller(req)");
    expect(compactEndpoint).toContain("requireserviceuser");
    expect(compactEndpoint).toContain("[\"admin\", \"manager\", \"owner\"].includes(auth.role)");
    expect(compactEndpoint).toContain("linear_api_key is not configured");
    expect(compactEndpoint).toContain(".from(\"qep_decisions\")");
    expect(compactEndpoint).toContain(".eq(\"status\", \"open\")");
    expect(compactEndpoint).toContain("resolvelinearissuefrompacket");
    expect(compactEndpoint).toContain(".from(\"qep_roadmap_tasks\")");
    expect(compactEndpoint).toContain("identifierfromlinearurl");
    expect(compactEndpoint).toContain("query resolveissuebyidentifier");
    expect(compactEndpoint).toContain("parseownermentionmap");
    expect(compactEndpoint).toContain("line ar_owner_mention_map_json".replace(" ", ""));
    expect(compactEndpoint).toContain("buildrecommendationcomment");
    expect(compactEndpoint).toContain("body.dry_run === true");
    expect(compactEndpoint).toContain("comment_body");
    expect(compactEndpoint).toContain("mutation postrecommendationcomment");
    expect(compactEndpoint).toContain("commentcreate(input: $input)");
    expect(compactEndpoint).toContain("https://api.linear.app/graphql");
  });

  it("pins comment composition helpers and focused tests", () => {
    expect(compactLogic).toContain("export function resolvelinearissuefrompacket");
    expect(compactLogic).toContain("linear_issue_id");
    expect(compactLogic).toContain("linearissueid");
    expect(compactLogic).toContain("export function identifierfromlinearurl");
    expect(compactLogic).toContain("export function parseownermentionmap");
    expect(compactLogic).toContain("export function buildrecommendationcomment");
    expect(compactLogic).toContain("recommendation ready for review");
    expect(compactLogic).toContain("recommended option:");
    expect(compactLogic).toContain("please approve, block, or request more info");

    expect(compactLogicTest).toContain("resolvelinearissuefrompacket reads multiple key variants");
    expect(compactLogicTest).toContain("identifierfromlinearurl extracts identifier path segment");
    expect(compactLogicTest).toContain("parseownermentionmap normalizes keys and ignores invalid values");
    expect(compactLogicTest).toContain("buildrecommendationcomment includes owner mention and decision details");
  });

  it("pins runner wiring and function registration", () => {
    expect(compactSilenceRunner).toContain("invokefunction(\"decision-linear-comment\"");
    expect(compactSilenceRunner).toContain("linear_comment");
    expect(compactConfig).toContain("[functions.decision-linear-comment]");
    expect(compactConfig).toContain("verify_jwt = false");
  });

  it("keeps live provider boundaries explicit", () => {
    expect(compactCloseout).toContain("does not mark f2.4, f2.5, f3.1, f3.2, f4.3, or f5.2");
    expect(compactCloseout).toContain("fails closed without linear_api_key");
    expect(compactCloseout).toContain("no live linear comment was posted");
    expect(compactCloseout).toContain("linear_api_key, qep-bot identity, owner mention ids");
    expect(compactCloseout).toContain("owner replies in linear and comment-webhook ingestion remain outside");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
