export interface VoiceModelConfig {
  transcriptionModel: string;
  extractionModel: string;
}

export interface VoiceRealtimeModelConfig {
  transcriptionModel: string;
}

export const WHISPER_TRANSCRIPTION_MODEL = "whisper-1";
export const DEFAULT_VOICE_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
export const DEFAULT_VOICE_CAPTURE_EXTRACTION_MODEL = "gpt-5.4-mini";
export const DEFAULT_VOICE_QRM_EXTRACTION_MODEL = "gpt-5.4-mini";
export const DEFAULT_VOICE_REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

export const VOICE_TRANSCRIPTION_DOMAIN_PROMPT =
  "QEP heavy equipment dealership field notes. Expect customer names, company names, QRM deal IDs, equipment makes/models, attachments, budgets, timelines, rentals, parts, service, trade-ins, quotes, demos, and next steps.";

function envOrDefault(name: string, fallback: string): string {
  const value = Deno.env.get(name)?.trim();
  return value && value.length > 0 ? value : fallback;
}

export function resolveVoiceCaptureModelConfig(): VoiceModelConfig {
  return {
    transcriptionModel: envOrDefault("OPENAI_TRANSCRIPTION_MODEL", DEFAULT_VOICE_TRANSCRIPTION_MODEL),
    extractionModel: envOrDefault(
      "OPENAI_VOICE_CAPTURE_EXTRACTION_MODEL",
      DEFAULT_VOICE_CAPTURE_EXTRACTION_MODEL,
    ),
  };
}

export function resolveVoiceToQrmModelConfig(): VoiceModelConfig {
  return {
    transcriptionModel: envOrDefault("OPENAI_TRANSCRIPTION_MODEL", DEFAULT_VOICE_TRANSCRIPTION_MODEL),
    extractionModel: envOrDefault(
      "OPENAI_VOICE_QRM_EXTRACTION_MODEL",
      DEFAULT_VOICE_QRM_EXTRACTION_MODEL,
    ),
  };
}

export function resolveVoiceRealtimeModelConfig(): VoiceRealtimeModelConfig {
  return {
    transcriptionModel: envOrDefault(
      "OPENAI_REALTIME_TRANSCRIPTION_MODEL",
      DEFAULT_VOICE_REALTIME_TRANSCRIPTION_MODEL,
    ),
  };
}
