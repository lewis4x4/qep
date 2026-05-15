import type {
  QuoteCommercialDiscountType,
  QuoteEntryMode,
  QuoteLineItemDraft,
  QuoteLineItemKind,
  QuoteTaxProfile,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import { quoteLineCostVisibility } from "./quote-workspace";

const LOCAL_DRAFT_PREFIX = "qep.quote-builder.local-draft.";
const ENTRY_MODES: QuoteEntryMode[] = ["voice", "ai_chat", "manual", "trade_photo"];
/** Must match `QuoteLineItemKind` so configure / pricing lines round-trip through localStorage. */
const LINE_ITEM_KINDS: QuoteLineItemKind[] = [
  "equipment",
  "attachment",
  "option",
  "accessory",
  "part",
  "warranty",
  "financing",
  "pdi",
  "freight",
  "good_faith",
  "doc_fee",
  "title",
  "tag",
  "registration",
  "discount",
  "trade_allowance",
  "rebate_mfg",
  "rebate_dealer",
  "loyalty_discount",
  "tax_state",
  "tax_county",
  "custom",
];
const TAX_PROFILES: QuoteTaxProfile[] = [
  "standard",
  "agriculture_exempt",
  "fire_mitigation_exempt",
  "government_exempt",
  "resale_exempt",
];
const QUOTE_STATUSES: Array<NonNullable<QuoteWorkspaceDraft["quoteStatus"]>> = [
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

type QuoteRecommendation = NonNullable<QuoteWorkspaceDraft["recommendation"]>;
type QuoteRecommendationTrigger = NonNullable<QuoteRecommendation["trigger"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = asString(item).trim();
        return text ? [text] : [];
      })
    : [];
}

function normalizeEntryMode(value: unknown): QuoteEntryMode | undefined {
  for (const mode of ENTRY_MODES) {
    if (value === mode) return mode;
  }
  return undefined;
}

function normalizeTaxProfile(value: unknown): QuoteTaxProfile | undefined {
  for (const profile of TAX_PROFILES) {
    if (value === profile) return profile;
  }
  return undefined;
}

function normalizeQuoteStatus(value: unknown): NonNullable<QuoteWorkspaceDraft["quoteStatus"]> | undefined {
  for (const status of QUOTE_STATUSES) {
    if (value === status) return status;
  }
  return undefined;
}

function normalizeDiscountType(value: unknown): QuoteCommercialDiscountType | undefined {
  return value === "percent" ? "percent" : value === "flat" ? "flat" : undefined;
}

function normalizePostApprovalAction(value: unknown): NonNullable<QuoteWorkspaceDraft["postApprovalAction"]> | undefined {
  if (value === "auto_send_customer") return "auto_send_customer";
  if (value === "return_to_rep") return "return_to_rep";
  return undefined;
}

function normalizeFinancingPref(value: unknown): NonNullable<QuoteWorkspaceDraft["financingPref"]> | undefined {
  if (value === "cash" || value === "financing" || value === "open") return value;
  return undefined;
}

function normalizeCustomerWarmth(value: unknown): NonNullable<QuoteWorkspaceDraft["customerWarmth"]> | undefined {
  if (value === "warm" || value === "cool" || value === "dormant" || value === "new") return value;
  return undefined;
}

function normalizeLineItemKind(value: unknown): QuoteLineItemKind | undefined {
  for (const kind of LINE_ITEM_KINDS) {
    if (value === kind) return kind;
  }
  return undefined;
}

function normalizeLineItemCostVisibility(value: unknown): QuoteLineItemDraft["costVisibility"] | undefined {
  if (value === "internal" || value === "customer") return value;
  return undefined;
}

function normalizeSourceCatalog(value: unknown): QuoteLineItemDraft["sourceCatalog"] | undefined {
  return value === "qb_equipment_models"
    || value === "qb_attachments"
    || value === "catalog_entries"
    || value === "manual"
    ? value
    : undefined;
}

