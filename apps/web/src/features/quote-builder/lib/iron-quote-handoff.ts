export const IRON_QUOTE_HANDOFF_KEY = "qep.ironQuote.pendingIntake";
export const IRON_QUOTE_HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

export type IronQuoteCustomerMatchKind = "contact" | "company" | "none";
export type IronQuoteIntakeMissingField = "customer" | "equipment" | "options" | "timeframe";

export interface IronQuoteHandoff {
  handoffId: string;
  at: string;
  rawText: string;
  targetText: string;
  sourceConversationId: string | null;

  resolvedContactId: string | null;
  resolvedCompanyId: string | null;
  resolvedCustomerName: string | null;
  resolvedCustomerCompany: string | null;
  resolvedCustomerPhone: string | null;
  resolvedCustomerEmail: string | null;

  customerSearchQuery: string | null;
  customerMatchKind: IronQuoteCustomerMatchKind;

  structuredCustomerText: string | null;
  structuredEquipmentText: string | null;
  structuredOptionsText: string | null;
  structuredTimeframeText: string | null;
  structuredApplicationText: string | null;
  structuredMissingFields: IronQuoteIntakeMissingField[];
}

interface ParseOptions {
  expectedHandoffId?: string;
  nowMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function clampString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function nullableString(value: unknown, maxLength: number): string | null {
  const text = clampString(value, maxLength);
  return text ? text : null;
}

function normalizeMatchKind(value: unknown): IronQuoteCustomerMatchKind {
  return value === "contact" || value === "company" ? value : "none";
}

function normalizeMissingFields(value: unknown): IronQuoteIntakeMissingField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<IronQuoteIntakeMissingField>();
  for (const item of value) {
    if (item === "customer" || item === "equipment" || item === "options" || item === "timeframe") {
      seen.add(item);
    }
  }
  return [...seen];
}

export function normalizeIronQuoteHandoff(
  value: unknown,
  options: ParseOptions = {},
): IronQuoteHandoff | null {
  if (!isRecord(value)) return null;

  const handoffId = clampString(value.handoffId, 120);
  if (!handoffId) return null;
  if (options.expectedHandoffId && handoffId !== options.expectedHandoffId) return null;

  const at = clampString(value.at, 80);
  if (!at) return null;
  const createdAtMs = new Date(at).getTime();
  if (!Number.isFinite(createdAtMs)) return null;
  const nowMs = options.nowMs ?? Date.now();
  if (nowMs - createdAtMs > IRON_QUOTE_HANDOFF_MAX_AGE_MS) return null;

  const rawText = clampString(value.rawText, 4000);
  if (!rawText) return null;

  return {
    handoffId,
    at,
    rawText,
    targetText: clampString(value.targetText, 1000),
    sourceConversationId: nullableString(value.sourceConversationId, 120),
    resolvedContactId: nullableString(value.resolvedContactId, 120),
    resolvedCompanyId: nullableString(value.resolvedCompanyId, 120),
    resolvedCustomerName: nullableString(value.resolvedCustomerName, 500),
    resolvedCustomerCompany: nullableString(value.resolvedCustomerCompany, 500),
    resolvedCustomerPhone: nullableString(value.resolvedCustomerPhone, 120),
    resolvedCustomerEmail: nullableString(value.resolvedCustomerEmail, 320),
    customerSearchQuery: nullableString(value.customerSearchQuery, 500),
    customerMatchKind: normalizeMatchKind(value.customerMatchKind),
    structuredCustomerText: nullableString(value.structuredCustomerText, 500),
    structuredEquipmentText: nullableString(value.structuredEquipmentText, 500),
    structuredOptionsText: nullableString(value.structuredOptionsText, 1000),
    structuredTimeframeText: nullableString(value.structuredTimeframeText, 500),
    structuredApplicationText: nullableString(value.structuredApplicationText, 500),
    structuredMissingFields: normalizeMissingFields(value.structuredMissingFields),
  };
}

export function parseIronQuoteHandoff(
  raw: string | null,
  options: ParseOptions = {},
): IronQuoteHandoff | null {
  if (!raw) return null;
  try {
    return normalizeIronQuoteHandoff(JSON.parse(raw), options);
  } catch {
    return null;
  }
}

export function writeIronQuoteHandoff(
  handoff: IronQuoteHandoff,
  storage: Storage | null = getSessionStorage(),
): boolean {
  if (!storage) return false;
  storage.setItem(IRON_QUOTE_HANDOFF_KEY, JSON.stringify(handoff));
  return true;
}

export function readIronQuoteHandoff(
  expectedHandoffId: string,
  storage: Storage | null = getSessionStorage(),
  nowMs = Date.now(),
): IronQuoteHandoff | null {
  if (!storage || !expectedHandoffId) return null;
  return parseIronQuoteHandoff(storage.getItem(IRON_QUOTE_HANDOFF_KEY), {
    expectedHandoffId,
    nowMs,
  });
}

export function clearIronQuoteHandoff(storage: Storage | null = getSessionStorage()): void {
  storage?.removeItem(IRON_QUOTE_HANDOFF_KEY);
}
