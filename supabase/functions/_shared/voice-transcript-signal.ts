const GENERIC_NOISE_TRANSCRIPTS = new Set([
  "you",
  "thank you",
  "thanks",
  "okay",
  "ok",
  "yeah",
  "yes",
  "no",
  "uh",
  "um",
  "hmm",
  "hello",
  "hi",
  "bye",
  "goodbye",
  "you you",
  "okay thank you",
  "ok thank you",
  "yeah okay",
]);

const ACTIONABLE_FIELD_NOTE_PATTERN =
  /\b(\d+[a-z]?|call|text|email|follow|tomorrow|today|quote|demo|budget|rental|rent|lease|finance|buy|sold|deal|customer|contact|job|site|machine|equipment|excavator|loader|dozer|skid|steer|tractor|mulcher|bucket|parts|service|repair|trade|deere|cat|komatsu|case|bobcat|volvo)\b/i;

export interface TranscriptSignalAnalysis {
  normalized: string;
  words: string[];
  wordCount: number;
  isGenericNoise: boolean;
  hasActionableHint: boolean;
}

export function analyzeTranscriptSignal(transcript: string | null | undefined): TranscriptSignalAnalysis {
  const normalized = (transcript ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s.,!?;:'"“”‘’()\[\]-]+/g, " ")
    .trim();
  const words = normalized ? normalized.split(/\s+/).filter(Boolean) : [];

  return {
    normalized,
    words,
    wordCount: words.length,
    isGenericNoise: GENERIC_NOISE_TRANSCRIPTS.has(normalized),
    hasActionableHint: ACTIONABLE_FIELD_NOTE_PATTERN.test(normalized),
  };
}

export function isLowSignalTranscript(
  transcript: string | null | undefined,
  durationSeconds: number | null,
): boolean {
  const signal = analyzeTranscriptSignal(transcript);
  if (!signal.normalized) return true;
  if (signal.isGenericNoise) return true;

  // OpenAI can hallucinate one-token filler (for example "You") from silent clips.
  // Always reject one-word transcripts; there is not enough field-note content to trust.
  if (signal.wordCount <= 1) return true;

  // For longer recordings, two non-actionable words are still likely silence/noise. Do not
  // reject 3-4 word notes anymore: short actionable field notes such as "call John tomorrow"
  // should be saved and allowed to produce low-confidence extraction instead of being lost.
  if (durationSeconds !== null && durationSeconds >= 10 && signal.wordCount <= 2 && !signal.hasActionableHint) {
    return true;
  }

  return false;
}