function normalizeLineItems(value: unknown): QuoteLineItemDraft[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = asString(record.title).trim();
    const kind = normalizeLineItemKind(record.kind);
    if (!title || !kind) return [];
    const line: QuoteLineItemDraft = {
      kind,
      title,
      id: asString(record.id) || undefined,
      sourceCatalog: normalizeSourceCatalog(record.sourceCatalog ?? record.source_catalog),
      sourceId: asNullableString(record.sourceId ?? record.source_id),
      dealerCost: asNumber(record.dealerCost),
      make: asString(record.make) || undefined,
      model: asString(record.model) || undefined,
      year: asNumber(record.year),
      quantity: Math.max(1, Math.round(asNumber(record.quantity) ?? 1)),
      unitPrice: asNumber(record.unitPrice) ?? 0,
    };
    const rawMeta = record.metadata;
    if (rawMeta !== null && rawMeta !== undefined && typeof rawMeta === "object" && !Array.isArray(rawMeta)) {
      line.metadata = { ...(rawMeta as Record<string, unknown>) };
    }
    const explicitVis = normalizeLineItemCostVisibility(record.costVisibility ?? record.cost_visibility);
    line.costVisibility = quoteLineCostVisibility({
      kind,
      metadata: line.metadata,
      ...(explicitVis ? { costVisibility: explicitVis } : {}),
    });
    const reasonRaw = record.reasonCode ?? record.reason_code;
    if (typeof reasonRaw === "string") {
      const trimmed = reasonRaw.trim();
      if (trimmed) line.reasonCode = trimmed;
    }
    if (record.approvalRequired === true || record.approval_required === true) {
      line.approvalRequired = true;
    }
    return [line];
  });
  return items;
}

function normalizeTriggerType(value: unknown): QuoteRecommendationTrigger["triggerType"] | null {
  return value === "voice_transcript"
    || value === "ai_chat_prompt"
    || value === "manual_request"
    || value === "quote_event"
    ? value
    : null;
}

function normalizeRecommendation(value: unknown): QuoteWorkspaceDraft["recommendation"] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const alternativeRecord = asRecord(record.alternative);
  const triggerRecord = asRecord(record.trigger);
  const triggerType = normalizeTriggerType(triggerRecord?.triggerType);
  return {
    machine: asString(record.machine),
    attachments: asStringArray(record.attachments),
    reasoning: asString(record.reasoning),
    alternative: alternativeRecord
      ? {
          machine: asString(alternativeRecord.machine),
          attachments: asStringArray(alternativeRecord.attachments),
          reasoning: asString(alternativeRecord.reasoning),
          whyNotChosen: asNullableString(alternativeRecord.whyNotChosen),
        }
      : null,
    jobConsiderations: Array.isArray(record.jobConsiderations)
      ? asStringArray(record.jobConsiderations)
      : null,
    jobFacts: Array.isArray(record.jobFacts)
      ? record.jobFacts.flatMap((fact) => {
          const factRecord = asRecord(fact);
          if (!factRecord) return [];
          const label = asString(factRecord.label).trim();
          const factValue = asString(factRecord.value).trim();
          return label && factValue ? [{ label, value: factValue }] : [];
        })
      : null,
    transcriptHighlights: Array.isArray(record.transcriptHighlights)
      ? record.transcriptHighlights.flatMap((highlight) => {
          const highlightRecord = asRecord(highlight);
          if (!highlightRecord) return [];
          const quote = asString(highlightRecord.quote).trim();
          const supports = asString(highlightRecord.supports).trim();
          return quote && supports ? [{ quote, supports }] : [];
        })
      : null,
    trigger: triggerRecord && triggerType
      ? {
          triggerType,
          sourceField: asString(triggerRecord.sourceField),
          excerpt: asNullableString(triggerRecord.excerpt),
          createdAt: asNullableString(triggerRecord.createdAt),
        }
      : null,
  };
}

