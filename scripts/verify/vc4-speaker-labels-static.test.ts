import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase/migrations/609_voice_capture_speaker_labels.sql"), "utf8");
const helper = readFileSync(join(root, "supabase/functions/_shared/voice-speaker-labels.ts"), "utf8");
const voiceCapture = readFileSync(join(root, "supabase/functions/voice-capture/index.ts"), "utf8");
const voiceCaptureSync = readFileSync(join(root, "supabase/functions/voice-capture-sync/index.ts"), "utf8");
const voiceCaptureStream = readFileSync(join(root, "supabase/functions/voice-capture-stream/index.ts"), "utf8");
const panel = readFileSync(join(root, "apps/web/src/components/voice/VoiceSpeakerLabelPanel.tsx"), "utf8");

describe("VC4 speaker label static contract", () => {
  test("uses the safe post-committed migration number and corrects the roadmap note", () => {
    expect(migration).toContain("Migration 609");
    expect(migration).toContain("where task_id = 'B2.4'");
    expect(migration).not.toContain("609. Privacy/audit fields. UI only suggests labels, no silent assignment.'\nwhere task_id = 'B2.4'\n  and description like 'Migration 609.%'");
  });

  test("migration defines workspace-scoped labels, audit, RLS, and explicit RPCs", () => {
    expect(migration).toContain("create table if not exists public.voice_capture_speaker_labels");
    expect(migration).toContain("create table if not exists public.voice_capture_speaker_label_audit");
    expect(migration).toContain("workspace_id text not null");
    expect(migration).toContain("voice_capture_speaker_labels_workspace_capture_key_unique");
    expect(migration).toContain("alter table public.voice_capture_speaker_labels enable row level security");
    expect(migration).toContain("confirm_voice_capture_speaker_label");
    expect(migration).toContain("reject_voice_capture_speaker_label");
    expect(migration).toContain("assignment_confirmed");
    expect(migration).toContain("assignment_rejected");
    expect(migration).toContain("ENTITY_WORKSPACE_MISMATCH");
    expect(migration).toContain("FREEFORM_ENTITY_ID_NOT_ALLOWED");
    expect(migration).toContain("LABEL_NOT_SUGGESTED");
    expect(migration).toContain("prevent_service_role_speaker_label_assignment");
    expect(migration).toContain("SERVICE_ROLE_SPEAKER_LABEL_ASSIGNMENT_FORBIDDEN");
  });

  test("authenticated users cannot directly write labels outside explicit RPCs", () => {
    expect(migration).toContain("revoke all on public.voice_capture_speaker_labels from anon, authenticated");
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|all)\s+on\s+public\.voice_capture_speaker_labels\s+to\s+authenticated/i);
    expect(migration).not.toMatch(/on public\.voice_capture_speaker_labels for (insert|update|delete)/i);
  });

  test("workspace scope is mandatory for reads and RPC decisions", () => {
    expect(migration).toContain("and voice_capture_speaker_labels.workspace_id = (select public.get_my_workspace())");
    expect(migration).toContain("and voice_capture_speaker_label_audit.workspace_id = (select public.get_my_workspace())");
    expect(migration).toContain("if v_workspace_id is null or v_label.workspace_id is distinct from v_workspace_id then");
    expect(migration).not.toContain("if v_label.workspace_id <> v_workspace_id then");
  });

  test("service-role automation cannot silently create confirmed or rejected labels", () => {
    expect(migration).toContain("if (select auth.role()) = 'service_role' and new.status <> 'suggested' then");
    expect(migration).toContain("SERVICE_ROLE_SPEAKER_LABEL_ASSIGNMENT_FORBIDDEN");
    expect(migration).toContain("SERVICE_ROLE_SPEAKER_LABEL_DECISION_REFRESH_FORBIDDEN");
  });

  test("edge helper creates only suggestions and conditionally refreshes suggested rows", () => {
    expect(helper).toContain('status: "suggested"');
    expect(helper).toContain('.eq("status", "suggested")');
    expect(helper).not.toContain('status: "confirmed"');
    expect(helper).not.toContain('status: "rejected"');
    expect(helper).not.toMatch(/assigned_(display_name|by|at|entity)/);
    expect(helper).not.toMatch(/voiceFingerprint|fingerprint_hash|embedding|waveform/i);
    expect(helper).toContain("label_only_no_voiceprint");
  });

  test("all relevant edge paths call the shared suggestion helper", () => {
    for (const source of [voiceCapture, voiceCaptureSync, voiceCaptureStream]) {
      expect(source).toContain("ensureVoiceCaptureSpeakerSuggestions");
    }
    expect(voiceCapture).toContain('captureMode: "field_note"');
    expect(voiceCaptureSync).toContain('captureMode: "field_note"');
    expect(voiceCaptureStream).toContain('captureMode: "live_call"');
  });

  test("UI copy requires explicit confirmation or rejection", () => {
    expect(panel).toContain("Suggested speaker label — not assigned yet. Confirm to apply this label.");
    expect(panel).toContain('rpc("confirm_voice_capture_speaker_label"');
    expect(panel).toContain('rpc("reject_voice_capture_speaker_label"');
    expect(panel).not.toMatch(/useEffect\([\s\S]{0,200}confirmVoiceCapture/i);
  });
});
