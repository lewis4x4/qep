import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "764_f52_live_presence_dm_nudge_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const buildLog = readText("QEP (1)", "QEP_OS_BUILD_LOG_2026-05-21.md");
const decisionsPage = readText("apps", "web", "src", "features", "decisions", "pages", "DecisionsPage.tsx");
const triagePage = readText("apps", "web", "src", "features", "decisions", "pages", "DecisionsTriagePage.tsx");
const triageApi = readText("apps", "web", "src", "features", "decisions", "lib", "triage-api.ts");
const triageApiTest = readText("apps", "web", "src", "features", "decisions", "lib", "__tests__", "triage-api.test.ts");
const f15Closeout = readText("supabase", "migrations", "751_f15_brian_triage_queue_closeout.sql");
const f25Closeout = readText("supabase", "migrations", "755_f25_decisions_web_fallback_closeout.sql");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactBuildLog = compact(buildLog);
const compactDecisionsPage = compact(decisionsPage);
const compactTriagePage = compact(triagePage);
const compactApi = compact(triageApi);
const compactApiTest = compact(triageApiTest);
const compactF15Closeout = compact(f15Closeout);
const compactF25Closeout = compact(f25Closeout);

describe("764_f52_live_presence_dm_nudge_closeout.sql contract", () => {
  it("marks only F5.2 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f5.2'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f52_live_presence_dm_nudge_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f5.1'");
    expect(compactCloseout).not.toContain("where task_id = 'f2.5'");
    expect(compactCloseout).not.toContain("where task_id = 'f1.5'");
  });

  it("pins the roadmap row and prior done evidence", () => {
    expect(compactSeed).toContain("'f5.2','f','f5','brian live-presence + dm-nudge surface'");
    expect(compactSeed).toContain("brian sees \"rylee opened q6 30s ago\" + nudge button");
    expect(compactSeed).toContain("array['f1.5']");

    expect(compactPlan).toContain("no real-time presence indicator for brian");
    expect(compactPlan).toContain("rylee opened q6 30 seconds ago");
    expect(compactPlan).toContain("watch");
    expect(compactPlan).toContain("currently-open cards brian has flagged");
    expect(compactPlan).toContain("can dm-nudge from the row");
    expect(compactCatalog).toContain("qep-157 | done | 2026-05-21 | f5.2");
    expect(compactBuildLog).toContain("brian decision-bottleneck / live-presence surface");
    expect(compactBuildLog).toContain("tracking of when an owner opens the decision page");
    expect(compactBuildLog).toContain("queue dm nudge");
  });

  it("pins owner open presence stamps from the owner fallback page", () => {
    expect(compactDecisionsPage).toContain("recordownerdecisionopen({ decisionid, ownerrole, actorname })");
    expect(compactApi).toContain("export function buildownerdecisionopenpatch");
    expect(compactApi).toContain("owner_web_last_open");
    expect(compactApi).toContain("owner_web_open_events: [...existingevents.slice(-9), openevent]");
    expect(compactApi).toContain("action: \"opened\"");
    expect(compactApi).toContain("surface: \"/decisions\"");
    expect(compactApi).toContain("export async function recordownerdecisionopen");
    expect(compactApi).toContain("failed to record owner open presence");
  });

  it("pins Brian's command surface, aging buckets, presence display, and nudge controls", () => {
    expect(compactTriagePage).toContain("brian triage queue");
    expect(compactTriagePage).toContain("owner rollup");
    expect(compactTriagePage).toContain("lane aging buckets");
    expect(compactTriagePage).toContain("authorize aging 7+ days");
    expect(compactTriagePage).toContain("authorize 7+ day escalation list");
    expect(compactTriagePage).toContain("owner presence");
    expect(compactTriagePage).toContain("torelativetime(row.ownerpresenceat)");
    expect(compactTriagePage).toContain("queuebriandecisionnudge");
    expect(compactTriagePage).toContain("queue dm nudge");
    expect(compactTriagePage).toContain("only record/queue metadata in ai_prep_packet");
  });

  it("pins presence normalization and queued nudge metadata", () => {
    expect(compactApi).toContain("function resolveownerpresence");
    expect(compactApi).toContain("owner_web_last_action");
    expect(compactApi).toContain("owner_web_last_open");
    expect(compactApi).toContain("owner_opened_at");
    expect(compactApi).toContain("owner_last_seen_at");
    expect(compactApi).toContain("owner_last_presence");
    expect(compactApi).toContain("ownerpresencesignal");
    expect(compactApi).toContain("ownerpresenceat");
    expect(compactApi).toContain("export function buildbriandecisionnudgepatch");
    expect(compactApi).toContain("brian_dm_last_nudge");
    expect(compactApi).toContain("brian_dm_nudges: [...existingnudges, nudgeevent]");
    expect(compactApi).toContain("state: \"queued\"");
    expect(compactApi).toContain("surface: \"/decisions/triage\"");
    expect(compactApi).toContain("export async function queuebriandecisionnudge");
  });

  it("pins focused tests and prior closeout boundaries", () => {
    expect(compactApiTest).toContain("falls back to legacy owner presence keys when owner_web stamp is absent");
    expect(compactApiTest).toContain("writes owner_web_last_open and appends capped open events");
    expect(compactApiTest).toContain("appends queued nudge audit entries in ai_prep_packet");
    expect(compactF15Closeout).toContain("owner-presence signals");
    expect(compactF15Closeout).toContain("queued dm-nudge audit metadata");
    expect(compactF25Closeout).toContain("records owner_web_last_open and capped owner_web_open_events");

    expect(compactCloseout).toContain("does not alter runtime presence or nudge behavior");
    expect(compactCloseout).toContain("marks only f5.2 shipped");
    expect(compactCloseout).toContain("does not send live slack, teams, sms, email, or linear messages");
    expect(compactCloseout).toContain("not a new real-time websocket dependency");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