function normalizeLocalDraft(value: unknown): Partial<QuoteWorkspaceDraft> | null {
  const record = asRecord(value);
  if (!record) return null;
  const draft: Partial<QuoteWorkspaceDraft> = {};

  const entryMode = normalizeEntryMode(record.entryMode);
  if (entryMode) draft.entryMode = entryMode;
  const branchSlug = asString(record.branchSlug);
  if (branchSlug) draft.branchSlug = branchSlug;
  const recommendation = normalizeRecommendation(record.recommendation);
  if (recommendation !== undefined) draft.recommendation = recommendation;
  if ("voiceSummary" in record) draft.voiceSummary = asNullableString(record.voiceSummary);
  const equipment = normalizeLineItems(record.equipment);
  if (equipment) draft.equipment = equipment;
  const attachments = normalizeLineItems(record.attachments);
  if (attachments) draft.attachments = attachments;
  if ("pricingLines" in record) {
    const pricingLines = normalizeLineItems(record.pricingLines);
    if (pricingLines !== undefined) draft.pricingLines = pricingLines;
  }
  const tradeAllowance = asNumber(record.tradeAllowance);
  if (tradeAllowance !== null) draft.tradeAllowance = tradeAllowance;
  if ("tradeValuationId" in record) draft.tradeValuationId = asNullableString(record.tradeValuationId);
  const commercialDiscountType = normalizeDiscountType(record.commercialDiscountType);
  if (commercialDiscountType) draft.commercialDiscountType = commercialDiscountType;
  const commercialDiscountValue = asNumber(record.commercialDiscountValue);
  if (commercialDiscountValue !== null) draft.commercialDiscountValue = commercialDiscountValue;
  const cashDown = asNumber(record.cashDown);
  if (cashDown !== null) draft.cashDown = cashDown;
  const taxProfile = normalizeTaxProfile(record.taxProfile);
  if (taxProfile) draft.taxProfile = taxProfile;
  const taxTotal = asNumber(record.taxTotal);
  if (taxTotal !== null) draft.taxTotal = taxTotal;
  const amountFinanced = asNumber(record.amountFinanced);
  if (amountFinanced !== null) draft.amountFinanced = amountFinanced;
  if ("selectedFinanceScenario" in record) {
    draft.selectedFinanceScenario = asNullableString(record.selectedFinanceScenario);
  }
  if ("followUpAt" in record) draft.followUpAt = asNullableString(record.followUpAt);
  if ("expiresAt" in record) draft.expiresAt = asNullableString(record.expiresAt);
  if ("deliveryEta" in record) draft.deliveryEta = asNullableString(record.deliveryEta);
  if ("deliveryState" in record) {
    const state = asString(record.deliveryState);
    if (state) draft.deliveryState = state;
  }
  if ("deliveryCounty" in record) {
    const county = asString(record.deliveryCounty);
    if (county) draft.deliveryCounty = county;
  }
  if ("specialTerms" in record) draft.specialTerms = asNullableString(record.specialTerms);
  if ("whyThisMachine" in record) draft.whyThisMachine = asNullableString(record.whyThisMachine);
  if ("whyThisMachineConfirmed" in record) {
    draft.whyThisMachineConfirmed = record.whyThisMachineConfirmed === true;
  }
  if ("depositRequiredAmount" in record) {
    const dep = asNumber(record.depositRequiredAmount);
    if (dep !== null) draft.depositRequiredAmount = dep;
  }
  if ("taxJurisdictionId" in record) draft.taxJurisdictionId = asNullableString(record.taxJurisdictionId);
  if ("taxOverrideAmount" in record) {
    const taxOv = asNumber(record.taxOverrideAmount);
    if (taxOv !== null) draft.taxOverrideAmount = taxOv;
  }
  if ("taxOverrideReason" in record) draft.taxOverrideReason = asNullableString(record.taxOverrideReason);
  if ("financingPref" in record) {
    const fp = normalizeFinancingPref(record.financingPref);
    if (fp !== undefined) draft.financingPref = fp;
  }
  if ("customerWarmth" in record) {
    const warmth = normalizeCustomerWarmth(record.customerWarmth);
    if (warmth !== undefined) draft.customerWarmth = warmth;
  }
  if ("wizardStep" in record) {
    const step = asNumber(record.wizardStep);
    if (step !== null && Number.isInteger(step)) draft.wizardStep = step;
  }
  if ("selectedPromotionIds" in record && Array.isArray(record.selectedPromotionIds)) {
    const ids = record.selectedPromotionIds.flatMap((id) => {
      if (typeof id !== "string") return [];
      const text = id.trim();
      return text ? [text] : [];
    });
    draft.selectedPromotionIds = ids;
  }
  for (const key of [
    "dealId",
    "contactId",
    "companyId",
    "customerName",
    "customerCompany",
    "customerPhone",
    "customerEmail",
    "originatingLogId",
  ] as const) {
    const valueForKey = asString(record[key]);
    if (valueForKey) draft[key] = valueForKey;
  }
  const quoteStatus = normalizeQuoteStatus(record.quoteStatus);
  if (quoteStatus) draft.quoteStatus = quoteStatus;
  const postApprovalAction = normalizePostApprovalAction(record.postApprovalAction ?? record.post_approval_action);
  if (postApprovalAction) draft.postApprovalAction = postApprovalAction;
  return draft;
}

function normalizeLocalDraftEnvelope(value: unknown): {
  draft: Partial<QuoteWorkspaceDraft>;
  savedAt: string;
} | null {
  const record = asRecord(value);
  if (!record) return null;
  const draft = normalizeLocalDraft(record.draft);
  if (!draft) return null;
  return {
    draft,
    savedAt: asString(record.savedAt),
  };
}

