/**
 * Wave 7 Iron Companion v1.1 — minimal Whisper transcription proxy.
 *
 * Iron's voice input flow records audio in the browser, sends it here, gets
 * back raw transcribed text, then feeds that text into iron-orchestrator as
 * if the user had typed it.
 *
 * Deliberately does NOT do extraction, storage, or DB writes — that's the
 * domain of voice-to-qrm. Iron just needs words. Keeping this thin keeps
 * round-trip latency low (<2s for short utterances).
 *
 * Auth: shared requireServiceUser (rep / admin / manager / owner).
 * Rate limit: relies on the orchestrator's cost ladder downstream — there
 * is no explicit per-call rate limit here because the user has to be in a
 * conversation to reach this endpoint.
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_KEY") ?? "";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB hard ceiling — Iron utterances should be short
const WHISPER_TIMEOUT_MS = 25_000;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  if (!OPENAI_API_KEY) {
    return safeJsonError("OpenAI key not configured", 500, origin);
  }

  // Parse multipart form
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return safeJsonError("expected multipart/form-data with an 'audio' field", 400, origin);
  }

  const audioField = form.get("audio");
  if (!(audioField instanceof File)) {
    return safeJsonError("missing 'audio' file field", 400, origin);
  }

  if (audioField.size === 0) {
    return safeJsonError("audio file is empty", 400, origin);
  }
  if (audioField.size > MAX_AUDIO_BYTES) {
    return safeJsonError(`audio too large (max ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB)`, 413, origin);
  }

  // Forward to Whisper
  const start = Date.now();
  const whisperForm = new FormData();
  whisperForm.append("file", audioField, audioField.name || "iron-utterance.webm");
  whisperForm.append("model", "whisper-1");
  // Tell Whisper this is an English short utterance — improves accuracy on
  // domain terms (part numbers, customer names) without enforcing language.
  whisperForm.append("response_format", "verbose_json");
  whisperForm.append("language", "en");

  let whisperRes: Response;
  try {
    whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: whisperForm,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "whisper request failed";
    return safeJsonError(`transcription_failed: ${message}`, 502, origin);
  }

  if (!whisperRes.ok) {
    const text = await whisperRes.text().catch(() => "");
    return safeJsonError(`whisper ${whisperRes.status}: ${text.slice(0, 200)}`, 502, origin);
  }

  const data = await whisperRes.json().catch(() => null) as Record<string, unknown> | null;
  if (!data) {
    return safeJsonError("whisper returned non-json", 502, origin);
  }

  const transcript = String(data.text ?? "").trim();
  if (!transcript) {
    return safeJsonOk(
      {
        ok: false,
        transcript: "",
        confidence: 0,
        duration_ms: Date.now() - start,
        message: "no_speech_detected",
      },
      origin,
    );
  }

  // Whisper verbose_json includes per-segment avg_logprob; convert to a
  // 0..1 confidence score by averaging across segments. This gives Iron the
  // signal needed for the pre-failure Flare trip-wire (v3 §V3-10).
  let confidence = 0.85; // Whisper-1 default when verbose_json is unsupported
  const segments = data.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    let logprobSum = 0;
    let count = 0;
    for (const seg of segments) {
      if (seg && typeof seg === "object" && typeof (seg as Record<string, unknown>).avg_logprob === "number") {
        logprobSum += (seg as Record<string, number>).avg_logprob;
        count++;
      }
    }
    if (count > 0) {
      // avg_logprob is typically -0.5..0; map to 0..1
      const avg = logprobSum / count;
      confidence = Math.max(0, Math.min(1, 1 + avg / 0.5));
    }
  }

  return safeJsonOk(
    {
      ok: true,
      transcript,
      confidence,
      language: (data.language as string) ?? "en",
      duration_ms: Date.now() - start,
    },
    origin,
  );
});
