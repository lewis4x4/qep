import type {
  QuoteEntryMode,
  QuoteLineItemDraft,
  QuoteTaxProfile,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

const ENTRY_MODES: QuoteEntryMode[] = ["voice", "ai_chat", "manual"];
const TAX_PROFILES: QuoteTaxProfile[] = [
  "standard",
  "agriculture_exempt",
  "fire_mitigation_exempt",
  "government_exempt",
  "resale_exempt",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isEntryMode(value: string): value is QuoteEntryMode {
  return ENTRY_MODES.includes(value as QuoteEntryMode);
}

function isTaxProfile(value: string): value is QuoteTaxProfile {
  return TAX_PROFILES.includes(value as QuoteTaxProfile);
}

function isQuoteStatus(
  value: string,
): value is NonNullable<QuoteWorkspaceDraft["quoteStatus"]> {
  return [
    "draft",
    "pending_approval",
    "approved",
    "approved_with_conditions",
    "changes_requested",
    "sent",
    "accepted",
    "rejected",
    "expired",
    "converted_to_deal",
    "archived",
  ].includes(value);
}

function buildEquipmentTitle(item: Record<string, unknown>): string {
  const explicitTitle = asString(item.title);
  if (explicitTitle) return explicitTitle;

  const make = asString(item.make);
  const model = asString(item.model);
  const year = asNumber(item.year);
  return [make, model, year ? `(${year})` : ""].filter(Boolean).join(" ").trim() || "Equipment";
}

function toEquipmentDraft(item: unknown): QuoteLineItemDraft[] {
  const record = asRecord(item);
  if (!record) return [];

  return [{
    kind: "equipment",
    id: asString(record.id) || undefined,
    title: buildEquipmentTitle(record),
    make: asString(record.make) || undefined,
    model: asString(record.model) || undefined,
    year: asNumber(record.year),
    quantity: Math.max(1, Math.round(asNumber(record.quantity) ?? 1)),
    unitPrice:
      asNumber(record.price)
      ?? asNumber(record.unit_price)
      ?? asNumber(record.amount)
      ?? 0,
  }];
}

function toAttachmentDraft(item: unknown): QuoteLineItemDraft[] {
  const record = asRecord(item);
  if (!record) return [];

  const title = asString(record.name) || asString(record.title);
  if (!title) return [];

  return [{
    kind: "attachment",
    title,
    quantity: Math.max(1, Math.round(asNumber(record.quantity) ?? 1)),
    unitPrice:
      asNumber(record.price)
      ?? asNumber(record.unit_price)
      ?? asNumber(record.amount)
      ?? 0,
  }];
}

function toRecommendation(value: unknown): QuoteWorkspaceDraft["recommendation"] {
  const record = asRecord(value);
  if (!record) return null;
  return {
    machine: asString(record.machine),
    attachments: asArray(record.attachments).flatMap((item) => {
      const name = asString(item);
      return name ? [name] : [];
    }),
    reasoning: asString(record.reasoning),
    alternative: asRecord(record.alternative)
      ? {
          machine: asString((record.alternative as Record<string, unknown>).machine),
          attachments: asArray((record.alternative as Record<string, unknown>).attachments).flatMap((item) => {
            const name = asString(item);
            return name ? [name] : [];
          }),
          reasoning: asString((record.alternative as Record<string, unknown>).reasoning),
        }
      : null,
    jobConsiderations: asArray(record.jobConsiderations).flatMap((item) => {
      const note = asString(item);
      return note ? [note] : [];
    }),
  };
}

export function hydrateDraftFromSavedQuote(
  savedQuote: Record<string, unknown>,
): Partial<QuoteWorkspaceDraft> {
  const financeScenarios = asArray(savedQuote.financing_scenarios)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  const selectedFinanceScenario = asString(savedQuote.selected_finance_scenario)
    || financeScenarios
      .map((item) => asString(item.label))
      .find(Boolean)
    || null;

  const entryModeRaw = asString(savedQuote.entry_mode);
  const taxProfileRaw = asString(savedQuote.tax_profile);
  const quoteStatusRaw = asString(savedQuote.status);
  const commercialDiscountType = asString(savedQuote.commercial_discount_type) === "percent"
    ? "percent"
    : "flat";

  return {
    dealId: asString(savedQuote.deal_id) || undefined,
    contactId: asString(savedQuote.contact_id) || undefined,
    companyId: asString(savedQuote.company_id) || undefined,
    entryMode: isEntryMode(entryModeRaw) ? entryModeRaw : "manual",
    branchSlug: asString(savedQuote.branch_slug),
    recommendation: toRecommendation(savedQuote.ai_recommendation),
    voiceSummary: null,
    equipment: asArray(savedQuote.equipment).flatMap(toEquipmentDraft),
    attachments: asArray(savedQuote.attachments_included).flatMap(toAttachmentDraft),
    tradeAllowance: asNumber(savedQuote.trade_allowance) ?? asNumber(savedQuote.trade_credit) ?? 0,
    tradeValuationId: asString(savedQuote.trade_in_valuation_id) || null,
    commercialDiscountType,
    commercialDiscountValue: asNumber(savedQuote.commercial_discount_value) ?? 0,
    cashDown: asNumber(savedQuote.cash_down) ?? 0,
    taxProfile: isTaxProfile(taxProfileRaw) ? taxProfileRaw : "standard",
    taxTotal: asNumber(savedQuote.tax_total) ?? 0,
    amountFinanced: asNumber(savedQuote.amount_financed) ?? 0,
    selectedFinanceScenario,
    customerName: asString(savedQuote.customer_name),
    customerCompany: asString(savedQuote.customer_company),
    customerPhone: asString(savedQuote.customer_phone),
    customerEmail: asString(savedQuote.customer_email),
    customerSignals: null,
    customerWarmth: null,
    quoteStatus: isQuoteStatus(quoteStatusRaw) ? quoteStatusRaw : "draft",
    originatingLogId: asString(savedQuote.originating_log_id) || null,
  };
}
