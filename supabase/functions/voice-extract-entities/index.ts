/**
 * voice-extract-entities — IRON field-note extractor for the rep voice
 * capture review screen.
 *
 * This is intentionally a separate function from voice-to-qrm. That one is
 * the heavy, full-pipeline path that creates contacts/deals/cadences inside
 * the QRM. This one is a thin, fast, read-only extractor: given a
 * transcript string, return a structured shape we can render on the review
 * card and use to build the smart-actions list. No DB writes happen here.
 *
 * Fail-open is mandatory. If OpenAI is unavailable or returns junk JSON,
 * we still return a 200 with all-null fields and confidence=0 so the rep
 * never sees an extraction error block their save.
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_KEY") ?? "";
const EXTRACTION_TIMEOUT_MS = 20_000;
const EXTRACTION_MODEL = "gpt-4o-mini";

// System prompt is stable across calls so it caches at the provider edge.
const EXTRACTION_SYSTEM_PROMPT = `You are a QRM (Quality Relationship Manager) extractor for QEP, a heavy equipment dealership.
A field rep just dictated a short voice note. Extract structured fields a sales operator would want at-a-glance.

Return ONLY a JSON object matching this exact schema. Use null when a field is not clearly stated. Do not fabricate.

{
  "next_step": "string or null — concise imperative phrase, e.g. 'Send revised quote', 'Call Frank back', 'Schedule demo'",
  "next_step_due": "string or null — ISO date YYYY-MM-DD if a date is stated or strongly implied (e.g. 'by Friday', 'next week', 'end of month')",
  "amount_cents": "integer or null — dollar amount expressed in cents. '$186K' → 18600000. '$2.5 million' → 250000000",
  "equipment_mentioned": ["string array — short canonical phrases of equipment mentioned, e.g. '5T forklift', 'boom lift', 'Yanmar ViO 55'. Empty array if none."],
  "competitor": "string or null — single primary competitor brand named (e.g. 'Komatsu', 'Cat')",
  "sentiment": "warming | cooling | neutral | null — directional read of customer interest",
  "topic": "visit | call | quote_followup | parts | service | competitor | trade_in | other",
  "summary": "string — ~2 short sentences capturing the gist in first person, e.g. 'Met with Frank at Acme. He wants a revised quote on the 5T forklift by Friday.'",
  "confidence": "number 0..1 — your overall confidence that the extraction is faithful to the transcript"
}

Rules:
- Resolve relative dates against the rep's perspective today. Pick a concrete YYYY-MM-DD when possible.
- amount_cents must be an integer or null. No strings, no decimals.
- equipment_mentioned must always be an array (empty if nothing).
- topic must be one of the listed values; pick the dominant frame of the conversation.
- summary should never be longer than 240 characters.
- Return JSON only. No prose before or after.`;

interface VoiceExtractionResult {
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

const EMPTY_RESULT: VoiceExtractionResult = {
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

const VALID_SENTIMENTS = new Set<VoiceExtractionResult["sentiment"]>([
  "warming",
  "cooling",
  "neutral",
]);

const VALID_TOPICS = new Set<VoiceExtractionResult["topic"]>([
  "visit",
  "call",
  "quote_followup",
  "parts",
  "service",
  "competitor",
  "trade_in",
  "other",
]);

function normalizeResult(raw: unknown): VoiceExtractionResult {
  if (!raw || typeof raw !== "object") return { ...EMPTY_RESULT };
  const r = raw as Record<string, unknown>;

  const equipment = Array.isArray(r.equipment_mentioned)
    ? r.equipment_mentioned
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim())
      .slice(0, 12)
    : [];

  const sentimentRaw = typeof r.sentiment === "string" ? r.sentiment : null;
  const sentiment = sentimentRaw && VALID_SENTIMENTS.has(sentimentRaw as never)
    ? (sentimentRaw as VoiceExtractionResult["sentiment"])
    : null;

  const topicRaw = typeof r.topic === "string" ? r.topic : null;
  const topic = topicRaw && VALID_TOPICS.has(topicRaw as never)
    ? (topicRaw as VoiceExtractionResult["topic"])
    : "other";

  const amount = typeof r.amount_cents === "number" && Number.isFinite(r.amount_cents)
    ? Math.round(r.amount_cents)
    : null;

  const dueRaw = typeof r.next_step_due === "string" ? r.next_step_due.trim() : null;
  const dueIso = dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;

  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
    ? Math.max(0, Math.min(1, r.confidence))
    : 0;

  const summaryRaw = typeof r.summary === "string" ? r.summary.trim() : "";
  const summary = summaryRaw.length > 280 ? summaryRaw.slice(0, 280) : summaryRaw;

  return {
    next_step: typeof r.next_step === "string" && r.next_step.trim() ? r.next_step.trim().slice(0, 160) : null,
    next_step_due: dueIso,
    amount_cents: amount,
    equipment_mentioned: equipment,
    competitor: typeof r.competitor === "string" && r.competitor.trim() ? r.competitor.trim().slice(0, 80) : null,
    sentiment,
    topic,
    summary,
    confidence,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;
  // Role gate: rep/admin/manager/owner/support. requireServiceUser already
  // bounds to ["rep","admin","manager","owner"]; allow "support" as well by
  // explicit re-check so this fn matches the spec.
  if (!["rep", "admin", "manager", "owner", "support"].includes(auth.role)) {
    return safeJsonError("Forbidden", 403, origin);
  }

  let body: { transcript?: unknown; customer_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return safeJsonError("Expected JSON body", 400, origin);
  }

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";

  if (!transcript) {
    return safeJsonOk({ ...EMPTY_RESULT }, origin);
  }

  // Fail-open if we can't reach OpenAI at all.
  if (!OPENAI_API_KEY) {
    return safeJsonOk({ ...EMPTY_RESULT, summary: transcript.slice(0, 240) }, origin);
  }

  const userMessage = customerName
    ? `Customer (already attached): ${customerName}\n\nTranscript:\n"""\n${transcript}\n"""`
    : `Transcript:\n"""\n${transcript}\n"""`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.1,
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
    });

    if (!res.ok) {
      return safeJsonOk({ ...EMPTY_RESULT }, origin);
    }

    const data = await res.json().catch(() => null) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return safeJsonOk({ ...EMPTY_RESULT }, origin);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return safeJsonOk({ ...EMPTY_RESULT }, origin);
    }

    return safeJsonOk(normalizeResult(parsed), origin);
  } catch {
    return safeJsonOk({ ...EMPTY_RESULT }, origin);
  }
});
