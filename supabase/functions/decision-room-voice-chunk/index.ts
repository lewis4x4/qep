/**
 * decision-room-voice-chunk
 *
 * Phase 6 — live mic coaching. The simulator streams audio in ~20s
 * chunks while the rep is on a real call; each chunk lands here,
 * Whisper transcribes it, and a structured extraction pass surfaces
 * stakeholder mentions + archetype hints so the canvas can materialize
 * "live ghost" seats for humans the rep is hearing about in real time.
 *
 * Request shape (POST, JSON):
 *   {
 *     dealId: uuid,
 *     audioBase64: string,  // webm/opus from MediaRecorder
 *     mimeType: string,     // "audio/webm" or similar
 *     chunkIndex: number,   // 0-based
 *     priorTranscript: string | null,  // context for this chunk
 *     companyName: string | null,
 *     dealName: string | null
 *   }
 *
 * Response:
 *   {
 *     transcript: string,
 *     detectedStakeholders: [{name, archetypeHint, confidence, snippet}]
 *   }
 *
 * Auth: resolveCallerContext + dealId access check + per-user rate
 * limit (30/min — chunks add up fast on a live call).
 */
import { createCallerClient, createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { enforceRateLimitWithFallback } from "../_shared/rate-limit-fallback.ts";

const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const EXTRACT_MODEL = "gpt-5.4-mini";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // ~4 MB per chunk ceiling
const MAX_PRIOR_TRANSCRIPT_LEN = 4_000;

type ArchetypeHint =
  | "champion"
  | "economic_buyer"
  | "operations"
  | "procurement"
  | "operator"
  | "maintenance"
  | "executive_sponsor";

const ARCHETYPE_HINTS: readonly ArchetypeHint[] = [
  "champion",
  "economic_buyer",
  "operations",
  "procurement",
  "operator",
  "maintenance",
  "executive_sponsor",
];

interface VoiceChunkRequest {
  dealId: string;
  audioBase64: string;
  mimeType: string;
  chunkIndex: number;
  priorTranscript: string | null;
  companyName: string | null;
  dealName: string | null;
}

interface DetectedStakeholder {
  name: string;
  archetypeHint: ArchetypeHint | null;
  confidence: "high" | "medium" | "low";
  snippet: string;
}

function normString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length === 0 ? null : t.slice(0, maxLen);
}

