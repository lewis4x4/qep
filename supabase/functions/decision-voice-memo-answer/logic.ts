import type { DecisionMagicAction } from "../_shared/decision-magic-link.ts";

export type VoiceMemoExtractionMethod =
  | "deterministic"
  | "fallback_need_info"
  | "ai_json";

export interface VoiceMemoExtraction {
  action: DecisionMagicAction;
  rationale: string;
  confidence: number;
  method: VoiceMemoExtractionMethod;
  matched_phrase?: string;
}

export interface VoiceMemoCandidateInput {
  transcript: string;
  extraction: VoiceMemoExtraction;
  source: Record<string, unknown>;
  createdAt?: string;
}

export type VoiceMemoCandidatePatch = {
  ai_prep_packet: Record<string, unknown>;
};

const BLOCK_PATTERNS: Array<{ pattern: RegExp; phrase: string }> = [
  {
    pattern: /\b(do not|don't|dont)\s+(approve|proceed|move forward|ship)\b/i,
    phrase: "do not approve",
  },
  {
    pattern:
      /\b(not approved|not ok(?:ay)?|no go|reject(?:ed)?|decline(?:d)?|deny|blocked?|stop|hold off)\b/i,
    phrase: "block",
  },
  { pattern: /\bkill\s+(it|this|that|the plan)\b/i, phrase: "kill it" },
];

const NEED_INFO_PATTERNS: Array<{ pattern: RegExp; phrase: string }> = [
  {
    pattern:
      /\b(need|needs|needed)\s+(more\s+)?(info|information|detail|details|context|clarity)\b/i,
    phrase: "need more info",
  },
  {
    pattern:
      /\b(not enough|insufficient)\s+(info|information|detail|details|context)\b/i,
    phrase: "not enough information",
  },
  {
    pattern:
      /\b(send|show|get|gather|find out|confirm)\s+(me\s+)?(more\s+)?(info|information|detail|details|context|numbers|pricing|approval)\b/i,
    phrase: "gather more information",
  },
  {
    pattern: /\b(ask|check with|circle back)\b/i,
    phrase: "ask for more information",
  },
];

const APPROVE_PATTERNS: Array<{ pattern: RegExp; phrase: string }> = [
  {
    pattern: /\b(approved?|approve it|approve this|yes,? approve)\b/i,
    phrase: "approve",
  },
  {
    pattern:
      /\b(go ahead|green light|proceed|move forward|ship it|looks good|ok(?:ay)? to move forward|fine by me)\b/i,
    phrase: "go ahead",
  },
  { pattern: /\b(yes|sounds good|that works)\b/i, phrase: "yes" },
];

export function extractDecisionActionDeterministic(
  transcript: string,
): VoiceMemoExtraction {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) {
    return {
      action: "need_info",
      rationale:
        "No transcript text was available, so owner confirmation must request more information.",
      confidence: 0.2,
      method: "fallback_need_info",
    };
  }

  const blockMatch = firstMatch(normalized, BLOCK_PATTERNS);
  if (blockMatch) {
    return {
      action: "block",
      rationale: extractRationale(
        transcript,
        "Owner voice memo blocks the decision until the concern is resolved.",
      ),
      confidence: 0.86,
      method: "deterministic",
      matched_phrase: blockMatch,
    };
  }

  const needInfoMatch = firstMatch(normalized, NEED_INFO_PATTERNS);
  if (needInfoMatch) {
    return {
      action: "need_info",
      rationale: extractRationale(
        transcript,
        "Owner voice memo requests more information before deciding.",
      ),
      confidence: 0.82,
      method: "deterministic",
      matched_phrase: needInfoMatch,
    };
  }

  const approveMatch = firstMatch(normalized, APPROVE_PATTERNS);
  if (approveMatch) {
    return {
      action: "approve",
      rationale: extractRationale(
        transcript,
        "Owner voice memo approves moving forward.",
      ),
      confidence: 0.84,
      method: "deterministic",
      matched_phrase: approveMatch,
    };
  }

  return {
    action: "need_info",
    rationale: extractRationale(
      transcript,
      "No explicit approve/block instruction was found; confirmation should ask the owner for clarification.",
    ),
    confidence: 0.35,
    method: "fallback_need_info",
  };
}

export function coerceAiExtraction(
  value: unknown,
  fallback: VoiceMemoExtraction,
): VoiceMemoExtraction {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action.trim() : "";
  if (!isDecisionAction(action)) return fallback;

  const rationale =
    typeof record.rationale === "string" && record.rationale.trim()
      ? clip(record.rationale.trim(), 800)
      : fallback.rationale;
  const confidence =
    typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? Math.max(0, Math.min(1, record.confidence))
      : 0.7;

  return {
    action,
    rationale,
    confidence,
    method: "ai_json",
  };
}

export function buildVoiceMemoCandidatePatch(
  existingPacket: unknown,
  input: VoiceMemoCandidateInput,
): VoiceMemoCandidatePatch {
  const packet = existingPacket && typeof existingPacket === "object" &&
      !Array.isArray(existingPacket)
    ? { ...(existingPacket as Record<string, unknown>) }
    : {};

  packet.voice_memo_candidate = {
    transcript: clip(input.transcript.trim(), 12_000),
    action: input.extraction.action,
    rationale: input.extraction.rationale,
    confidence: input.extraction.confidence,
    extraction_method: input.extraction.method,
    matched_phrase: input.extraction.matched_phrase ?? null,
    source: input.source,
    created_at: input.createdAt ?? new Date().toISOString(),
    confirmation_required: true,
  };

  return { ai_prep_packet: packet };
}

function normalizeTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstMatch(
  text: string,
  patterns: Array<{ pattern: RegExp; phrase: string }>,
): string | null {
  for (const entry of patterns) {
    if (entry.pattern.test(text)) return entry.phrase;
  }
  return null;
}

function extractRationale(transcript: string, fallback: string): string {
  const text = normalizeTranscript(transcript);
  if (!text) return fallback;

  const rationaleMatch = text.match(
    /\b(?:because|since|rationale(?: is)?|reason(?: is)?)\b[:\s,-]*(.+)$/i,
  );
  if (rationaleMatch?.[1]?.trim()) return clip(rationaleMatch[1].trim(), 800);

  const firstSentence = text.split(/(?<=[.!?])\s+/)[0]?.trim();
  return firstSentence ? clip(firstSentence, 800) : fallback;
}

function isDecisionAction(value: string): value is DecisionMagicAction {
  return value === "approve" || value === "block" || value === "need_info";
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
