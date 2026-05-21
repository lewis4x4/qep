export type VoiceComplianceStatus =
  | "not_required"
  | "requires_human_edit"
  | "human_edited"
  | "email_voice_passed";

export interface VoiceComplianceGate {
  policy: "E2.2/QEP-125";
  required: boolean;
  status: VoiceComplianceStatus;
  pass_type: "human_edit" | "email_voice" | null;
  reason: "llm_generated_user_facing" | "not_llm_generated";
  generated_by: string;
  created_at: string;
  passed_at: string | null;
  passed_by: string | null;
}

export const VOICE_GATE_BLOCK_MESSAGE =
  "E2.2 voice gate requires a human edit or email-voice pass before sending.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isoNow(now: Date): string {
  return now.toISOString();
}

function normalizeStatus(value: unknown): VoiceComplianceStatus {
  switch (value) {
    case "not_required":
    case "requires_human_edit":
    case "human_edited":
    case "email_voice_passed":
      return value;
    default:
      return "requires_human_edit";
  }
}

export function buildRequiredVoiceGate(generatedBy: string, now: Date = new Date()): VoiceComplianceGate {
  return {
    policy: "E2.2/QEP-125",
    required: true,
    status: "requires_human_edit",
    pass_type: null,
    reason: "llm_generated_user_facing",
    generated_by: generatedBy,
    created_at: isoNow(now),
    passed_at: null,
    passed_by: null,
  };
}

export function buildNotRequiredVoiceGate(generatedBy: string, now: Date = new Date()): VoiceComplianceGate {
  return {
    policy: "E2.2/QEP-125",
    required: false,
    status: "not_required",
    pass_type: null,
    reason: "not_llm_generated",
    generated_by: generatedBy,
    created_at: isoNow(now),
    passed_at: null,
    passed_by: null,
  };
}

export function mergeVoiceGate(
  context: unknown,
  gate: VoiceComplianceGate,
): Record<string, unknown> {
  return {
    ...(isRecord(context) ? context : {}),
    voice_gate: gate,
  };
}

export function readVoiceGate(context: unknown): VoiceComplianceGate | null {
  if (!isRecord(context) || !isRecord(context.voice_gate)) return null;
  const gate = context.voice_gate;
  const required = gate.required === true;
  const status = normalizeStatus(gate.status);
  return {
    policy: "E2.2/QEP-125",
    required,
    status: required ? status : "not_required",
    pass_type: gate.pass_type === "human_edit" || gate.pass_type === "email_voice"
      ? gate.pass_type
      : null,
    reason: gate.reason === "not_llm_generated" ? "not_llm_generated" : "llm_generated_user_facing",
    generated_by: typeof gate.generated_by === "string" && gate.generated_by.trim()
      ? gate.generated_by
      : "unknown",
    created_at: typeof gate.created_at === "string" && gate.created_at.trim()
      ? gate.created_at
      : new Date(0).toISOString(),
    passed_at: typeof gate.passed_at === "string" && gate.passed_at.trim() ? gate.passed_at : null,
    passed_by: typeof gate.passed_by === "string" && gate.passed_by.trim() ? gate.passed_by : null,
  };
}

export function isVoiceGateSatisfied(context: unknown, draftStatus: string | null | undefined): boolean {
  const gate = readVoiceGate(context);
  if (!gate || gate.required !== true) return true;
  if (gate.status === "human_edited" || gate.status === "email_voice_passed") return true;
  return draftStatus === "edited" || draftStatus === "sent";
}

export function markHumanEdited(
  context: unknown,
  userId: string | null,
  now: Date = new Date(),
): Record<string, unknown> {
  const gate = readVoiceGate(context);
  if (!gate || gate.required !== true) return isRecord(context) ? { ...context } : {};
  return mergeVoiceGate(context, {
    ...gate,
    status: "human_edited",
    pass_type: "human_edit",
    passed_at: isoNow(now),
    passed_by: userId,
  });
}
