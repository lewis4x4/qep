export type QuoteEntryMode = "voice" | "ai_chat" | "manual" | "trade_photo";
export type QuoteCommercialDiscountType = "flat" | "percent";
export type QuoteLineItemKind = "equipment" | "attachment" | "warranty" | "financing" | "custom";
export type QuoteTaxProfile =
  | "standard"
  | "agriculture_exempt"
  | "fire_mitigation_exempt"
  | "government_exempt"
  | "resale_exempt";

export interface QuoteLineItemDraft {
  kind: QuoteLineItemKind;
  id?: string;
  sourceCatalog?: "qb_equipment_models" | "qb_attachments" | "catalog_entries" | "manual";
  sourceId?: string | null;
  dealerCost?: number | null;
  title: string;
  make?: string;
  model?: string;
  year?: number | null;
  quantity: number;
  unitPrice: number;
}

export interface QuoteRecommendation {
  machine: string;
  attachments: string[];
  reasoning: string;
  trigger?: {
    triggerType: "voice_transcript" | "ai_chat_prompt" | "manual_request" | "quote_event";
    sourceField: string;
    excerpt: string | null;
    createdAt?: string | null;
  } | null;
  alternative?: {
    machine: string;
    attachments: string[];
    reasoning: string;
    /** Why the primary recommendation was chosen over this alternative.
     *  Populated by the richer "why this machine" prompt (deal-room
     *  moonshot slice 4) so the customer gets a real comparison, not
     *  two disconnected paragraphs. Optional for back-compat with older
     *  saved quotes. */
    whyNotChosen?: string | null;
  } | null;
  jobConsiderations?: string[] | null;
  /** Structured facts extracted from the intake transcript (acreage,
   *  terrain, budget, timeline, etc.). Surfaces on the deal room so the
   *  customer can verify the recommendation is grounded in what they
   *  actually told the rep, and so downstream suggestions (similar
   *  deals, ROI) can filter on them. Optional. */
  jobFacts?: Array<{ label: string; value: string }> | null;
  /** Short verbatim excerpts from the intake the AI relied on. Each
   *  highlight pairs a quoted snippet (<= ~20 words) with the decision
   *  it drove. Optional; missing for quotes saved before slice 4. */
  transcriptHighlights?: Array<{ quote: string; supports: string }> | null;
}

export interface CompetitorListing {
  id: string;
  dealer_name: string;
  make: string;
  model: string;
  year: number | null;
  asking_price: number | null;
  condition: string | null;
  listing_url: string | null;
  scraped_at: string;
}

export interface QuoteFinanceScenario {
  type: "cash" | "finance" | "lease";
  label: string;
  monthlyPayment?: number | null;
  apr?: number | null;
  termMonths?: number | null;
  totalCost?: number | null;
  rate?: number | null;
  lender?: string | null;
}

export interface QuoteFinancingPreview {
  scenarios: QuoteFinanceScenario[];
  margin_check?: {
    flagged?: boolean;
    message?: string;
  } | null;
  amountFinanced?: number | null;
  taxTotal?: number | null;
  customerTotal?: number | null;
  discountTotal?: number | null;
  incentives?: {
    applicable?: Array<{
      id: string;
      name: string;
      oem_name?: string;
      discount_type: string;
      discount_value: number;
      estimated_savings: number;
      end_date?: string;
    }>;
    total_savings?: number;
  } | null;
}

export interface QuoteApprovalState {
  requiresManagerApproval: boolean;
  marginPct: number;
  reason: string | null;
}

export interface QuoteReadinessState {
  ready: boolean;
  missing: string[];
}

export interface QuotePacketReadiness {
  draft: QuoteReadinessState;
  send: QuoteReadinessState;
  canSave: boolean;
  canSend: boolean;
  missing: string[];
}

