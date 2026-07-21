export const IRON_VOICE_INTENTS = ["quote", "note", "crm", "question"] as const;

export type IronVoiceIntent = (typeof IRON_VOICE_INTENTS)[number];

const INTENT_LABELS: Record<IronVoiceIntent, string> = {
  quote: "Quote",
  note: "Note",
  crm: "CRM update",
  question: "Question",
};

export function labelIronVoiceIntent(intent: IronVoiceIntent): string {
  return INTENT_LABELS[intent];
}

/**
 * A deterministic first-pass classification used only for the confirmation UI.
 * No navigation or write occurs until the rep confirms (or corrects) this choice.
 */
export function inferIronVoiceIntent(transcript: string): IronVoiceIntent {
  const normalized = transcript.trim().toLowerCase();

  if (/\b(update|change|assign|move).*(crm|customer|contact|deal|stage|phone|email|owner)\b/.test(normalized)) {
    return "crm";
  }
  if (/\b(quote|proposal|bid|price out|pricing for|rental rate)\b/.test(normalized)) {
    return "quote";
  }
  if (/\b(log|note|visit|met with|spoke with|call summary|follow[- ]?up)\b/.test(normalized)) {
    return "note";
  }

  return "question";
}

/** Adds an explicit verb so the existing Iron orchestrator receives the confirmed intent. */
export function buildConfirmedIronVoiceRequest(
  intent: IronVoiceIntent,
  correctedTranscript: string,
): string {
  const transcript = correctedTranscript.trim();
  if (!transcript) return "";

  switch (intent) {
    case "quote":
      return `Create a quote: ${transcript}`;
    case "note":
      return `Log a note: ${transcript}`;
    case "crm":
      return `Update CRM: ${transcript}`;
    case "question":
      return transcript;
  }
}
