import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  resolveVoiceRealtimeModelConfig,
  VOICE_TRANSCRIPTION_DOMAIN_PROMPT,
} from "../_shared/voice-model-config.ts";

type RealtimeSessionRequest = {
  language?: string | null;
};

const REALTIME_SESSION_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL")?.trim() || "gpt-realtime-2";
const REALTIME_CLIENT_SECRET_ENDPOINT = "https://api.openai.com/v1/realtime/client_secrets";
const LEGACY_REALTIME_SESSION_ENDPOINT = "https://api.openai.com/v1/realtime/sessions";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!["rep", "admin", "manager", "owner"].includes(auth.role)) {
      return safeJsonError("Your role does not have access to realtime voice capture.", 403, origin);
    }

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) {
      return safeJsonError(
        "Realtime voice capture is not configured. Missing OPENAI_API_KEY in Supabase edge function secrets.",
        503,
        origin,
      );
    }

    const body = await req.json().catch(() => ({})) as RealtimeSessionRequest;
    const language = normalizeLanguage(body.language);
    const modelConfig = resolveVoiceRealtimeModelConfig();

    const session = await createRealtimeClientSecret(openAiKey, {
      language,
      realtimeModel: REALTIME_SESSION_MODEL,
      transcriptionModel: modelConfig.transcriptionModel,
    });

    return safeJsonOk({
      provider: "openai",
      mode: session.mode,
      model: session.realtimeModel,
      transcription_model: modelConfig.transcriptionModel,
      language,
      session: session.payload,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "voice-realtime-session", req });
    console.error("voice-realtime-session failed:", error);
    return safeJsonError("Could not create a realtime voice session.", 502, origin);
  }
});

async function createRealtimeClientSecret(
  openAiKey: string,
  input: {
    language: string;
    realtimeModel: string;
    transcriptionModel: string;
  },
): Promise<{ mode: "client_secret" | "legacy_session"; realtimeModel: string; payload: unknown }> {
  const clientSecretPayload = {
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: input.transcriptionModel,
            language: input.language,
            prompt: VOICE_TRANSCRIPTION_DOMAIN_PROMPT,
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      },
    },
  };

  const clientSecretRes = await fetch(REALTIME_CLIENT_SECRET_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(clientSecretPayload),
    signal: AbortSignal.timeout(15_000),
  });

  if (clientSecretRes.ok) {
    return {
      mode: "client_secret",
      realtimeModel: input.realtimeModel,
      payload: await clientSecretRes.json(),
    };
  }

  const clientSecretError = await clientSecretRes.text().catch(() => "");
  if (clientSecretRes.status !== 404) {
    throw new Error(`OpenAI realtime client secret failed (${clientSecretRes.status}): ${clientSecretError}`);
  }

  // Backward-compatible fallback for OpenAI projects still using the older
  // ephemeral session surface. The browser still receives only the ephemeral
  // session payload; OPENAI_API_KEY never leaves this edge function.
  const legacyRes = await fetch(LEGACY_REALTIME_SESSION_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.realtimeModel,
      modalities: ["audio", "text"],
      instructions: VOICE_TRANSCRIPTION_DOMAIN_PROMPT,
      input_audio_transcription: {
        model: input.transcriptionModel,
        language: input.language,
        prompt: VOICE_TRANSCRIPTION_DOMAIN_PROMPT,
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!legacyRes.ok) {
    throw new Error(`OpenAI realtime session failed (${legacyRes.status}): ${await legacyRes.text()}`);
  }

  return {
    mode: "legacy_session",
    realtimeModel: input.realtimeModel,
    payload: await legacyRes.json(),
  };
}

function normalizeLanguage(value: string | null | undefined): string {
  if (typeof value !== "string") return "en";
  const trimmed = value.trim();
  return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(trimmed) ? trimmed : "en";
}