export interface QuoteWorkspaceDraft {
  dealId?: string;
  contactId?: string;
  /** CRM company id resolved when the rep picks an existing customer
   *  via the Customer Picker. Null for brand-new customers typed in
   *  manually. Enables downstream signal-driven experiences (Deal
   *  Coach can filter similar deals by company, outcome capture can
   *  attribute by company, etc.). */
  companyId?: string;
  entryMode: QuoteEntryMode;
  branchSlug: string;
  recommendation: QuoteRecommendation | null;
  voiceSummary: string | null;
  equipment: QuoteLineItemDraft[];
  attachments: QuoteLineItemDraft[];
  tradeAllowance: number;
  tradeValuationId: string | null;
  commercialDiscountType: QuoteCommercialDiscountType;
  commercialDiscountValue: number;
  cashDown: number;
  taxProfile: QuoteTaxProfile;
  taxTotal: number;
  amountFinanced: number;
  selectedFinanceScenario: string | null;
  customerName?: string;
  customerCompany?: string;
  customerPhone?: string;
  customerEmail?: string;
  /** Slice 20a: signals snapshot captured when the rep picks a CRM
   *  customer (open deals, past quote count, last-contact age, warmth).
   *  Rendered by the Customer step's intel panel without an extra fetch,
   *  and later consumed by Deal Coach / win-probability models. Kept as
   *  opaque-shaped to avoid leaking feature internals into the contract.
   *
   *  Slice 21 extends this with three *copilot-produced* signal fields
   *  (objections, timelinePressure, competitorMentions). All three are
   *  optional to preserve backward compatibility — pre-Slice-21 customer
   *  picks will not carry them, and the scorer treats absent fields as
   *  "unknown, don't score" rather than "zero, penalize". */
  customerSignals?: {
    openDeals: number;
    openDealValueCents: number;
    lastContactDaysAgo: number | null;
    pastQuoteCount: number;
    pastQuoteValueCents: number;
    /** Slice 21: objections the rep has heard from the customer, each as
     *  a short string ("price too high", "needs CEO approval"). Scored
     *  as a surface (none / priceOnly / multiple) rather than a count so
     *  reps aren't penalized for logging detail. */
    objections?: string[];
    /** Slice 21: customer's purchase timeline pressure. `immediate` lifts
     *  the score, `months` drags it. Null means unknown (no score
     *  effect). */
    timelinePressure?: "immediate" | "weeks" | "months" | null;
    /** Slice 21: competitors the customer has mentioned. Presence
     *  (regardless of count) drags the score; the prescriptive lift is
     *  `counter_competitor`. */
    competitorMentions?: string[];
  } | null;
  customerWarmth?: "warm" | "cool" | "dormant" | "new" | null;
  /** Slice 21: locked financing preference from the copilot conversation.
   *  `cash` and `financing` are commitments; `open` means the rep has
   *  confirmed with the customer that either is acceptable. Null means
   *  the rep hasn't nailed it down — the scorer surfaces the
   *  `lock_financing_pref` lift to close that gap. */
  financingPref?: "cash" | "financing" | "open" | null;
  /** Live quote package status from the server. Save returns to draft;
   *  submit-for-approval / manager decision advance this state so the
   *  review screen can unlock sending only after approval. */
  quoteStatus?:
    | "draft"
    | "pending_approval"
    | "approved"
    | "approved_with_conditions"
    | "changes_requested"
    | "sent"
    | "accepted"
    | "rejected"
    | "expired"
    | "converted_to_deal"
    | "archived"
    | null;
  /** Slice 09: when a draft was seeded by an AI-scenario stream, the
   *  qb_ai_request_log.id that generated it. Threaded through the save
   *  flow so the AI Request Log can show real time-to-quote numbers. */
  originatingLogId?: string | null;
}

export type QuoteApprovalConditionType =
  | "min_margin_pct"
  | "max_trade_allowance"
  | "required_cash_down"
  | "required_finance_scenario"
  | "remove_attachment"
  | "expiry_hours";

export type QuoteApprovalDecision =
  | "approved"
  | "approved_with_conditions"
  | "changes_requested"
  | "rejected"
  | "escalated";

export type QuoteApprovalCaseStatus =
  | "pending"
  | "approved"
  | "approved_with_conditions"
  | "changes_requested"
  | "rejected"
  | "escalated"
  | "cancelled"
  | "superseded"
  | "expired";

export type QuoteApprovalRouteMode =
  | "branch_sales_manager"
  | "branch_general_manager"
  | "owner_direct"
  | "admin_direct"
  | "admin_queue"
  | "owner_queue"
  | "manager_queue";

