import type { Branch } from "@/hooks/useBranches";
import type { QuoteScenario } from "@/features/quote-builder/lib/programs-types";
import type { QuotePDFData } from "../components/QuotePDFDocument";
import type { ScenarioSelection } from "../components/ConversationalDealEngine";

export type PendingScenarioSelection = ScenarioSelection & { at?: string };

const HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

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

export function normalizePendingScenarioSelection(
  value: unknown,
  nowMs = Date.now(),
): PendingScenarioSelection | null {
  if (!isRecord(value)) return null;
  const scenario = normalizeQuoteScenario(value.scenario);
  if (!scenario) return null;
  const customerType = value.customerType === "gmu" ? "gmu" : "standard";
  const at = asString(value.at);
  if (at) {
    const createdAtMs = new Date(at).getTime();
    if (Number.isFinite(createdAtMs) && nowMs - createdAtMs > HANDOFF_MAX_AGE_MS) return null;
  }
  return {
    scenario,
    resolvedModelId: asNullableString(value.resolvedModelId),
    resolvedBrandId: asNullableString(value.resolvedBrandId),
    deliveryState: asNullableString(value.deliveryState),
    customerType,
    prompt: asString(value.prompt),
    originatingLogId: asNullableString(value.originatingLogId),
    ...(at ? { at } : {}),
  };
}

export function parsePendingScenarioSelection(
  raw: string | null,
  nowMs = Date.now(),
): PendingScenarioSelection | null {
  if (!raw) return null;
  try {
    return normalizePendingScenarioSelection(JSON.parse(raw), nowMs);
  } catch {
    return null;
  }
}

function optionalText(value: string | null | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

export function buildQuotePdfBranch(branch: Branch | null | undefined): QuotePDFData["branch"] {
  return {
    name: optionalText(branch?.display_name) ?? "Quality Equipment & Parts",
    address: optionalText(branch?.address_line1),
    city: optionalText(branch?.city),
    state: optionalText(branch?.state_province),
    postalCode: optionalText(branch?.postal_code),
    phone: optionalText(branch?.phone_main),
    email: optionalText(branch?.email_main),
    website: optionalText(branch?.website_url),
    footerText: optionalText(branch?.doc_footer_text),
  };
}
