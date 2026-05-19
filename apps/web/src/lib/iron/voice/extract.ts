/**
 * Frontend wrapper around the voice-extract-entities edge function.
 *
 * Mirrors ironTranscribe's invoke pattern — we never destructure `invoke`
 * off `supabase.functions` because Safari's FunctionsClient touches
 * `this.region` and bound-method destructure throws there.
 *
 * Returns a fully-shaped result on every code path. The edge function
 * itself is fail-open (returns the empty shape with 200 when OpenAI is
 * unreachable), and this wrapper degrades the same way on network errors.
 */
import { supabase } from "@/lib/supabase";

export interface VoiceExtractionResult {
  next_step: string | null;
  next_step_due: string | null;
  amount_cents: number | null;
  equipment_mentioned: string[];
  competitor: string | null;
  sentiment: "warming" | "cooling" | "neutral" | null;
  topic:
    | "visit"
    | "call"
    | "quote_followup"
    | "parts"
    | "service"
    | "competitor"
    | "trade_in"
    | "other";
  summary: string;
  confidence: number;
}

export const EMPTY_VOICE_EXTRACTION: VoiceExtractionResult = {
  next_step: null,
  next_step_due: null,
  amount_cents: null,
  equipment_mentioned: [],
  competitor: null,
  sentiment: null,
  topic: "other",
  summary: "",
  confidence: 0,
};

export async function extractVoiceEntities(
  transcript: string,
  customerName?: string,
  signal?: AbortSignal,
): Promise<VoiceExtractionResult> {
  if (!transcript.trim()) return { ...EMPTY_VOICE_EXTRACTION };
  if (signal?.aborted) return { ...EMPTY_VOICE_EXTRACTION };

  const fns = (supabase as unknown as {
    functions: {
      invoke: (
        name: string,
        opts: { body: Record<string, unknown>; signal?: AbortSignal },
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
  }).functions;

  try {
    const { data, error } = await fns.invoke("voice-extract-entities", {
      body: {
        transcript,
        customer_name: customerName?.trim() || undefined,
      },
      signal,
    });
    if (signal?.aborted) return { ...EMPTY_VOICE_EXTRACTION };
    if (error || !data || typeof data !== "object") {
      return { ...EMPTY_VOICE_EXTRACTION };
    }
    return sanitize(data as Record<string, unknown>);
  } catch {
    return { ...EMPTY_VOICE_EXTRACTION };
  }
}

function sanitize(raw: Record<string, unknown>): VoiceExtractionResult {
  const equipment = Array.isArray(raw.equipment_mentioned)
    ? raw.equipment_mentioned
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim())
    : [];

  const sentiment = raw.sentiment === "warming" || raw.sentiment === "cooling" || raw.sentiment === "neutral"
    ? raw.sentiment
    : null;

  const topicCandidate = raw.topic;
  const topic: VoiceExtractionResult["topic"] = typeof topicCandidate === "string"
    && ["visit", "call", "quote_followup", "parts", "service", "competitor", "trade_in", "other"].includes(topicCandidate)
    ? (topicCandidate as VoiceExtractionResult["topic"])
    : "other";

  const dueRaw = typeof raw.next_step_due === "string" ? raw.next_step_due.trim() : null;
  const next_step_due = dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;

  return {
    next_step: typeof raw.next_step === "string" && raw.next_step.trim() ? raw.next_step.trim() : null,
    next_step_due,
    amount_cents: typeof raw.amount_cents === "number" && Number.isFinite(raw.amount_cents)
      ? Math.round(raw.amount_cents)
      : null,
    equipment_mentioned: equipment,
    competitor: typeof raw.competitor === "string" && raw.competitor.trim() ? raw.competitor.trim() : null,
    sentiment,
    topic,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    confidence: typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0,
  };
}
