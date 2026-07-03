import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "722_b24_speaker_labeling_closeout.sql");
const speakerSchema = readText("supabase", "migrations", "609_voice_capture_speaker_labels.sql");
const speakerHelper = readText("supabase", "functions", "_shared", "voice-speaker-labels.ts");
const speakerHelperTest = readText("supabase", "functions", "_shared", "voice-speaker-labels.test.ts");
const voiceCapture = readText("supabase", "functions", "voice-capture", "index.ts");
const liveCallStream = readText("supabase", "functions", "voice-capture-stream", "index.ts");
const panel = readText("apps", "web", "src", "components", "voice", "VoiceSpeakerLabelPanel.tsx");
const panelTest = readText("apps", "web", "src", "components", "voice", "VoiceSpeakerLabelPanel.test.tsx");
const voiceCapturePage = readText("apps", "web", "src", "components", "VoiceCapturePage.tsx");

const compactCloseout = compact(closeoutSql);
const compactSpeakerSchema = compact(speakerSchema);
const compactSpeakerHelper = compact(speakerHelper);
const compactSpeakerHelperTest = compact(speakerHelperTest);
const compactVoiceCapture = compact(voiceCapture);
const compactLiveCallStream = compact(liveCallStream);
const compactPanel = compact(panel);
const compactPanelTest = compact(panelTest);
const compactVoiceCapturePage = compact(voiceCapturePage);

