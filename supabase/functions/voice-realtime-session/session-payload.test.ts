import {
  buildClientSecretPayload,
  buildLegacyRealtimeSessionPayload,
  isUnsupportedTurnDetectionError,
} from "./session-payload.ts";
import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const input = {
  language: "en",
  realtimeModel: "gpt-realtime-2",
  transcriptionModel: "gpt-4o-transcribe",
};

Deno.test("buildClientSecretPayload includes server VAD by default", () => {
  const payload = buildClientSecretPayload(input);

  assertObjectMatch(payload, {
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-transcribe",
            language: "en",
          },
          turn_detection: {
            type: "server_vad",
          },
        },
      },
    },
  });
});

Deno.test("buildClientSecretPayload can omit turn_detection for unsupported transcription models", () => {
  const payload = buildClientSecretPayload(input, {
    includeTurnDetection: false,
  });

  assertEquals("turn_detection" in payload.session.audio.input, false);
  assertEquals(
    payload.session.audio.input.transcription.model,
    "gpt-4o-transcribe",
  );
});

Deno.test("buildLegacyRealtimeSessionPayload can omit turn_detection for compatibility retry", () => {
  const payload = buildLegacyRealtimeSessionPayload(input, {
    includeTurnDetection: false,
  });

  assertEquals("turn_detection" in payload, false);
  assertEquals(payload.input_audio_transcription.model, "gpt-4o-transcribe");
});

Deno.test("isUnsupportedTurnDetectionError recognizes OpenAI invalid_value response", () => {
  const body = JSON.stringify({
    error: {
      message: "Turn detection is not supported for this transcription model.",
      type: "invalid_request_error",
      param: "session.audio.input.turn_detection",
      code: "invalid_value",
    },
  });

  assertEquals(isUnsupportedTurnDetectionError(400, body), true);
  assertEquals(isUnsupportedTurnDetectionError(401, body), false);
});

Deno.test("isUnsupportedTurnDetectionError ignores unrelated 400 responses", () => {
  const body = JSON.stringify({
    error: {
      message: "Unknown model",
      param: "session.audio.input.transcription.model",
      code: "invalid_value",
    },
  });

  assertEquals(isUnsupportedTurnDetectionError(400, body), false);
});
