/**
 * Wave 7 Iron Companion v1.2 — text-to-speech proxy.
 *
 * Thin proxy around OpenAI's `tts-1` endpoint. Auth-gated, length-capped,
 * and returns raw audio/mpeg so the browser can stream-play it via
 * HTMLAudioElement (no special decoding needed).
 *
 * Provider choice: OpenAI was already configured for the existing
 * voice-to-qrm Whisper pipeline, so v1.2 ships TTS with zero new credentials
 * and zero new providers. ElevenLabs / streaming TTS upgrades are v2.0.
 *
 * Cost: ~$15 per 1M characters at v1.2 release. A typical Iron response is
 * ~150 chars, so $0.00225 per call. The MAX_CHARS cap below + the
 * orchestrator's per-user token cost ladder are the cost defenses.
 *
 * Auth: shared requireServiceUser (rep / admin / manager / owner).
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeCorsHeaders } from "../_shared/safe-cors.ts";
import { redactString } from "../_shared/redact-pii.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_KEY") ?? "";
const TTS_TIMEOUT_MS = 20_000;
const MAX_CHARS = 1200; // ~10 sentences — Iron responses should be tight
const VALID_VOICES: ReadonlySet<string> = new Set([
  "alloy", "echo", "fable", "onyx", "nova", "shimmer",
]);
const DEFAULT_VOICE = "nova";  // Warm, neutral, fast

interface RequestBody {
  text: string;
  voice?: string;
  speed?: number; // 0.25..4.0 per OpenAI spec
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  if (!OPENAI_API_KEY) {
    return safeJsonError("OpenAI key not configured", 500, origin);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }

  // Redact PII before sending text to OpenAI — same regex set as
  // iron_messages.content. If a redaction landed in Iron's response, it
  // would say "[REDACTED]" out loud, which is the correct behavior.
  const text = redactString(typeof body.text === "string" ? body.text : "").trim();
  if (!text) {
    return safeJsonError("text is required", 400, origin);
  }
  if (text.length > MAX_CHARS) {
    return safeJsonError(`text too long (max ${MAX_CHARS} chars)`, 413, origin);
  }

  const voice = typeof body.voice === "string" && VALID_VOICES.has(body.voice)
    ? body.voice
    : DEFAULT_VOICE;
  const speed = typeof body.speed === "number" && body.speed >= 0.25 && body.speed <= 4.0
    ? body.speed
    : 1.0;

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice,
        speed,
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "tts request failed";
    return safeJsonError(`tts_failed: ${message}`, 502, origin);
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return safeJsonError(`openai_tts ${upstream.status}: ${errText.slice(0, 200)}`, 502, origin);
  }

  // Stream the audio bytes straight back to the browser. The orchestrator
  // wrapper on the client side wraps this in an HTMLAudioElement.
  const audioBuffer = await upstream.arrayBuffer();
  const corsHeaders = safeCorsHeaders(origin);
  return new Response(audioBuffer, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "X-Iron-TTS-Voice": voice,
      "X-Iron-TTS-Chars": String(text.length),
    },
  });
});