function decodeBase64(input: string): Uint8Array {
  try {
    const clean = input.replace(/^data:[^;]+;base64,/, "");
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

async function transcribeChunk(
  audio: Uint8Array,
  mimeType: string,
  openaiKey: string,
): Promise<string> {
  const form = new FormData();
  const filename = mimeType.includes("mp4") ? "chunk.mp4" : mimeType.includes("wav") ? "chunk.wav" : "chunk.webm";
  form.append("file", new Blob([audio], { type: mimeType || "audio/webm" }), filename);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`transcribe ${res.status}: ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  return text.trim();
}

function buildExtractPrompt(req: VoiceChunkRequest, chunkTranscript: string): string {
  const context = [
    `Deal: ${req.dealName ?? "untitled equipment deal"} at ${req.companyName ?? "the buyer's company"}.`,
    req.priorTranscript
      ? `PRIOR TRANSCRIPT (so far in this call):\n${req.priorTranscript}`
      : "PRIOR TRANSCRIPT: (call just started)",
    "",
    `THIS CHUNK'S TRANSCRIPT (chunk ${req.chunkIndex}):\n${chunkTranscript}`,
    "",
    "Extract every real human stakeholder named in THIS CHUNK who is part of the buyer's decision process.",
    "For each, infer the most likely archetype from the conversation:",
    "  champion — the person the rep is directly working with, advocating internally",
    "  economic_buyer — CFO, Owner, President, Controller, whoever signs the check",
    "  operations — Plant Manager, Operations Manager, COO, General Manager, Branch Manager",
    "  procurement — Procurement / Purchasing / Sourcing lead",
    "  operator — the actual equipment operator, foreman, superintendent, lead hand",
    "  maintenance — Maintenance, Mechanic, Shop Manager, Service Manager, Fleet Manager",
    "  executive_sponsor — CEO, President, Managing Director (only for enterprise-scale decisions)",
    "",
    "Return STRICT JSON:",
    '{"stakeholders":[{"name":"<full name>","archetypeHint":"<one of the archetypes or null>","confidence":"high|medium|low","snippet":"<≤20 words of the exact quote that introduced them>"}]}',
    "",
    "Hard rules (non-negotiable):",
    "- stakeholders is an empty array when no one new is named.",
    "- Only include REAL humans (not company names, not pronouns, not generic titles without a name).",
    "- confidence=high when the name and role are both clear in the transcript.",
    "- confidence=medium when the name is clear but the role is inferred from context.",
    "- confidence=low when you had to guess heavily.",
    "- Never invent a name that isn't in the transcript.",
    "- Return ONLY the JSON object. No prose outside. No markdown. No code fences.",
  ].join("\n");
  return context;
}

function parseExtract(raw: string): DetectedStakeholder[] {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const list = Array.isArray(parsed.stakeholders) ? parsed.stakeholders : [];
    const out: DetectedStakeholder[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!name || name.length < 2 || name.length > 80) continue;
      const archetypeRaw = typeof entry.archetypeHint === "string" ? entry.archetypeHint : null;
      const archetypeHint: ArchetypeHint | null =
        archetypeRaw && (ARCHETYPE_HINTS as readonly string[]).includes(archetypeRaw)
          ? (archetypeRaw as ArchetypeHint)
          : null;
      const confidence: DetectedStakeholder["confidence"] =
        entry.confidence === "high" || entry.confidence === "medium" ? entry.confidence : "low";
      const snippet = typeof entry.snippet === "string" ? entry.snippet.slice(0, 200) : "";
      out.push({ name, archetypeHint, confidence, snippet });
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("method_not_allowed", 405, origin);

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return safeJsonError("invalid_json", 400, origin);
  }

  const dealId = normString(raw.dealId, 40);
  const audioBase64 = typeof raw.audioBase64 === "string" ? raw.audioBase64 : null;
  const mimeType = normString(raw.mimeType, 80) ?? "audio/webm";
  const chunkIndex = typeof raw.chunkIndex === "number" && Number.isFinite(raw.chunkIndex)
    ? Math.max(0, Math.floor(raw.chunkIndex))
    : 0;

  if (!dealId || !UUID_PATTERN.test(dealId)) return safeJsonError("invalid dealId", 400, origin);
  if (!audioBase64 || audioBase64.length < 100) return safeJsonError("missing audio", 400, origin);

  // Decode + check size BEFORE expensive ops.
  const audio = decodeBase64(audioBase64);
  if (audio.length === 0) return safeJsonError("audio decode failed", 400, origin);
  if (audio.length > MAX_AUDIO_BYTES) return safeJsonError("audio chunk too large", 413, origin);

  const body: VoiceChunkRequest = {
    dealId,
    audioBase64,
    mimeType,
    chunkIndex,
    priorTranscript: normString(raw.priorTranscript, MAX_PRIOR_TRANSCRIPT_LEN),
    companyName: normString(raw.companyName, 200),
    dealName: normString(raw.dealName, 200),
  };

  const admin = createAdminClient();
  const caller = await resolveCallerContext(req, admin);
  if (!caller.userId || !caller.role || !caller.authHeader) {
    return safeJsonError("Unauthorized", 401, origin);
  }

  const rateOk = await enforceRateLimitWithFallback(admin, {
    userId: caller.userId,
    endpoint: "decision-room-voice-chunk",
    maxRequests: 30,
    windowSeconds: 60,
  });
  if (!rateOk) {
    return safeJsonError("Rate limit exceeded — slow down.", 429, origin);
  }

  const callerClient = createCallerClient(caller.authHeader);
  const { data: dealRow, error: dealErr } = await callerClient
    .from("crm_deals")
    .select("id")
    .eq("id", body.dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (dealErr) return safeJsonError("deal_lookup_failed", 500, origin);
  if (!dealRow) return safeJsonError("deal not found or access denied", 404, origin);

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return safeJsonError("OPENAI_API_KEY not configured", 500, origin);

  try {
    const transcript = await transcribeChunk(audio, body.mimeType, openaiKey);
    if (!transcript) {
      return safeJsonOk(
        { transcript: "", detectedStakeholders: [], chunkIndex: body.chunkIndex },
        origin,
      );
    }

    // Second model pass: structured stakeholder extraction.
    const extractRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You extract stakeholder mentions from live equipment-sales call transcripts. Return strict JSON only.",
          },
          { role: "user", content: buildExtractPrompt(body, transcript) },
        ],
        max_completion_tokens: 500,
      }),
    });

    let detectedStakeholders: DetectedStakeholder[] = [];
    if (extractRes.ok) {
      const extractPayload = await extractRes.json();
      const content = extractPayload.choices?.[0]?.message?.content ?? "";
      detectedStakeholders = parseExtract(content);
    } else {
      const text = await extractRes.text().catch(() => "");
      console.warn("[decision-room-voice-chunk] extract model error", extractRes.status, text.slice(0, 200));
    }

    return safeJsonOk(
      {
        transcript,
        detectedStakeholders,
        chunkIndex: body.chunkIndex,
        generatedAt: new Date().toISOString(),
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "decision-room-voice-chunk", req });
    console.error("[decision-room-voice-chunk] unexpected error", err);
    return safeJsonError(err instanceof Error ? err.message : "chunk_failed", 500, origin);
  }
});
