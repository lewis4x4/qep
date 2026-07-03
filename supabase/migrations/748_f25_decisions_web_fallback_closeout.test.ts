import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "748_f25_decisions_web_fallback_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const app = readText("apps", "web", "src", "App.tsx");
const decisionsPage = readText("apps", "web", "src", "features", "decisions", "pages", "DecisionsPage.tsx");
const triageApi = readText("apps", "web", "src", "features", "decisions", "lib", "triage-api.ts");
const triageApiTest = readText("apps", "web", "src", "features", "decisions", "lib", "__tests__", "triage-api.test.ts");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactApp = compact(app);
const compactDecisionsPage = compact(decisionsPage);
const compactTriageApi = compact(triageApi);
const compactTriageApiTest = compact(triageApiTest);

describe("748_f25_decisions_web_fallback_closeout.sql contract", () => {
  it("marks only F2.5 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f2.5'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f25_decisions_web_fallback_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'f4.3'");
  });

  it("pins the canonical roadmap row and Done catalog provenance", () => {
    expect(compactSeed).toContain("'f2.5','f','f2','/decisions web page");
    expect(compactSeed).toContain("fallback ui for owners who want to browse all open decisions");
    expect(compactSeed).toContain("swipe-driven, one decision per screen on mobile");
    expect(compactSeed).toContain("array['f1.5']");

    expect(compactPlan).toContain("`/decisions` web fallback");
    expect(compactPlan).toContain("quiet operator card ui");
    expect(compactPlan).toContain("mobile-first swipe");
    expect(compactCatalog).toContain("qep-153 | done | 2026-05-21 | f2.5");
  });

  it("pins route registration and role guard", () => {
    expect(compactApp).toContain("const decisionspage = lazy");
    expect(compactApp).toContain("path=\"/decisions\"");
    expect(compactApp).toContain("[\"admin\", \"manager\", \"owner\"].includes(profile.role)");
    expect(compactApp).toContain("<decisionspage actorname={profile.full_name || profile.email || profile.role}");
  });

  it("pins Quiet Operator queue, mobile swipe, and desktop fallback UI", () => {
    expect(compactDecisionsPage).toContain("quiet operator");
    expect(compactDecisionsPage).toContain("listdecisiontriagequeue(200)");
    expect(compactDecisionsPage).toContain("mobile decision browser");
    expect(compactDecisionsPage).toContain("ontouchstart={handletouchstart}");
    expect(compactDecisionsPage).toContain("ontouchend={handletouchend}");
    expect(compactDecisionsPage).toContain("swipe left or right to move through the queue");
    expect(compactDecisionsPage).toContain("previous");
    expect(compactDecisionsPage).toContain("next");
    expect(compactDecisionsPage).toContain("desktop decision browser");
    expect(compactDecisionsPage).toContain("queue");
  });

  it("pins decision-card content and owner action states", () => {
    expect(compactDecisionsPage).toContain("gated task impact");
    expect(compactDecisionsPage).toContain("voice memo candidate");
    expect(compactDecisionsPage).toContain("citations");
    expect(compactDecisionsPage).toContain("owner action");
    expect(compactDecisionsPage).toContain("approve");
    expect(compactDecisionsPage).toContain("block");
    expect(compactDecisionsPage).toContain("need info");
    expect(compactDecisionsPage).toContain("disabled={isbusy || !canapprove}");
    expect(compactDecisionsPage).toContain("no recommendation to approve");
    expect(compactDecisionsPage).toContain("all actions stamp owner-web metadata");
  });

  it("pins owner inbox reads and open/action audit patches", () => {
    expect(compactTriageApi).toContain("from(\"v_qep_decisions_owner_inbox\")");
    expect(compactTriageApi).toContain("open");
    expect(compactTriageApi).toContain("escalated");
    expect(compactTriageApi).toContain("shadow_ship");
    expect(compactTriageApi).toContain("owner_web_last_open");
    expect(compactTriageApi).toContain("owner_web_open_events: [...existingevents.slice(-9), openevent]");
    expect(compactTriageApi).toContain("owner_web_last_action");
    expect(compactTriageApi).toContain("resolve_qep_decision");
    expect(compactTriageApi).toContain("approved on /decisions by");
    expect(compactTriageApi).toContain("surface: \"/decisions\"");
  });

  it("pins focused tests and non-live boundaries", () => {
    expect(compactTriageApiTest).toContain("normalizes rows and filters invalid statuses");
    expect(compactTriageApiTest).toContain("falls back to legacy owner presence keys when owner_web stamp is absent");
    expect(compactTriageApiTest).toContain("builds owner approve context without directly answering the decision");
    expect(compactTriageApiTest).toContain("builds block and need-info patches without answering");
    expect(compactTriageApiTest).toContain("writes owner_web_last_open and appends capped open events");

    expect(compactCloseout).toContain("does not mark f3.1, f3.2, f4.3, f5.1, or f5.2");
    expect(compactCloseout).toContain("no live owner uat session was run");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
