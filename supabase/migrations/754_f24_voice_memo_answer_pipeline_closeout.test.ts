import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "754_f24_voice_memo_answer_pipeline_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const endpoint = readText("supabase", "functions", "decision-voice-memo-answer", "index.ts");
const logic = readText("supabase", "functions", "decision-voice-memo-answer", "logic.ts");
const logicTest = readText("supabase", "functions", "decision-voice-memo-answer", "logic.test.ts");
const decisionsPage = readText("apps", "web", "src", "features", "decisions", "pages", "DecisionsPage.tsx");
const config = readText("supabase", "config.toml");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactEndpoint = compact(endpoint);
const compactLogic = compact(logic);
const compactLogicTest = compact(logicTest);
const compactDecisionsPage = compact(decisionsPage);
const compactConfig = compact(config);

describe("754_f24_voice_memo_answer_pipeline_closeout.sql contract", () => {
  it("marks only F2.4 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f2.4'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f24_voice_memo_answer_pipeline_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f2.2'");
    expect(compactCloseout).not.toContain("where task_id = 'f2.5'");
  });

  it("pins the canonical roadmap row, dependencies, and source-catalog provenance", () => {
    expect(compactSeed).toContain("'f2.4','f','f2','voice memo answer pipeline'");
    expect(compactSeed).toContain("owner records voice memo to onedrive watched folder");
    expect(compactSeed).toContain("whisper transcribes");
    expect(compactSeed).toContain("ai extracts decision");
    expect(compactSeed).toContain("owner confirms via sms or email");
    expect(compactSeed).toContain("array['f1.5','b2.2']");

    expect(compactPlan).toContain("onedrive voice-memo watcher + whisper transcription");
    expect(compactCatalog).toContain("qep-154 | done | 2026-05-21 | f2.4");
    expect(compactCatalog).toContain("voice memo answer pipeline");
  });

  it("pins auth, decision gating, and audio source routing", () => {
    expect(compactEndpoint).toContain("isservicerolecaller(req)");
    expect(compactEndpoint).toContain("requireserviceuser");
    expect(compactEndpoint).toContain("[\"admin\", \"manager\", \"owner\"].includes(auth.role)");
    expect(compactEndpoint).toContain("decision_id or decision_code is required");
    expect(compactEndpoint).toContain("const confirmable_statuses = new set([\"open\", \"escalated\", \"shadow_ship\"])");
    expect(compactEndpoint).toContain("loadaudiopayload");
    expect(compactEndpoint).toContain("if (body.graph_item) return fetchgraphaudio");
    expect(compactEndpoint).toContain("if (body.storage_path) return fetchstorageaudio");
    expect(compactEndpoint).toContain("if (body.audio_url) return fetchurlaudio");
  });

  it("pins OneDrive Graph handling and audio safety guardrails", () => {
    expect(compactEndpoint).toContain("graph_item requires sync_state_id or user_id/sender_user_id");
    expect(compactEndpoint).toContain(".from(\"onedrive_sync_state\")");
    expect(compactEndpoint).toContain("decryptonedrivetoken");
    expect(compactEndpoint).toContain("selected onedrive access token is expired");
    expect(compactEndpoint).toContain("buildgraphcontenturl");
    expect(compactEndpoint).toContain("https://graph.microsoft.com/v1.0");
    expect(compactEndpoint).toContain("const max_audio_bytes = 12 * 1024 * 1024");
    expect(compactEndpoint).toContain("resolveaudiouploadmetadata");
    expect(compactEndpoint).toContain("issupportedaudiomimetype");
    expect(compactEndpoint).toContain("audio_url must be https");
    expect(compactEndpoint).toContain("audio_url host is not allowed");
    expect(compactEndpoint).toContain("decision_voice_audio_url_allowed_hosts");
  });

  it("pins Whisper transcription, extraction fallback, and candidate persistence", () => {
    expect(compactEndpoint).toContain("openai_api_key");
    expect(compactEndpoint).toContain("https://api.openai.com/v1/audio/transcriptions");
    expect(compactEndpoint).toContain("response_format\", \"verbose_json\"");
    expect(compactEndpoint).toContain("extractdecisionactiondeterministic(transcript)");
    expect(compactEndpoint).toContain("https://api.openai.com/v1/chat/completions");
    expect(compactEndpoint).toContain("coerceaiextraction");
    expect(compactEndpoint).toContain("buildvoicememocandidatepatch");
    expect(compactEndpoint).toContain(".from(\"qep_decisions\")");
    expect(compactEndpoint).toContain("stored_packet_key: \"ai_prep_packet.voice_memo_candidate\"");
    expect(compactEndpoint).toContain("confirmation_required: true");
  });

  it("pins confirmation payloads and owner review surfaces", () => {
    expect(compactEndpoint).toContain("buildsigneddecisionactionlink");
    expect(compactEndpoint).toContain("decision_magic_link_base_url");
    expect(compactEndpoint).toContain("sms_confirmation");
    expect(compactEndpoint).toContain("email_confirmation");
    expect(compactEndpoint).toContain("dry_run: true");

    expect(compactDecisionsPage).toContain("voice_memo_candidate");
    expect(compactDecisionsPage).toContain("voice memo candidate");
    expect(compactDecisionsPage).toContain("action:");
    expect(compactDecisionsPage).toContain("rationale:");
    expect(compactDecisionsPage).toContain("transcript");
  });

  it("pins deterministic extraction helpers and focused regression tests", () => {
    expect(compactLogic).toContain("export function extractdecisionactiondeterministic");
    expect(compactLogic).toContain("owner voice memo blocks the decision until the concern is resolved");
    expect(compactLogic).toContain("owner voice memo requests more information before deciding");
    expect(compactLogic).toContain("owner voice memo approves moving forward");
    expect(compactLogic).toContain("export function coerceaiextraction");
    expect(compactLogic).toContain("export function buildvoicememocandidatepatch");
    expect(compactLogic).toContain("packet.voice_memo_candidate");
    expect(compactLogic).toContain("confirmation_required: true");

    expect(compactLogicTest).toContain("deterministic extraction prefers block over approve wording");
    expect(compactLogicTest).toContain("deterministic extraction maps go-ahead language to approve");
    expect(compactLogicTest).toContain("deterministic extraction falls back to need_info for ambiguous memos");
    expect(compactLogicTest).toContain("candidate patch preserves existing packet and never resolves the decision");
  });

  it("pins function registration and live provider boundaries", () => {
    expect(compactConfig).toContain("[functions.decision-voice-memo-answer]");
    expect(compactConfig).toContain("verify_jwt = false");

    expect(compactCloseout).toContain("does not mark f2.2, f2.5, f3.1, f3.2, f4.3, or f5.2");
    expect(compactCloseout).toContain("never silently resolves qep_decisions");
    expect(compactCloseout).toContain("no live onedrive watched-folder subscription");
    expect(compactCloseout).toContain("openai_api_key or openai_key configuration");
    expect(compactCloseout).toContain("live sms delivery remains blocked by f2.2 / blk-7");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