function sanitizeDraftForLocalStorage(draft: QuoteWorkspaceDraft): Partial<QuoteWorkspaceDraft> {
  return {
    ...draft,
    customerName: "",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "",
    voiceSummary: null,
    recommendation: draft.recommendation
      ? {
          ...draft.recommendation,
          transcriptHighlights: null,
          trigger: draft.recommendation.trigger
            ? { ...draft.recommendation.trigger, excerpt: null }
            : draft.recommendation.trigger,
        }
      : draft.recommendation,
  };
}

// Keys are scoped by the authenticated user so a shared device (or a
// sign-out / sign-in in the same browser profile) never leaks one rep's
// partial draft into another rep's view.
export function buildLocalDraftKey(params: {
  userId: string;
  dealId?: string | null;
  contactId?: string | null;
}): string {
  const user = params.userId;
  if (params.dealId) return `${user}.deal:${params.dealId}`;
  if (params.contactId) return `${user}.contact:${params.contactId}`;
  return `${user}.new`;
}

export function loadLocalDraft(key: string): Partial<QuoteWorkspaceDraft> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_DRAFT_PREFIX}${key}`);
    if (!raw) return null;
    return normalizeLocalDraftEnvelope(JSON.parse(raw))?.draft ?? null;
  } catch {
    return null;
  }
}

export function saveLocalDraft(key: string, draft: QuoteWorkspaceDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${LOCAL_DRAFT_PREFIX}${key}`,
      JSON.stringify({ draft: sanitizeDraftForLocalStorage(draft), savedAt: new Date().toISOString() }),
    );
  } catch {
    // Quota exceeded or serialization error — drop silently so a failed
    // persist never blocks the rep from entering data.
  }
}

export function clearLocalDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${LOCAL_DRAFT_PREFIX}${key}`);
  } catch {
    // ignore
  }
}

// A draft counts as "empty" when it contains nothing the rep entered —
// used to avoid overwriting a real stored draft with the builder's
// default initial state on first render.
export function isDraftEmpty(draft: Partial<QuoteWorkspaceDraft> | null): boolean {
  if (!draft) return true;
  if (draft.customerName?.trim()) return false;
  if (draft.customerCompany?.trim()) return false;
  if (draft.customerEmail?.trim()) return false;
  if (draft.customerPhone?.trim()) return false;
  if (draft.contactId) return false;
  if (draft.companyId) return false;
  if (draft.equipment && draft.equipment.length > 0) return false;
  if (draft.attachments && draft.attachments.length > 0) return false;
  if (draft.pricingLines && draft.pricingLines.length > 0) return false;
  if (draft.recommendation) return false;
  if (draft.voiceSummary) return false;
  if (draft.tradeAllowance && draft.tradeAllowance > 0) return false;
  if (draft.tradeValuationId) return false;
  if (draft.followUpAt?.trim()) return false;
  if (draft.deliveryState?.trim()) return false;
  if (draft.deliveryCounty?.trim()) return false;
  if (draft.whyThisMachine?.trim()) return false;
  if (draft.specialTerms?.trim()) return false;
  return true;
}

export interface LocalDraftRecord {
  key: string;
  dealId: string | null;
  contactId: string | null;
  savedAt: string;
  draft: Partial<QuoteWorkspaceDraft>;
}

// Returns every non-empty local draft stored for the given user, newest
// first. Used by the Quotes list to surface "Unsaved on this device"
// drafts that never made it to the server.
export function listLocalDraftsForUser(userId: string): LocalDraftRecord[] {
  if (typeof window === "undefined" || !userId) return [];
  const prefix = `${LOCAL_DRAFT_PREFIX}${userId}.`;
  const records: LocalDraftRecord[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const storageKey = window.localStorage.key(i);
      if (!storageKey || !storageKey.startsWith(prefix)) continue;
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) continue;
      let parsed: ReturnType<typeof normalizeLocalDraftEnvelope>;
      try {
        parsed = normalizeLocalDraftEnvelope(JSON.parse(raw));
      } catch {
        continue;
      }
      if (!parsed) continue;
      const draft = parsed?.draft;
      if (!draft || isDraftEmpty(draft)) continue;
      const suffix = storageKey.slice(prefix.length);
      let dealId: string | null = null;
      let contactId: string | null = null;
      if (suffix.startsWith("deal:")) dealId = suffix.slice("deal:".length);
      else if (suffix.startsWith("contact:")) contactId = suffix.slice("contact:".length);
      records.push({
        key: suffix,
        dealId,
        contactId,
        savedAt: parsed.savedAt,
        draft,
      });
    }
  } catch {
    return [];
  }
  records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return records;
}
