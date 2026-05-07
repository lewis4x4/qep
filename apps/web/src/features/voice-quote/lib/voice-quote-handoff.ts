import type { QuoteScenario } from "@/features/quote-builder/lib/programs-types";

export const VOICE_QUOTE_HANDOFF_KEY = "qep.voiceQuote.pendingSelection";
export const VOICE_QUOTE_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

export interface VoiceQuoteHandoff {
  voiceSessionId: string;
  at: string;
  scenario: QuoteScenario;
  resolvedModelId: string | null;
  resolvedBrandId: string | null;
  deliveryState: string | null;
  customerType: "standard" | "gmu";
  prompt: string;
  originatingLogId: string | null;
}

interface ParseOptions {
  expectedSessionId?: string;
  nowMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = asString(item).trim();
        return text ? [text] : [];
      })
    : [];
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeQuoteScenario(value: unknown): QuoteScenario | null {
  if (!isRecord(value)) return null;
  const label = asString(value.label);
  const description = asString(value.description);
  const customerOutOfPocketCents = asFiniteNumber(value.customerOutOfPocketCents);
  const totalPaidByCustomerCents = asFiniteNumber(value.totalPaidByCustomerCents);
  const dealerMarginCents = asFiniteNumber(value.dealerMarginCents);
  const dealerMarginPct = asFiniteNumber(value.dealerMarginPct);
  const commissionCents = asFiniteNumber(value.commissionCents);
  if (
    !label
    || customerOutOfPocketCents == null
    || totalPaidByCustomerCents == null
    || dealerMarginCents == null
    || dealerMarginPct == null
    || commissionCents == null
  ) {
    return null;
  }
  const monthlyPaymentCents = asFiniteNumber(value.monthlyPaymentCents);
  const termMonths = asFiniteNumber(value.termMonths);
  return {
    label,
    description,
    programIds: asStringArray(value.programIds),
    customerOutOfPocketCents,
    ...(monthlyPaymentCents != null ? { monthlyPaymentCents } : {}),
    ...(termMonths != null ? { termMonths } : {}),
    totalPaidByCustomerCents,
    dealerMarginCents,
    dealerMarginPct,
    commissionCents,
    pros: asStringArray(value.pros),
    cons: asStringArray(value.cons),
  };
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function normalizeVoiceQuoteHandoff(
  value: unknown,
  options: ParseOptions = {},
): VoiceQuoteHandoff | null {
  if (!isRecord(value)) return null;
  const voiceSessionId = asString(value.voiceSessionId).trim();
  if (!voiceSessionId) return null;
  if (options.expectedSessionId && voiceSessionId !== options.expectedSessionId) return null;

  const scenario = normalizeQuoteScenario(value.scenario);
  if (!scenario) return null;

  const at = asString(value.at).trim();
  if (!at) return null;
  const createdAtMs = new Date(at).getTime();
  if (!Number.isFinite(createdAtMs)) return null;
  const nowMs = options.nowMs ?? Date.now();
  if (nowMs - createdAtMs > VOICE_QUOTE_HANDOFF_MAX_AGE_MS) return null;

  return {
    voiceSessionId,
    at,
    scenario,
    resolvedModelId: asNullableString(value.resolvedModelId),
    resolvedBrandId: asNullableString(value.resolvedBrandId),
    deliveryState: asNullableString(value.deliveryState),
    customerType: value.customerType === "gmu" ? "gmu" : "standard",
    prompt: asString(value.prompt),
    originatingLogId: asNullableString(value.originatingLogId),
  };
}

export function parseVoiceQuoteHandoff(
  raw: string | null,
  options: ParseOptions = {},
): VoiceQuoteHandoff | null {
  if (!raw) return null;
  try {
    return normalizeVoiceQuoteHandoff(JSON.parse(raw), options);
  } catch {
    return null;
  }
}

export function readVoiceQuoteHandoff(
  expectedSessionId: string,
  storage: Storage | null = getSessionStorage(),
  nowMs = Date.now(),
): VoiceQuoteHandoff | null {
  if (!storage || !expectedSessionId) return null;
  return parseVoiceQuoteHandoff(storage.getItem(VOICE_QUOTE_HANDOFF_KEY), {
    expectedSessionId,
    nowMs,
  });
}

export function clearVoiceQuoteHandoff(storage: Storage | null = getSessionStorage()): void {
  storage?.removeItem(VOICE_QUOTE_HANDOFF_KEY);
}
