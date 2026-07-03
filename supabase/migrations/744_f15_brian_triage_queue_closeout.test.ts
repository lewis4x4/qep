import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "744_f15_brian_triage_queue_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const app = readText("apps", "web", "src", "App.tsx");
const page = readText("apps", "web", "src", "features", "decisions", "pages", "DecisionsTriagePage.tsx");
const api = readText("apps", "web", "src", "features", "decisions", "lib", "triage-api.ts");
const apiTest = readText("apps", "web", "src", "features", "decisions", "lib", "__tests__", "triage-api.test.ts");
const inboxView = readText("supabase", "migrations", "617_qep_decisions_owner_inbox_triage_packet.sql");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactApp = compact(app);
const compactPage = compact(page);
const compactApi = compact(api);
const compactApiTest = compact(apiTest);
const compactInboxView = compact(inboxView);

describe("744_f15_brian_triage_queue_closeout.sql contract", () => {
  it("marks only F1.5 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f1.5'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f15_brian_triage_queue_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f2.1'");
    expect(compactCloseout).not.toContain("where task_id = 'f2.5'");
  });

  it("pins the canonical roadmap row and V2 sequencing", () => {
    expect(compactSeed).toContain("'f1.5','f','f1','brian triage queue at /decisions/triage'");
    expect(compactSeed).toContain("one-tap approval of the ai auto-triage");
    expect(compactSeed).toContain("array['f1.4']");

    expect(compactPlan).toContain("brian triage queue ui at `/decisions/triage`");
    expect(compactPlan).toContain("brian triages new pending_decisions");
    expect(compactPlan).toContain("pipeline triages; brian reviews the triage");
  });

  it("pins the guarded route and one-screen queue surface", () => {
    expect(compactApp).toContain("path=\"/decisions/triage\"");
    expect(compactApp).toContain("[\"admin\", \"owner\"].includes(profile.role)");
    expect(compactApp).toContain("<decisionstriagepage />");

    expect(compactPage).toContain("brian triage queue");
    expect(compactPage).toContain("listdecisiontriagequeue(200)");
    expect(compactPage).toContain("owner rollup");
    expect(compactPage).toContain("lane aging buckets");
    expect(compactPage).toContain("authorize aging 7+ days");
    expect(compactPage).toContain("authorize 7+ day escalation list");
    expect(compactPage).toContain("recommended option");
    expect(compactPage).toContain("reversal cost");
    expect(compactPage).toContain("gated tasks");
    expect(compactPage).toContain("gated streams");
    expect(compactPage).toContain("owner presence");
    expect(compactPage).toContain("citations");
  });

  it("pins Brian approval and queued nudge metadata boundaries", () => {
    expect(compactPage).toContain("approvedecisiontriage({ decisionid, approvedby: \"brian\" })");
    expect(compactPage).toContain("brian_triage_approved_at");
    expect(compactPage).toContain("brian_triage_approved_by");
    expect(compactPage).toContain("queuebriandecisionnudge");
    expect(compactPage).toContain("brian_dm_last_nudge");
    expect(compactPage).toContain("approve triage");
    expect(compactPage).toContain("queue dm nudge");
    expect(compactPage).toContain("only record/queue metadata in ai_prep_packet");

    expect(compactApi).toContain("export async function approvedecisiontriage");
    expect(compactApi).toContain("brian_triage_approved_at: approvedat");
    expect(compactApi).toContain("brian_triage_approved_by: approvedby");
    expect(compactApi).toContain("export function buildbriandecisionnudgepatch");
    expect(compactApi).toContain("brian_dm_last_nudge");
    expect(compactApi).toContain("brian_dm_nudges: [...existingnudges, nudgeevent]");
    expect(compactApi).not.toContain("approvedecisiontriage(input: { decisionid: string; approvedby?: string }) { const { data: resolved");
  });

  it("pins the inbox view and API normalization contract", () => {
    expect(compactInboxView).toContain("create or replace view public.v_qep_decisions_owner_inbox");
    expect(compactInboxView).toContain("d.ai_prep_packet");
    expect(compactInboxView).toContain("d.status in ('open', 'escalated', 'shadow_ship')");
    expect(compactInboxView).toContain("as age_days");
    expect(compactInboxView).toContain("as gated_task_count");
    expect(compactInboxView).toContain("as gated_streams");

    expect(compactApi).toContain(".from(\"v_qep_decisions_owner_inbox\")");
    expect(compactApi).toContain("age_days, gated_task_count, gated_streams, ai_prep_packet");
    expect(compactApi).toContain("export function normalizetriagedecisionrows");
    expect(compactApi).toContain("ownerpresencesignal");
    expect(compactApi).toContain("gatedtaskcount");
    expect(compactApi).toContain("gatedstreams");

    expect(compactApiTest).toContain("normalizes rows and filters invalid statuses");
    expect(compactApiTest).toContain("falls back to legacy owner presence keys");
    expect(compactApiTest).toContain("appends queued nudge audit entries in ai_prep_packet");
  });

  it("keeps downstream and manual boundaries explicit", () => {
    expect(compactCloseout).toContain("does not mark f2.1, f2.3, f2.4, f2.5, f4.3, or f5.2");
    expect(compactCloseout).toContain("triage approval writes metadata only");
    expect(compactCloseout).toContain("does not answer, resolve, or auto-ship");
    expect(compactCloseout).toContain("does not send live slack, teams, sms, or email");
    expect(compactCloseout).toContain("no live brian approval session");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