export interface QuoteApprovalPolicy {
  workspaceId: string;
  branchManagerMinMarginPct: number;
  standardMarginFloorPct: number;
  branchManagerMaxQuoteAmount: number;
  submitSlaHours: number;
  escalationSlaHours: number;
  ownerEscalationRole: "owner" | "admin";
  namedBranchSalesManagerPrimary: boolean;
  namedBranchGeneralManagerFallback: boolean;
  allowedConditionTypes: QuoteApprovalConditionType[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface QuoteVersionLineSnapshot {
  id: string | null;
  title: string;
  kind: QuoteLineItemKind;
  make: string | null;
  model: string | null;
  quantity: number;
  unitPrice: number;
}

export interface QuoteVersionSnapshot {
  quotePackageId: string | null;
  dealId: string | null;
  branchSlug: string | null;
  customerName: string | null;
  customerCompany: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  commercialDiscountType: QuoteCommercialDiscountType;
  commercialDiscountValue: number;
  tradeAllowance: number;
  cashDown: number;
  selectedFinanceScenario: string | null;
  taxProfile: QuoteTaxProfile;
  taxTotal: number;
  netTotal: number;
  customerTotal: number;
  amountFinanced: number;
  marginPct: number | null;
  amount: number | null;
  equipment: QuoteVersionLineSnapshot[];
  attachments: QuoteVersionLineSnapshot[];
  quoteStatus: QuoteWorkspaceDraft["quoteStatus"];
  savedAt: string | null;
}

export interface QuoteApprovalCondition {
  id: string;
  approvalCaseId: string | null;
  conditionType: QuoteApprovalConditionType;
  conditionPayload: Record<string, unknown>;
  sortOrder: number;
  createdAt: string | null;
}

export interface QuoteApprovalConditionDraft {
  id?: string | null;
  conditionType: QuoteApprovalConditionType;
  conditionPayload: Record<string, unknown>;
  sortOrder?: number;
}

export interface QuoteApprovalConditionEvaluation {
  id: string;
  conditionType: QuoteApprovalConditionType;
  label: string;
  satisfied: boolean;
  detail: string;
  blocking: boolean;
}

export interface QuoteApprovalCaseSummary {
  id: string;
  quotePackageId: string;
  quotePackageVersionId: string;
  versionNumber: number | null;
  dealId: string | null;
  branchSlug: string | null;
  branchName: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  assignedRole: string | null;
  routeMode: QuoteApprovalRouteMode;
  policySnapshot: Record<string, unknown>;
  reasonSummary: Record<string, unknown>;
  status: QuoteApprovalCaseStatus;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  dueAt: string | null;
  escalateAt: string | null;
  flowApprovalId: string | null;
  conditions: QuoteApprovalCondition[];
  evaluations: QuoteApprovalConditionEvaluation[];
  canSend: boolean;
}

export interface QuoteApprovalSubmitResult {
  approvalCaseId: string;
  approvalId: string;
  quotePackageVersionId: string;
  versionNumber: number;
  status: "pending_approval";
  branchName: string | null;
  assignedToName: string | null;
  routeMode: QuoteApprovalRouteMode;
  alreadyPending?: boolean;
}

export interface QuoteApprovalDecisionPayload {
  approvalCaseId: string;
  decision: QuoteApprovalDecision;
  note?: string | null;
  conditions?: QuoteApprovalConditionDraft[];
}

const QUOTE_APPROVAL_ALLOWED_CONDITION_TYPES: QuoteApprovalConditionType[] = [
  "min_margin_pct",
  "max_trade_allowance",
  "required_cash_down",
  "required_finance_scenario",
  "remove_attachment",
  "expiry_hours",
];

const VERSION_COMPARISON_SCOPES = [
  "branch",
  "customer",
  "pricing",
  "trade",
  "cash_down",
  "finance",
  "attachments",
  "equipment",
] as const;

type QuoteVersionComparisonScope = (typeof VERSION_COMPARISON_SCOPES)[number];

export function isQuoteApprovalConditionType(value: string): value is QuoteApprovalConditionType {
  return QUOTE_APPROVAL_ALLOWED_CONDITION_TYPES.includes(value as QuoteApprovalConditionType);
}

export function isQuoteApprovalDecision(value: string): value is QuoteApprovalDecision {
  return ["approved", "approved_with_conditions", "changes_requested", "rejected", "escalated"].includes(value);
}

export function buildQuoteVersionSnapshot(input: {
  quotePackageId?: string | null;
  dealId?: string | null;
  branchSlug?: string | null;
  customerName?: string | null;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  commercialDiscountType: QuoteCommercialDiscountType;
  commercialDiscountValue: number;
  tradeAllowance: number;
  cashDown: number;
  selectedFinanceScenario?: string | null;
  taxProfile: QuoteTaxProfile;
  taxTotal: number;
  netTotal: number;
  customerTotal: number;
  amountFinanced: number;
  marginPct?: number | null;
  amount?: number | null;
  equipment: Array<QuoteLineItemDraft | { id?: string | null; title?: string | null; make?: string | null; model?: string | null; quantity?: number | null; unitPrice?: number | null; kind?: QuoteLineItemKind }>;
  attachments: Array<QuoteLineItemDraft | { id?: string | null; title?: string | null; make?: string | null; model?: string | null; quantity?: number | null; unitPrice?: number | null; kind?: QuoteLineItemKind }>;
  quoteStatus?: QuoteWorkspaceDraft["quoteStatus"];
  savedAt?: string | null;
}): QuoteVersionSnapshot {
  function normalizeLines(
    kind: QuoteLineItemKind,
    rows: Array<QuoteLineItemDraft | { id?: string | null; title?: string | null; make?: string | null; model?: string | null; quantity?: number | null; unitPrice?: number | null; kind?: QuoteLineItemKind }>,
  ): QuoteVersionLineSnapshot[] {
    return rows.map((row) => ({
      id: row.id ?? null,
      title: row.title ?? "",
      kind: row.kind ?? kind,
      make: row.make ?? null,
      model: row.model ?? null,
      quantity: Number(row.quantity ?? 1) || 1,
      unitPrice: Number(row.unitPrice ?? 0) || 0,
    }));
  }

  return {
    quotePackageId: input.quotePackageId ?? null,
    dealId: input.dealId ?? null,
    branchSlug: input.branchSlug ?? null,
    customerName: input.customerName ?? null,
    customerCompany: input.customerCompany ?? null,
    customerEmail: input.customerEmail ?? null,
    customerPhone: input.customerPhone ?? null,
    commercialDiscountType: input.commercialDiscountType,
    commercialDiscountValue: Number(input.commercialDiscountValue ?? 0) || 0,
    tradeAllowance: Number(input.tradeAllowance ?? 0) || 0,
    cashDown: Number(input.cashDown ?? 0) || 0,
    selectedFinanceScenario: input.selectedFinanceScenario ?? null,
    taxProfile: input.taxProfile,
    taxTotal: Number(input.taxTotal ?? 0) || 0,
    netTotal: Number(input.netTotal ?? 0) || 0,
    customerTotal: Number(input.customerTotal ?? 0) || 0,
    amountFinanced: Number(input.amountFinanced ?? 0) || 0,
    marginPct: input.marginPct ?? null,
    amount: input.amount ?? input.netTotal ?? null,
    equipment: normalizeLines("equipment", input.equipment),
    attachments: normalizeLines("attachment", input.attachments),
    quoteStatus: input.quoteStatus ?? null,
    savedAt: input.savedAt ?? null,
  };
}

function shallowEqualLineArrays(a: QuoteVersionLineSnapshot[], b: QuoteVersionLineSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, index) => {
    const other = b[index];
    return Boolean(other)
      && line.id === other.id
      && line.title === other.title
      && line.kind === other.kind
      && line.make === other.make
      && line.model === other.model
      && line.quantity === other.quantity
      && line.unitPrice === other.unitPrice;
  });
}

