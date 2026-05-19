export type VoiceRealtimeSessionInput = {
  language: string;
  realtimeModel: string;
  transcriptionModel: string;
};

export const DEFAULT_SERVER_VAD = {
  type: "server_vad",
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 500,
} as const;

export function buildClientSecretPayload(
  input: VoiceRealtimeSessionInput,
  options: { includeTurnDetection?: boolean } = {},
) {
  const includeTurnDetection = options.includeTurnDetection !== false;
  return {
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: input.transcriptionModel,
            language: input.language,
          },
          ...(includeTurnDetection
            ? { turn_detection: DEFAULT_SERVER_VAD }
            : {}),
        },
      },
    },
  };
}

export function buildLegacyRealtimeSessionPayload(
  input: VoiceRealtimeSessionInput,
  options: { includeTurnDetection?: boolean } = {},
) {
  const includeTurnDetection = options.includeTurnDetection !== false;
  return {
    model: input.realtimeModel,
    modalities: ["audio", "text"],
    input_audio_transcription: {
      model: input.transcriptionModel,
      language: input.language,
    },
    ...(includeTurnDetection ? { turn_detection: DEFAULT_SERVER_VAD } : {}),
  };
}

export function isUnsupportedTurnDetectionError(
  status: number,
  body: string,
): boolean {
  if (status !== 400) return false;

  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: unknown;
        param?: unknown;
        code?: unknown;
      };
    };
    const message = typeof parsed.error?.message === "string"
      ? parsed.error.message.toLowerCase()
      : "";
    const param = typeof parsed.error?.param === "string"
      ? parsed.error.param
      : "";
    const code = typeof parsed.error?.code === "string"
      ? parsed.error.code
      : "";

    return (
      param.includes("turn_detection") &&
      code === "invalid_value" &&
      message.includes("turn detection is not supported")
    );
  } catch {
    return body.includes("turn_detection") &&
      body.toLowerCase().includes("turn detection is not supported");
  }
}
