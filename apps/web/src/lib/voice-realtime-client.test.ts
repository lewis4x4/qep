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
      value: undefined,
      ephemeral_key: undefined,
      token: undefined,
    });
  });

  test("preserves current OpenAI client-secret value payload shape", () => {
    expect(
      normalizeRealtimeSessionPayload({
        provider: "openai",
        mode: "client_secret",
        model: "gpt-realtime-2",
        sdp_url: "https://api.openai.com/v1/realtime/calls",
        session: {
          value: "ek_current_openai_secret",
        },
      }),
    ).toEqual({
      value: "ek_current_openai_secret",
      model: "gpt-realtime-2",
      sdp_url: "https://api.openai.com/v1/realtime/calls",
      rtc_url: undefined,
      client_secret: undefined,
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
      value: undefined,
      client_secret: undefined,
      ephemeral_key: undefined,
    });
  });
});