export function diffQuoteVersionScopes(
  previous: QuoteVersionSnapshot,
  next: QuoteVersionSnapshot,
): QuoteVersionComparisonScope[] {
  const changed = new Set<QuoteVersionComparisonScope>();

  if (previous.branchSlug !== next.branchSlug) changed.add("branch");
  if (
    previous.customerName !== next.customerName
    || previous.customerCompany !== next.customerCompany
    || previous.customerEmail !== next.customerEmail
    || previous.customerPhone !== next.customerPhone
  ) changed.add("customer");
  if (
    previous.commercialDiscountType !== next.commercialDiscountType
    || previous.commercialDiscountValue !== next.commercialDiscountValue
    || previous.taxProfile !== next.taxProfile
    || previous.taxTotal !== next.taxTotal
    || previous.netTotal !== next.netTotal
    || previous.customerTotal !== next.customerTotal
    || previous.marginPct !== next.marginPct
  ) changed.add("pricing");
  if (previous.tradeAllowance !== next.tradeAllowance) changed.add("trade");
  if (previous.cashDown !== next.cashDown) changed.add("cash_down");
  if (
    previous.selectedFinanceScenario !== next.selectedFinanceScenario
    || previous.amountFinanced !== next.amountFinanced
  ) changed.add("finance");
  if (!shallowEqualLineArrays(previous.attachments, next.attachments)) changed.add("attachments");
  if (!shallowEqualLineArrays(previous.equipment, next.equipment)) changed.add("equipment");

  return VERSION_COMPARISON_SCOPES.filter((scope) => changed.has(scope));
}

