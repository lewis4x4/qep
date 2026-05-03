import type { VoiceOpsResult, VoiceToolCall } from "./voice-ops-api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function voiceIntent(value: unknown): VoiceOpsResult["intent"] {
  return value === "lookup" ||
    value === "stock_check" ||
    value === "add_to_order" ||
    value === "history" ||
    value === "other"
    ? value
    : "other";
}

export function normalizeVoiceOpsResult(value: unknown): VoiceOpsResult {
  const record = objectValue(value);
  return {
    ok: record.ok === true,
    spoken_text: stringValue(record.spoken_text),
    intent: voiceIntent(record.intent),
    tool_calls: normalizeVoiceToolCalls(record.tool_calls),
    elapsed_ms: numberValue(record.elapsed_ms),
    tokens_in: numberValue(record.tokens_in),
    tokens_out: numberValue(record.tokens_out),
    cost_usd_cents: numberValue(record.cost_usd_cents),
  };
}

function normalizeVoiceToolCalls(rows: unknown): VoiceToolCall[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const name = stringValue(value.name);
    if (!name) return null;
    return {
      name,
      input: objectValue(value.input),
      result: value.result,
      elapsed_ms: numberValue(value.elapsed_ms),
    };
  }).filter((row): row is VoiceToolCall => row !== null);
}