describe("722_b24_speaker_labeling_closeout.sql contract", () => {
  it("marks only B2.4 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b2.4'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("human-confirmed, workspace-scoped, and auditable");
    expect(compactCloseout).not.toContain("where task_id = 'b2.3'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.5'");
  });

  it("states manual and biometric boundaries honestly", () => {
    expect(compactCloseout).toContain("no live customer call recording was performed");
    expect(compactCloseout).toContain("no biometric identity verification");
    expect(compactCloseout).toContain("no manual user acceptance of a real speaker suggestion");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("stores speaker labels as workspace-scoped suggestions with audit fields", () => {
    expect(compactSpeakerSchema).toContain("create table if not exists public.voice_capture_speaker_labels");
    expect(compactSpeakerSchema).toContain("status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected'))");
    expect(compactSpeakerSchema).toContain("unique (workspace_id, voice_capture_id, speaker_key)");
    expect(compactSpeakerSchema).toContain("does not store voiceprints, fingerprints, embeddings, or waveform features");
    expect(compactSpeakerSchema).toContain("rows remain suggestions until a user explicitly confirms or rejects them through rpcs");
    expect(compactSpeakerSchema).toContain("create table if not exists public.voice_capture_speaker_label_audit");
    expect(compactSpeakerSchema).toContain("event_type text not null check (event_type in ('suggestion_created', 'suggestion_updated', 'assignment_confirmed', 'assignment_rejected'))");
  });

  it("enforces workspace scope, RLS, and service-role no-assignment policy", () => {
    expect(compactSpeakerSchema).toContain("public.enforce_voice_capture_speaker_label_workspace()");
    expect(compactSpeakerSchema).toContain("speaker label workspace must match parent voice capture workspace");
    expect(compactSpeakerSchema).toContain("public.prevent_service_role_speaker_label_assignment()");
    expect(compactSpeakerSchema).toContain("(select auth.role()) = 'service_role' and new.status <> 'suggested'");
    expect(compactSpeakerSchema).toContain("service_role_speaker_label_assignment_forbidden");
    expect(compactSpeakerSchema).toContain("old.status <> 'suggested'");
    expect(compactSpeakerSchema).toContain("alter table public.voice_capture_speaker_labels enable row level security");
    expect(compactSpeakerSchema).toContain("alter table public.voice_capture_speaker_label_audit enable row level security");
    expect(compactSpeakerSchema).toContain("voice_capture_speaker_labels.workspace_id = (select public.get_my_workspace())");
    expect(compactSpeakerSchema).toContain("vc.user_id = (select auth.uid())");
    expect(compactSpeakerSchema).toContain("(select public.get_my_role()) in ('admin', 'manager', 'owner')");
  });

  it("requires explicit authenticated RPC decisions for confirm and reject", () => {
    expect(compactSpeakerSchema).toContain("create or replace function public.confirm_voice_capture_speaker_label");
    expect(compactSpeakerSchema).toContain("create or replace function public.reject_voice_capture_speaker_label");
    expect(compactSpeakerSchema).toContain("if v_actor is null then raise exception 'auth_required'");
    expect(compactSpeakerSchema).toContain("if v_workspace_id is null or v_label.workspace_id is distinct from v_workspace_id");
    expect(compactSpeakerSchema).toContain("if not (v_capture.user_id = v_actor or v_role in ('admin', 'manager', 'owner'))");
    expect(compactSpeakerSchema).toContain("if v_label.status <> 'suggested'");
    expect(compactSpeakerSchema).toContain("display_name_required");
    expect(compactSpeakerSchema).toContain("entity_workspace_mismatch");
    expect(compactSpeakerSchema).toContain("status = 'confirmed'");
    expect(compactSpeakerSchema).toContain("status = 'rejected'");
    expect(compactSpeakerSchema).toContain("grant execute on function public.confirm_voice_capture_speaker_label");
    expect(compactSpeakerSchema).toContain("grant execute on function public.reject_voice_capture_speaker_label");
  });

  it("creates or refreshes suggestions only and preserves confirmed rows", () => {
    expect(compactSpeakerHelper).toContain("status: \"suggested\"");
    expect(compactSpeakerHelper).toContain("privacy: \"label_only_no_voiceprint\"");
    expect(compactSpeakerHelper).toContain(".eq(\"status\", \"suggested\")");
    expect(compactSpeakerHelper).toContain("best-effort suggestion creation failed");
    expect(compactSpeakerHelperTest).toContain("creates suggestions only, never assignments");
    expect(compactSpeakerHelperTest).toContain("ignores foreign-workspace linked entity names");
    expect(compactSpeakerHelperTest).toContain("is idempotent and does not overwrite confirmed rows");
    expect(compactSpeakerHelperTest).toContain("assertequals(client.rows.voice_capture_speaker_labels[0]?.status, \"confirmed\")");
  });

  it("runs suggestions from both voice capture modes", () => {
    expect(compactVoiceCapture).toContain("ensurevoicecapturespeakersuggestions(supabaseadmin");
    expect(compactVoiceCapture).toContain("capturemode: \"field_note\"");
    expect(compactLiveCallStream).toContain("ensurevoicecapturespeakersuggestions(admin");
    expect(compactLiveCallStream).toContain("capturemode: \"live_call\"");
  });

  it("renders suggestions in the capture UI without auto-assigning", () => {
    expect(compactPanel).toContain(".from(\"voice_capture_speaker_labels\")");
    expect(compactPanel).toContain("suggested speaker label");
    expect(compactPanel).toContain("not assigned yet");
    expect(compactPanel).toContain("supabase.rpc(\"confirm_voice_capture_speaker_label\"");
    expect(compactPanel).toContain("supabase.rpc(\"reject_voice_capture_speaker_label\"");
    expect(compactPanel).toContain("edit name");
    expect(compactVoiceCapturePage).toContain("<voicespeakerlabelpanel captureid={result.id} compact />");
    expect(compactVoiceCapturePage).toContain("<voicespeakerlabelpanel captureid={selectedrecentcapture.id} compact />");
    expect(compactPanelTest).toContain("loads suggestions without auto-assigning and confirms only on user click");
    expect(compactPanelTest).toContain("expect(rpcmock).not.tohavebeencalled()");
    expect(compactPanelTest).toContain("lets the user edit the confirmation name or reject the suggestion explicitly");
  });
});