export function allowedQuoteVersionScopesForConditions(
  conditions: QuoteApprovalConditionDraft[] | QuoteApprovalCondition[],
): QuoteVersionComparisonScope[] {
  const scopes = new Set<QuoteVersionComparisonScope>();
  for (const condition of conditions) {
    switch (condition.conditionType) {
      case "min_margin_pct":
        scopes.add("pricing");
        scopes.add("trade");
        scopes.add("attachments");
        break;
      case "max_trade_allowance":
        scopes.add("trade");
        break;
      case "required_cash_down":
        scopes.add("cash_down");
        break;
      case "required_finance_scenario":
        scopes.add("finance");
        break;
      case "remove_attachment":
        scopes.add("attachments");
        break;
      case "expiry_hours":
        scopes.add("pricing");
        break;
    }
  }
  return VERSION_COMPARISON_SCOPES.filter((scope) => scopes.has(scope));
}

function formatCurrencyValue(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function evaluateQuoteApprovalConditions(input: {
  snapshot: QuoteVersionSnapshot;
  conditions: QuoteApprovalConditionDraft[] | QuoteApprovalCondition[];
  decidedAt?: string | null;
  now?: string | null;
}): { evaluations: QuoteApprovalConditionEvaluation[]; allSatisfied: boolean } {
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const decidedAtMs = input.decidedAt ? Date.parse(input.decidedAt) : nowMs;
  const evaluations = input.conditions.map((condition, index) => {
    const id = condition.id ?? `${condition.conditionType}-${index}`;
    switch (condition.conditionType) {
      case "min_margin_pct": {
        const required = Number(condition.conditionPayload.min_margin_pct ?? 0) || 0;
        const actual = Number(input.snapshot.marginPct ?? 0) || 0;
        const satisfied = actual >= required;
        return {
          id,
          conditionType: condition.conditionType,
          label: `Margin at least ${required.toFixed(1)}%`,
          satisfied,
          detail: `Current margin ${actual.toFixed(1)}%`,
          blocking: true,
        };
      }
      case "max_trade_allowance": {
        const maxTrade = Number(condition.conditionPayload.max_trade_allowance ?? 0) || 0;
        const actual = Number(input.snapshot.tradeAllowance ?? 0) || 0;
        const satisfied = actual <= maxTrade;
        return {
          id,
          conditionType: condition.conditionType,
          label: `Trade allowance no more than ${formatCurrencyValue(maxTrade)}`,
          satisfied,
          detail: `Current trade allowance ${formatCurrencyValue(actual)}`,
          blocking: true,
        };
      }
      case "required_cash_down": {
        const required = Number(condition.conditionPayload.required_cash_down ?? 0) || 0;
        const actual = Number(input.snapshot.cashDown ?? 0) || 0;
        const satisfied = actual >= required;
        return {
          id,
          conditionType: condition.conditionType,
          label: `Cash down at least ${formatCurrencyValue(required)}`,
          satisfied,
          detail: `Current cash down ${formatCurrencyValue(actual)}`,
          blocking: true,
        };
      }
      case "required_finance_scenario": {
        const required = String(condition.conditionPayload.required_finance_scenario ?? "").trim();
        const actual = input.snapshot.selectedFinanceScenario ?? "";
        const satisfied = required.length === 0 ? true : actual === required;
        return {
          id,
          conditionType: condition.conditionType,
          label: `Use finance scenario ${required || "specified by manager"}`,
          satisfied,
          detail: `Current finance scenario ${actual || "none selected"}`,
          blocking: true,
        };
      }
      case "remove_attachment": {
        const target = String(condition.conditionPayload.attachment_title ?? "").trim().toLowerCase();
        const match = input.snapshot.attachments.find((attachment) => attachment.title.trim().toLowerCase() === target);
        const satisfied = !match;
        return {
          id,
          conditionType: condition.conditionType,
          label: `Remove attachment ${String(condition.conditionPayload.attachment_title ?? "").trim() || "specified by manager"}`,
          satisfied,
          detail: satisfied ? "Attachment is no longer included." : "Attachment is still included.",
          blocking: true,
        };
      }
      case "expiry_hours": {
        const hours = Number(condition.conditionPayload.expiry_hours ?? 0) || 0;
        const expiresAt = Number.isFinite(decidedAtMs)
          ? decidedAtMs + hours * 60 * 60 * 1000
          : nowMs;
        const satisfied = nowMs <= expiresAt;
        return {
          id,
          conditionType: condition.conditionType,
          label: `Send within ${hours} hours of approval`,
          satisfied,
          detail: `Approval window expires ${Number.isFinite(expiresAt) ? new Date(expiresAt).toLocaleString("en-US") : "now"}`,
          blocking: true,
        };
      }
    }
  });

  return {
    evaluations,
    allSatisfied: evaluations.every((evaluation) => evaluation.satisfied || !evaluation.blocking),
  };
}

export function resolveQuoteApprovalAuthorityBand(input: {
  marginPct: number | null | undefined;
  amount: number | null | undefined;
  policy: Pick<QuoteApprovalPolicy, "branchManagerMinMarginPct" | "branchManagerMaxQuoteAmount">;
}): "branch_manager" | "owner_admin" {
  const marginPct = Number(input.marginPct ?? 0) || 0;
  const amount = Number(input.amount ?? 0) || 0;
  if (marginPct < input.policy.branchManagerMinMarginPct) return "owner_admin";
  if (amount > input.policy.branchManagerMaxQuoteAmount) return "owner_admin";
  return "branch_manager";
}

export interface QuoteListItem {
  id: string;
  quote_number: string | null;
  customer_name: string | null;
  customer_company: string | null;
  contact_name: string | null;
  status: string;
  net_total: number | null;
  equipment_summary: string;
  entry_mode: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  /**
   * Slice 20e: denormalized win-probability score (0..100) captured at
   * save time by the rule-based scorer. Null for quotes saved before
   * the snapshot column existed. QuoteListPage renders a colored band
   * pill from this without pulling the full jsonb snapshot.
   */
  win_probability_score: number | null;
}

export interface PortalQuoteRevisionCompare {
  hasChanges: boolean;
  priceChanges: string[];
  equipmentChanges: string[];
  financingChanges: string[];
  termsChanges: string[];
  dealerMessageChange: string | null;
}

export type PortalQuoteRevisionDraftStatus = "draft" | "awaiting_approval" | "published" | "superseded";

export interface PortalQuoteRevisionDraft {
  id: string;
  portalQuoteReviewId: string;
  quotePackageId: string;
  dealId: string;
  preparedBy: string | null;
  approvedBy: string | null;
  status: PortalQuoteRevisionDraftStatus;
  quoteData: Record<string, unknown> | null;
  quotePdfUrl: string | null;
  dealerMessage: string | null;
  revisionSummary: string | null;
  customerRequestSnapshot: string | null;
  compareSnapshot: PortalQuoteRevisionCompare | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface PortalQuoteRevisionPublishState {
  portalQuoteReviewId: string;
  currentPublishedVersionNumber: number | null;
  currentPublishedDealerMessage: string | null;
  currentPublishedRevisionSummary: string | null;
  latestCustomerRequestSnapshot: string | null;
  publicationStatus: "none" | "draft_revision" | "awaiting_approval" | "published";
}

export interface ServiceJobPortalStatus {
  serviceJobId: string;
  currentStage: string;
  estimatedCompletion: string | null;
  status: string;
  lastUpdatedAt: string;
}

export interface MachinePortalStatus {
  label: string;
  source: "quote_review" | "deal_progress" | "service_job" | "portal_request" | "default";
  sourceLabel: string;
  eta: string | null;
  lastUpdatedAt: string | null;
  nextAction?: string | null;
}

export interface CustomerMachineView {
  id: string;
  make: string;
  model: string;
  year: number | null;
  serialNumber: string | null;
  currentHours: number | null;
  warrantyExpiry: string | null;
  nextServiceDue: string | null;
  tradeInInterest?: boolean;
  activeServiceJob?: ServiceJobPortalStatus | null;
  portalStatus?: MachinePortalStatus | null;
}

export interface PortalSubscriptionWorkspaceView {
  id: string;
  planName: string;
  planType: string;
  status: string;
  billingCycle: string | null;
  baseMonthlyRate: number;
  usageCapHours: number | null;
  overageRate: number | null;
  usageHours: number | null;
  overageHours: number | null;
  nextBillingDate: string | null;
  nextRotationDate: string | null;
  includesMaintenance: boolean;
  maintenanceStatus: {
    openCount: number;
    nextScheduledDate: string | null;
  };
  equipment: {
    id: string | null;
    label: string;
    serialNumber: string | null;
  } | null;
}

export interface PortalRentalReturnWorkspaceView {
  id: string;
  status: string;
  rentalContractReference: string | null;
  inspectionDate: string | null;
  decisionAt: string | null;
  refundStatus: string | null;
  balanceDue: number | null;
  chargeAmount: number | null;
  depositAmount: number | null;
  hasCharges: boolean | null;
  equipment: {
    id: string | null;
    label: string;
    serialNumber: string | null;
  } | null;
}

export type PortalRentalDeliveryMode = "pickup" | "delivery";
export type PortalRentalRequestType = "booking" | "extension";
export type PortalRentalAssignmentStatus = "pending_assignment" | "assigned";
export type PortalRentalContractStatus =
  | "submitted"
  | "reviewing"
  | "quoted"
  | "approved"
  | "awaiting_payment"
  | "active"
  | "completed"
  | "declined"
  | "cancelled";

export interface PortalRentalPricingEstimate {
  dailyRate: number | null;
  weeklyRate: number | null;
  monthlyRate: number | null;
  sourceLabel: string;
}

export interface PortalRentalPaymentStatusView {
  kind: "deposit" | "extension";
  status: "not_required" | "pending" | "processing" | "paid" | "failed";
  amount: number | null;
  invoiceId: string | null;
  companyId: string | null;
  headline: string;
  detail: string;
  canPayNow: boolean;
  canFinalize: boolean;
}

export interface PortalRentalContractView {
  id: string;
  requestType: PortalRentalRequestType;
  status: PortalRentalContractStatus;
  assignmentStatus: PortalRentalAssignmentStatus;
  deliveryMode: PortalRentalDeliveryMode;
  branchId: string | null;
  branchLabel: string | null;
  requestedCategory: string | null;
  requestedMake: string | null;
  requestedModel: string | null;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  approvedStartDate: string | null;
  approvedEndDate: string | null;
  depositRequired: boolean;
  depositAmount: number | null;
  depositStatus: string | null;
  depositInvoiceId: string | null;
  companyId: string | null;
  dealerResponse: string | null;
  customerNotes: string | null;
  signedTermsUrl: string | null;
  pricingEstimate: PortalRentalPricingEstimate | null;
  agreedRates: PortalRentalPricingEstimate | null;
  paymentStatusView: PortalRentalPaymentStatusView | null;
  equipment: {
    id: string | null;
    label: string;
    serialNumber: string | null;
  } | null;
}

export interface PortalRentalExtensionRequest {
  id: string;
  rentalContractId: string;
  status: "submitted" | "reviewing" | "approved" | "declined" | "cancelled";
  requestedEndDate: string | null;
  approvedEndDate: string | null;
  customerReason: string | null;
  dealerResponse: string | null;
  additionalCharge: number | null;
  paymentInvoiceId: string | null;
  paymentStatus: string | null;
  paymentStatusView: PortalRentalPaymentStatusView | null;
  createdAt: string;
}

export interface PortalRentalWorkspaceSummary {
  bookingCount: number;
  activeContractCount: number;
  extensionCount: number;
  closeoutCount: number;
}

export interface PortalRentalBookingDraft {
  mode: "exact_unit" | "category_first";
  equipmentId: string | null;
  requestedCategory: string | null;
  requestedMake: string | null;
  requestedModel: string | null;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  deliveryMode: PortalRentalDeliveryMode;
  branchId: string | null;
  deliveryLocation: string | null;
  customerNotes: string | null;
}

export interface PortalRentalRateRule {
  id: string;
  scopeLabel: string;
  customerId: string | null;
  equipmentId: string | null;
  branchId: string | null;
  category: string | null;
  make: string | null;
  model: string | null;
  seasonStart: string | null;
  seasonEnd: string | null;
  dailyRate: number | null;
  weeklyRate: number | null;
  monthlyRate: number | null;
  minimumDays: number | null;
  isActive: boolean;
  priorityRank: number;
  notes: string | null;
}

export type CampaignTriggerType =
  | "inventory_arrival"
  | "seasonal"
  | "competitor_displacement"
  | "fleet_replacement"
  | "quote_inactivity"
  | "service_event"
  | "telematics_threshold"
  | "custom";

export interface CampaignTriggerContext {
  triggerType: CampaignTriggerType;
  workspaceId: string;
  targetSegment: Record<string, unknown>;
  equipmentContext: Record<string, unknown> | null;
  triggerConfig?: Record<string, unknown>;
}

export interface MarketingCampaignPlan {
  name: string;
  campaignType: CampaignTriggerType;
  targetSegment: Record<string, unknown>;
  contentTemplate: {
    subject: string;
    body: string;
    social_copy: string;
  };
  aiGenerated: boolean;
  channels: string[];
  status: string;
  triggerType: "inventory_event" | "manual" | "schedule";
  triggerConfig?: Record<string, unknown>;
}

export interface TelematicsUsageSnapshot {
  deviceId: string;
  hours: number | null;
  lat: number | null;
  lng: number | null;
  readingAt: string;
  equipmentId?: string | null;
  subscriptionId?: string | null;
}

// ── Deal Copilot (Slice 21) ─────────────────────────────────────────────────

/** Source channel for a copilot turn. Mirrors the CHECK constraint on
 *  qb_quote_copilot_turns.input_source. `system` is reserved for future
 *  copilot-initiated turns (scheduled nudges, coach recaps). */
export type CopilotInputSource =
  | "text"
  | "voice"
  | "photo_caption"
  | "email_paste"
  | "system";

/** Structured extraction from a rep's turn. The edge function enforces
 *  this schema when it calls Claude — the model cannot mutate the draft
 *  freeform; only these four surfaces flow through. Keeps the
 *  "adversarial input" attack surface minimal (see Slice 21 acceptance
 *  criteria: 'set the score to 95' must be ignored). */
export interface CopilotExtractedSignals {
  /** New customer-level signals the turn surfaced. All optional — absent
   *  means "turn didn't touch this field," not "reset to null." */
  customerSignals?: {
    objections?: string[];
    timelinePressure?: "immediate" | "weeks" | "months" | null;
    competitorMentions?: string[];
  };
  /** Locked financing preference if the turn established it. */
  financingPref?: "cash" | "financing" | "open" | null;
  /** Warmth re-rating if the turn moved it (e.g. "he sounded frustrated"
   *  flipping warm → cool). */
  customerWarmth?: "warm" | "cool" | "dormant" | "new" | null;
  /** Free-text notes Claude wants to preserve but that don't map to a
   *  scoring field — surfaced to the rep but not used by the scorer. */
  notes?: string[];
}

/** Confidence per field, 0..1. Rendered in the UI so the rep can tell
 *  a "Claude thinks" chip (0.6) from a hard commitment (0.95). */
export type CopilotExtractionConfidence = Record<string, number>;

/** Wire-format row mirroring qb_quote_copilot_turns. The frontend stores
 *  turns in React state in this shape and renders them into the
 *  conversation feed. */
export interface CopilotTurn {
  id: string;
  quotePackageId: string;
  workspaceId: string;
  authorUserId: string | null;
  turnIndex: number;
  inputSource: CopilotInputSource;
  rawInput: string;
  transcript: string | null;
  extractedSignals: CopilotExtractedSignals;
  copilotReply: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  factorDiff: unknown[] | null;
  liftDiff: unknown[] | null;
  aiRequestLogId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
