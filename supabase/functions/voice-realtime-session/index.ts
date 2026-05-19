import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resolveVoiceRealtimeModelConfig } from "../_shared/voice-model-config.ts";
import {
  buildClientSecretPayload,
  buildLegacyRealtimeSessionPayload,
  isUnsupportedTurnDetectionError,
  type VoiceRealtimeSessionInput,
} from "./session-payload.ts";

type RealtimeSessionRequest = {
  language?: string | null;
};

const REALTIME_SESSION_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL")?.trim() ||
  "gpt-realtime-2";
const REALTIME_CLIENT_SECRET_ENDPOINT =
  "https://api.openai.com/v1/realtime/client_secrets";
const LEGACY_REALTIME_SESSION_ENDPOINT =
  "https://api.openai.com/v1/realtime/sessions";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const auth = await requireServiceUser(
      req.headers.get("Authorization"),
      origin,
    );
    if (!auth.ok) return auth.response;
    if (!["rep", "admin", "manager", "owner"].includes(auth.role)) {
      return safeJsonError(
        "Your role does not have access to realtime voice capture.",
        403,
        origin,
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const allowed = await checkRealtimeVoiceRateLimit(
      supabaseAdmin,
      auth.userId,
    );
    if (!allowed) {
      return safeJsonError(
        "Too many realtime voice session requests. Please wait a minute and try again.",
        429,
        origin,
      );
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
      sdp_url: session.mode === "client_secret"
        ? "https://api.openai.com/v1/realtime/calls"
        : `https://api.openai.com/v1/realtime?model=${
          encodeURIComponent(session.realtimeModel)
        }`,
      transcription_model: modelConfig.transcriptionModel,
      language,
      session: session.payload,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "voice-realtime-session", req });
    console.error("voice-realtime-session failed:", error);
    return safeJsonError(
      "Could not create a realtime voice session.",
      502,
      origin,
    );
  }
});

async function createRealtimeClientSecret(
  openAiKey: string,
  input: VoiceRealtimeSessionInput,
): Promise<
  {
    mode: "client_secret" | "legacy_session";
    realtimeModel: string;
    payload: unknown;
  }
> {
  const clientSecretPayload = buildClientSecretPayload(input);

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
  if (
    isUnsupportedTurnDetectionError(clientSecretRes.status, clientSecretError)
  ) {
    console.warn(
      `OpenAI realtime transcription model ${input.transcriptionModel} rejected turn_detection; retrying without server VAD.`,
    );
    const retryRes = await fetch(REALTIME_CLIENT_SECRET_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildClientSecretPayload(input, { includeTurnDetection: false }),
      ),
      signal: AbortSignal.timeout(15_000),
    });

    if (retryRes.ok) {
      return {
        mode: "client_secret",
        realtimeModel: input.realtimeModel,
        payload: await retryRes.json(),
      };
    }

    throw new Error(
      `OpenAI realtime client secret retry failed (${retryRes.status}): ${await retryRes
        .text()}`,
    );
  }

  if (clientSecretRes.status !== 404) {
    throw new Error(
      `OpenAI realtime client secret failed (${clientSecretRes.status}): ${clientSecretError}`,
    );
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
    body: JSON.stringify(buildLegacyRealtimeSessionPayload(input)),
    signal: AbortSignal.timeout(15_000),
  });

  if (!legacyRes.ok) {
    const legacyError = await legacyRes.text();
    if (isUnsupportedTurnDetectionError(legacyRes.status, legacyError)) {
      console.warn(
        `OpenAI legacy realtime model ${input.realtimeModel} rejected turn_detection; retrying without server VAD.`,
      );
      const retryLegacyRes = await fetch(LEGACY_REALTIME_SESSION_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildLegacyRealtimeSessionPayload(input, {
            includeTurnDetection: false,
          }),
        ),
        signal: AbortSignal.timeout(15_000),
      });

      if (retryLegacyRes.ok) {
        return {
          mode: "legacy_session",
          realtimeModel: input.realtimeModel,
          payload: await retryLegacyRes.json(),
        };
      }

      throw new Error(
        `OpenAI realtime session retry failed (${retryLegacyRes.status}): ${await retryLegacyRes
          .text()}`,
      );
    }

    throw new Error(
      `OpenAI realtime session failed (${legacyRes.status}): ${legacyError}`,
    );
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

async function checkRealtimeVoiceRateLimit(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const rpcResult = await supabaseAdmin.rpc("check_rate_limit", {
    p_user_id: userId,
    p_endpoint: "voice-realtime-session",
    p_max_requests: 10,
    p_window_seconds: 60,
  });

  if (!rpcResult.error) {
    return rpcResult.data !== false;
  }

  console.warn(
    "voice-realtime-session check_rate_limit RPC unavailable, using table fallback",
    rpcResult.error,
  );

  const windowStartIso = new Date(Date.now() - 60_000).toISOString();
  const countResult = await supabaseAdmin
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("endpoint", "voice-realtime-session")
    .gte("created_at", windowStartIso);

  if (countResult.error) {
    console.error(
      "voice-realtime-session rate limit fallback count failed:",
      countResult.error,
    );
    return true;
  }

  if ((countResult.count ?? 0) >= 10) {
    return false;
  }

  const insertResult = await supabaseAdmin
    .from("rate_limit_log")
    .insert({ user_id: userId, endpoint: "voice-realtime-session" });

  if (insertResult.error) {
    console.error(
      "voice-realtime-session rate limit fallback insert failed:",
      insertResult.error,
    );
  }

  return true;
}
