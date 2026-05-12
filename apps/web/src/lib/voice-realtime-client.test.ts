import { describe, expect, test } from "bun:test";
import { normalizeRealtimeSessionPayload } from "./voice-realtime-client";

describe("voice-realtime-client", () => {
  test("unwraps the edge function session payload and preserves top-level model fallback", () => {
    expect(
      normalizeRealtimeSessionPayload({
        provider: "openai",
        mode: "webrtc",
        model: "gpt-realtime",
        transcription_model: "gpt-4o-mini-transcribe",
        language: "en",
        session: {
          client_secret: { value: "ephemeral-token" },
        },
      }),
    ).toEqual({
      client_secret: { value: "ephemeral-token" },
      model: "gpt-realtime",
      rtc_url: undefined,
      sdp_url: undefined,
      ephemeral_key: undefined,
      token: undefined,
    });
  });

  test("lets nested session URLs and model override top-level fallbacks", () => {
    expect(
      normalizeRealtimeSessionPayload({
        model: "top-level-model",
        rtc_url: "https://top-level.example/realtime",
        session: {
          token: "nested-token",
          model: "nested-model",
          sdp_url: "https://nested.example/sdp",
        },
      }),
    ).toEqual({
      token: "nested-token",
      model: "nested-model",
      sdp_url: "https://nested.example/sdp",
      rtc_url: "https://top-level.example/realtime",
      client_secret: undefined,
      ephemeral_key: undefined,
    });
  });
});
