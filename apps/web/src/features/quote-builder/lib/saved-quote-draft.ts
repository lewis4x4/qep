import type {
  QuoteEntryMode,
  QuoteLineItemKind,
  QuoteLineItemDraft,
  QuoteTaxProfile,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

const ENTRY_MODES: QuoteEntryMode[] = ["voice", "ai_chat", "manual", "trade_photo"];
const LINE_ITEM_KINDS: QuoteLineItemKind[] = ["equipment", "attachment", "warranty", "financing", "custom"];
const TAX_PROFILES: QuoteTaxProfile[] = [
  "standard",
  "agriculture_exempt",
  "fire_mitigation_exempt",
  "government_exempt",
  "resale_exempt",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
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
  return ENTRY_MODES.some((mode) => mode === value);
}

function isTaxProfile(value: string): value is QuoteTaxProfile {
  return TAX_PROFILES.some((profile) => profile === value);
}

function isLineItemKind(value: string): value is QuoteLineItemKind {
  return LINE_ITEM_KINDS.some((kind) => kind === value);
}

function isSourceCatalog(value: string): value is NonNullable<QuoteLineItemDraft["sourceCatalog"]> {
  return ["qb_equipment_models", "qb_attachments", "catalog_entries", "manual"].includes(value);
}

function isQuoteStatus(
  value: string,
): value is NonNullable<QuoteWorkspaceDraft["quoteStatus"]> {
  const statuses: Array<NonNullable<QuoteWorkspaceDraft["quoteStatus"]>> = [
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
  ];
  return statuses.some((status) => status === value);
}

function normalizeAttachmentKind(primary: unknown, fallback: unknown): QuoteLineItemKind {
  const fallbackKind = asString(fallback);
  if (isLineItemKind(fallbackKind) && fallbackKind !== "equipment") return fallbackKind;
  const kind = asString(primary);
  return isLineItemKind(kind) && kind !== "equipment" ? kind : "attachment";
}

function normalizeRecommendationTriggerType(
  value: unknown,
): NonNullable<NonNullable<QuoteWorkspaceDraft["recommendation"]>["trigger"]>["triggerType"] | null {
  const triggerType = asString(value);
  return triggerType === "voice_transcript"
    || triggerType === "ai_chat_prompt"
    || triggerType === "manual_request"
    || triggerType === "quote_event"
    ? triggerType
    : null;
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

  const line: QuoteLineItemDraft = {
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
  };
  const sourceCatalog = asString(record.sourceCatalog);
  const sourceId = asString(record.sourceId);
  const dealerCost = asNumber(record.dealerCost) ?? asNumber(record.dealer_cost) ?? asNumber(record.quoted_dealer_cost);
  if (isSourceCatalog(sourceCatalog)) line.sourceCatalog = sourceCatalog;
  if (sourceId) line.sourceId = sourceId;
  if (dealerCost !== null) line.dealerCost = dealerCost;
  return [line];
}

function toAttachmentDraft(item: unknown): QuoteLineItemDraft[] {
  const record = asRecord(item);
  if (!record) return [];

  const title = asString(record.name) || asString(record.title);
  if (!title) return [];

  const line: QuoteLineItemDraft = {
    kind: normalizeAttachmentKind(record.kind, record.line_type),
    title,
    id: asString(record.id) || undefined,
    quantity: Math.max(1, Math.round(asNumber(record.quantity) ?? 1)),
    unitPrice:
      asNumber(record.price)
      ?? asNumber(record.unit_price)
      ?? asNumber(record.amount)
      ?? 0,
  };
  const sourceCatalog = asString(record.sourceCatalog);
  const sourceId = asString(record.sourceId);
  const dealerCost = asNumber(record.dealerCost) ?? asNumber(record.dealer_cost) ?? asNumber(record.quoted_dealer_cost);
  if (isSourceCatalog(sourceCatalog)) line.sourceCatalog = sourceCatalog;
  if (sourceId) line.sourceId = sourceId;
  if (dealerCost !== null) line.dealerCost = dealerCost;
  return [line];
}

function toPackageLineItemDraft(item: unknown): QuoteLineItemDraft[] {
  const record = asRecord(item);
  if (!record) return [];
  const metadata = asRecord(record.metadata);
  const lineType = asString(record.line_type);
  const kind = isLineItemKind(lineType) ? lineType : "custom";
  const title =
    asString(record.description)
    || asString(record.title)
    || asString(record.name)
    || buildEquipmentTitle(record);
  if (!title) return [];

  const line: QuoteLineItemDraft = {
    kind,
    id: asString(metadata?.source_id) || asString(record.catalog_entry_id) || asString(record.id) || undefined,
    title,
    make: asString(record.make) || undefined,
    model: asString(record.model) || undefined,
    year: asNumber(record.year),
    quantity: Math.max(1, Math.round(asNumber(record.quantity) ?? 1)),
    unitPrice:
      asNumber(record.unit_price)
      ?? asNumber(record.quoted_list_price)
      ?? asNumber(record.price)
      ?? asNumber(record.amount)
      ?? 0,
  };
  const sourceCatalog = asString(metadata?.source_catalog);
  const sourceId = asString(metadata?.source_id) || asString(record.catalog_entry_id);
  const dealerCost = asNumber(record.quoted_dealer_cost) ?? asNumber(record.dealer_cost);
  if (isSourceCatalog(sourceCatalog)) {
    line.sourceCatalog = sourceCatalog;
  } else if (asString(record.catalog_entry_id)) {
    line.sourceCatalog = "catalog_entries";
  }
  if (sourceId) line.sourceId = sourceId;
  if (dealerCost !== null) line.dealerCost = dealerCost;
  return [line];
}

function toRecommendation(value: unknown): QuoteWorkspaceDraft["recommendation"] {
  const record = asRecord(value);
  if (!record) return null;
  const trigger = asRecord(record.trigger);
  const triggerType = normalizeRecommendationTriggerType(trigger?.triggerType);
  const alternative = asRecord(record.alternative);
  return {
    machine: asString(record.machine),
    attachments: asArray(record.attachments).flatMap((item) => {
      const name = asString(item);
      return name ? [name] : [];
    }),
    reasoning: asString(record.reasoning),
    alternative: alternative
      ? {
          machine: asString(alternative.machine),
          attachments: asArray(alternative.attachments).flatMap((item) => {
            const name = asString(item);
            return name ? [name] : [];
          }),
          reasoning: asString(alternative.reasoning),
        }
      : null,
    jobConsiderations: asArray(record.jobConsiderations).flatMap((item) => {
      const note = asString(item);
      return note ? [note] : [];
    }),
    trigger: trigger && triggerType
      ? {
          triggerType,
          sourceField: asString(trigger.sourceField),
          excerpt: asString(trigger.excerpt) || null,
          createdAt: asString(trigger.createdAt) || null,
        }
      : null,
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
  const normalizedLineItems = asArray(savedQuote.quote_package_line_items)
    .flatMap(toPackageLineItemDraft);
  const normalizedEquipment = normalizedLineItems.filter((item) => item.kind === "equipment");
  const normalizedAttachments = normalizedLineItems.filter((item) => item.kind !== "equipment");

  return {
    dealId: asString(savedQuote.deal_id) || undefined,
    contactId: asString(savedQuote.contact_id) || undefined,
    companyId: asString(savedQuote.company_id) || undefined,
    entryMode: isEntryMode(entryModeRaw) ? entryModeRaw : "manual",
    branchSlug: asString(savedQuote.branch_slug),
    recommendation: toRecommendation(savedQuote.ai_recommendation),
    voiceSummary: asString(savedQuote.opportunity_description) || asString(savedQuote.voice_transcript) || null,
    equipment: normalizedEquipment.length > 0
      ? normalizedEquipment
      : asArray(savedQuote.equipment).flatMap(toEquipmentDraft),
    attachments: normalizedAttachments.length > 0
      ? normalizedAttachments
      : asArray(savedQuote.attachments_included).flatMap(toAttachmentDraft),
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
