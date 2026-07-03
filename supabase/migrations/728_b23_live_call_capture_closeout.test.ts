import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "728_b23_live_call_capture_closeout.sql");
const streamSchema = readText("supabase", "migrations", "605_voice_capture_stream_sessions.sql");
const streamFunction = readText("supabase", "functions", "voice-capture-stream", "index.ts");
const streamHelpers = readText("supabase", "functions", "voice-capture-stream", "stream-helpers.ts");
const streamHelpersTest = readText("supabase", "functions", "voice-capture-stream", "stream-helpers.test.ts");
const liveCallCapture = readText("apps", "web", "src", "features", "sales", "components", "LiveCallCapture.tsx");
const customerDetailPage = readText("apps", "web", "src", "features", "sales", "pages", "CustomerDetailPage.tsx");

const compactCloseout = compact(closeoutSql);
const compactStreamSchema = compact(streamSchema);
const compactStreamFunction = compact(streamFunction);
const compactStreamHelpers = compact(streamHelpers);
const compactStreamHelpersTest = compact(streamHelpersTest);
const compactLiveCallCapture = compact(liveCallCapture);
const compactCustomerDetailPage = compact(customerDetailPage);

describe("728_b23_live_call_capture_closeout.sql contract", () => {
  it("marks only B2.3 shipped and records live-call mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b2.3'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("live customer calls from the customer record");
    expect(compactCloseout).not.toContain("where task_id = 'b2.2'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.5'");
  });

  it("keeps live-provider and local-db boundaries explicit", () => {
    expect(compactCloseout).toContain("no live customer call recording was performed");
    expect(compactCloseout).toContain("no live openai transcription call");
    expect(compactCloseout).toContain("browser microphone permission behavior was not manually exercised");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("defines idempotent stream sessions, chunks, and live-call activity metadata", () => {
    expect(compactStreamSchema).toContain("add column if not exists activity_type public.crm_activity_type not null default 'note'");
    expect(compactStreamSchema).toContain("create table if not exists public.voice_capture_stream_sessions");
    expect(compactStreamSchema).toContain("unique (workspace_id, user_id, client_session_id)");
    expect(compactStreamSchema).toContain("create table if not exists public.voice_capture_stream_chunks");
    expect(compactStreamSchema).toContain("unique (session_id, chunk_index)");
    expect(compactStreamSchema).toContain("voice_capture_stream_chunks_client_chunk_uidx");
    expect(compactStreamSchema).toContain("where client_chunk_id is not null");
    expect(compactStreamSchema).toContain("metadata ->> 'capturemode' = 'live_call'");
    expect(compactStreamSchema).toContain("alter table public.voice_capture_stream_sessions enable row level security");
    expect(compactStreamSchema).toContain("alter table public.voice_capture_stream_chunks enable row level security");
  });

  it("scopes starts to a workspace company and loads sessions with caller identity", () => {
    expect(compactStreamFunction).toContain("requireserviceuser validates the caller token");
    expect(compactStreamFunction).toContain(".from(\"crm_companies\")");
    expect(compactStreamFunction).toContain(".eq(\"workspace_id\", auth.workspaceid)");
    expect(compactStreamFunction).toContain(".is(\"deleted_at\", null)");
    expect(compactStreamFunction).toContain(".eq(\"id\", input.sessionid)");
    expect(compactStreamFunction).toContain(".eq(\"client_session_id\", input.clientsessionid)");
    expect(compactStreamFunction).toContain(".eq(\"user_id\", input.userid)");
    expect(compactStreamFunction).toContain(".eq(\"workspace_id\", input.workspaceid)");
  });

  it("handles duplicate chunk retries without creating duplicate receipts", () => {
    expect(compactStreamFunction).toContain("if (!isduplicatekeyerror(inserterror)) throw inserterror");
    expect(compactStreamFunction).toContain("chunk = await findexistingchunk(");
    expect(compactStreamFunction).toContain("chunk_id_mismatch");
    expect(compactStreamFunction).toContain("duplicate: true");
    expect(compactStreamFunction).toContain("status: \"processing\"");
    expect(compactStreamFunction).toContain("origin, 202");
    expect(compactStreamFunction).toContain("storagepath = `${auth.userid}/live-call/${session.id}/${action.chunkindex}.${extension}`");
  });

  it("rejects missing chunks and builds the final transcript in chunk order", () => {
    expect(compactStreamHelpers).toContain("export function findmissingchunkindexes");
    expect(compactStreamHelpers).toContain("for (let i = 0; i < expectedcount; i += 1)");
    expect(compactStreamHelpers).toContain("export function buildfinaltranscript");
    expect(compactStreamHelpers).toContain(".sort(([left], [right]) => left - right)");
    expect(compactStreamHelpersTest).toContain("reports gaps within expected count");
    expect(compactStreamHelpersTest).toContain("orders chunks and ignores duplicate indexes");
    expect(compactStreamFunction).toContain("safejsonerrorwithfields(\"missing_chunks\", 409");
    expect(compactStreamFunction).toContain("sync_error: `missing chunks: ${missing.join(\",\")}`");
    expect(compactStreamFunction).toContain("empty_transcript");
  });

  it("finalizes one voice capture call and one local QRM activity receipt", () => {
    expect(compactStreamFunction).toContain(".from(\"voice_captures\")");
    expect(compactStreamFunction).toContain("id: session.id");
    expect(compactStreamFunction).toContain("activity_type: \"call\"");
    expect(compactStreamFunction).toContain("sync_status: \"processing\"");
    expect(compactStreamFunction).toContain("linked_company_id: session.company_id");
    expect(compactStreamFunction).toContain("writevoicecapturetolocalcrm(admin");
    expect(compactStreamFunction).toContain("primaryactivitytype: \"call\"");
    expect(compactStreamFunction).toContain("primaryactivitykind: \"call\"");
    expect(compactStreamFunction).toContain("capturemode: \"live_call\"");
    expect(compactStreamFunction).toContain("status: \"finalized\"");
    expect(compactStreamFunction).toContain("crm_activity_id: crmresult.noteactivityid");
  });

  it("exposes 10 second chunk capture, retry, cancel, and customer-detail refresh in the UI", () => {
    expect(compactLiveCallCapture).toContain("const chunk_ms = 10_000");
    expect(compactLiveCallCapture).toContain("recorder.start(chunk_ms)");
    expect(compactLiveCallCapture).toContain("clientchunkid: `${clientsessionidref.current}:chunk:${chunkindex}`");
    expect(compactLiveCallCapture).toContain("durationms: chunk_ms");
    expect(compactLiveCallCapture).toContain("expectedchunkcount: chunkindexref.current");
    expect(compactLiveCallCapture).toContain("retry failed chunks");
    expect(compactLiveCallCapture).toContain("action: \"cancel\"");
    expect(compactCustomerDetailPage).toContain("<livecallcapture");
    expect(compactCustomerDetailPage).toContain("transcript and qrm call receipt were attached to this customer");
    expect(compactCustomerDetailPage).toContain("invalidatequeries");
  });
});
