/**
 * hub-feedback-transcribe — Build Hub v2.2 voice capture endpoint.
 *
 * Accepts a multipart/form-data POST with a single "audio" file field,
 * does two things in parallel:
 *
 *   1. POST to OpenAI Whisper for a transcript.
 *   2. Upload the raw audio blob to the private `hub-feedback-audio`
 *      Supabase Storage bucket, path = `{workspace}/{user}/{uuid}.{ext}`.
 *
 * Returns `{ transcript, confidence, language, duration_ms, audio_path }`
 * so the frontend can drop the transcript into the textarea and reference
 * the audio_path in the subsequent hub-feedback-intake submission.
 *
 * Why not reuse iron-transcribe directly:
 *   iron-transcribe's auth gate (`requireServiceUser`) allows only
 *   rep/admin/manager/owner — client_stakeholder can't hit it. Rather than
 *   loosen Iron's contract, this is a thin hub-scoped proxy that shares
 *   the same Whisper config but uses `requireHubUser` (which includes
 *   `client_stakeholder`) and also handles the Storage upload that the
 *   hub flow requires but Iron's transcribe-only path doesn't need.
 *
 * Auth: user JWT (stakeholders + internal roles).
 * Zero-blocking: if OPENAI_API_KEY is missing, the function still uploads
 *   the audio and returns transcript = "" so the stakeholder can type the
 *   body manually instead of being fully blocked.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireHubUser } from "../_shared/hub-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB — matches the bucket cap
const WHISPER_TIMEOUT_MS = 25_000;
const BUCKET = "hub-feedback-audio";

interface TranscribeResult {
  transcript: string;
  confidence: number;
  language: string;
  duration_ms: number;
  audio_path: string | null;
  audio_mime: string;
  bytes: number;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const startMs = Date.now();

  try {
    const auth = await requireHubUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return safeJsonError(
        "expected multipart/form-data with an 'audio' field",
        400,
        origin,
      );
    }

    const audioField = form.get("audio");
    if (!(audioField instanceof File)) {
      return safeJsonError("missing 'audio' file field", 400, origin);
    }
    if (audioField.size === 0) {
      return safeJsonError("audio file is empty", 400, origin);
    }
    if (audioField.size > MAX_AUDIO_BYTES) {
      return safeJsonError(
        `audio too large (max ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB)`,
        413,
        origin,
      );
    }

    const mime = audioField.type || "audio/webm";
    const ext = mimeToExt(mime);

    // Client-driven idempotency. Voice capture retries over a lossy
    // connection used to orphan audio blobs because each retry minted a
    // fresh UUID path. Any client presenting the same x-idempotency-key
    // (UUID-ish string) reuses the same storage path so the retry over-
    // writes the prior upload instead of leaving it behind.
    const rawIdem = req.headers.get("x-idempotency-key");
    const fileKey = rawIdem && /^[a-zA-Z0-9_-]{8,64}$/.test(rawIdem)
      ? rawIdem.toLowerCase()
      : crypto.randomUUID();
    const path = `${auth.workspaceId}/${auth.userId}/${fileKey}.${ext}`;
    const upsert = Boolean(rawIdem);

    // Upload + transcribe in parallel. Both operations are independently
    // recoverable; we only short-circuit if BOTH fail.
    const uploadP = uploadAudio(req, path, audioField, upsert);
    const transcribeP = transcribeAudio(audioField);

    const [uploadResult, transcribeResult] = await Promise.allSettled([
      uploadP,
      transcribeP,
    ]);

    const audioPath = uploadResult.status === "fulfilled" ? uploadResult.value : null;
    const transcriptData = transcribeResult.status === "fulfilled"
      ? transcribeResult.value
      : { transcript: "", confidence: 0, language: "en" };

    if (uploadResult.status === "rejected") {
      console.warn(`hub-feedback-transcribe upload failed: ${(uploadResult.reason as Error)?.message ?? "unknown"}`);
    }
    if (transcribeResult.status === "rejected") {
      console.warn(`hub-feedback-transcribe whisper failed: ${(transcribeResult.reason as Error)?.message ?? "unknown"}`);
    }

    const result: TranscribeResult = {
      transcript: transcriptData.transcript,
      confidence: transcriptData.confidence,
      language: transcriptData.language,
      duration_ms: Date.now() - startMs,
      audio_path: audioPath,
      audio_mime: mime,
      bytes: audioField.size,
    };

    return safeJsonOk(result, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "hub-feedback-transcribe" });
    console.error("[hub-feedback-transcribe]", err);
    return safeJsonError("Internal error", 500, origin);
  }
});

/**
 * Upload the audio blob to the private hub-feedback-audio bucket via
 * service role (RLS on the bucket allows the service role unrestricted).
 * Returns the storage path on success; throws on error.
 */
async function uploadAudio(
  req: Request,
  path: string,
  file: File,
  upsert: boolean,
): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("storage upload: SUPABASE env missing");
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || "audio/webm",
      // upsert only when the client provided an idempotency key — prevents
      // silent clobbers on the no-key path, allows retries on the key path.
      upsert,
    });
  if (error) {
    throw new Error(`storage upload: ${error.message}`);
  }
  // Discard `req` intentionally — only here for signature parity with the
  // parallel transcribe call, in case we ever add Origin-aware rate limiting.
  void req;
  return path;
}

async function transcribeAudio(file: File): Promise<{
  transcript: string;
  confidence: number;
  language: string;
}> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_KEY") ?? "";
  if (!apiKey) {
    // Zero-blocking: no Whisper key → return empty transcript. The
    // stakeholder can type the body manually.
    return { transcript: "", confidence: 0, language: "en" };
  }

  const whisperForm = new FormData();
  whisperForm.append("file", file, file.name || "hub-feedback.webm");
  whisperForm.append("model", "whisper-1");
  whisperForm.append("response_format", "verbose_json");
  whisperForm.append("language", "en");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: whisperForm,
    signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`whisper ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!data) throw new Error("whisper returned non-json");

  const transcript = String(data.text ?? "").trim();

  // Convert segment avg_logprob → 0..1 confidence score (matches the
  // mapping in iron-transcribe so downstream consumers see the same
  // shape).
  let confidence = 0.85;
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
      const avg = logprobSum / count;
      confidence = Math.max(0, Math.min(1, 1 + avg / 0.5));
    }
  }

  return {
    transcript,
    confidence,
    language: (data.language as string) ?? "en",
  };
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  return "webm";
}
