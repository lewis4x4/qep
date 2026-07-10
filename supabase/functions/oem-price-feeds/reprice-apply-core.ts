import {
  COMMISSION_RATE_OF_GROSS_MARGIN,
  isStockLockedLine,
} from "./impact-logic.ts";

/**
 * Pure policy core for OEM reprice apply + reversal.
 *
 * This module deliberately does not talk to Supabase. Callers must build every
 * input from rows re-read inside the apply/reversal transaction (or from rows
 * locked immediately before invoking the transaction RPC). The returned plan
 * contains no customer-send action and is safe to persist as an immutable
 * audit payload.
 */

export const REPRICE_REVERSAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

const ELEVATED_ROLES = new Set(["admin", "manager", "owner"]);
const IRREVERSIBLE_QUOTE_STATUSES = new Set([
  "accepted",
  "rejected",
  "expired",
  "converted_to_deal",
  "archived",
]);
const SALE_LINE_TYPES = new Set([
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
  "custom",
]);
const DISCOUNT_LINE_TYPES = new Set([
  "discount",
  "rebate_mfg",
  "rebate_dealer",
  "loyalty_discount",
]);

export type RepricePolicyErrorCode =
  | "invalid_input"
  | "cross_workspace"
  | "unauthorized_actor"
  | "wrong_rep"
  | "draft_not_approved"
  | "draft_not_current"
  | "approval_not_approved"
  | "approval_not_current"
  | "approval_authority_invalid"
  | "margin_override_required"
  | "customer_price_locked"
  | "quote_version_conflict"
  | "quote_snapshot_conflict"
  | "quote_state_irreversible"
  | "impact_not_approved"
  | "line_snapshot_conflict"
  | "canonical_totals_conflict"
  | "no_eligible_lines"
  | "already_applied_conflict"
  | "reversal_window_expired"
  | "already_reversed_conflict"
  | "reversal_state_conflict";

export class RepricePolicyError extends Error {
  readonly code: RepricePolicyErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: RepricePolicyErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RepricePolicyError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface RepriceActor {
  userId: string;
  workspaceId: string;
  role: string;
}

export interface QuoteLineSnapshot {
  id: string;
  lineType: string;
  quantity: number;
  unitPriceCents: number;
  quotedDealerCostCents: number | null;
  costVisibility: "customer" | "internal";
  sourceLocation: string | null;
  isYardStock: boolean;
  /** Mirrors Quote Builder's metadata.misc_line_kind === "credit" branch. */
  isMiscCredit?: boolean;
}

export type CommercialDiscountSnapshot =
  | { type: "flat"; valueCents: number }
  | { type: "percent"; basisPoints: number };

export interface QuotePricingSnapshot {
  commercialDiscount: CommercialDiscountSnapshot;
  tradeCreditCents: number;
  taxTotalCents: number;
  cashDownCents: number;
}

export interface CanonicalQuoteTotals {
  equipmentTotalCents: number;
  attachmentTotalCents: number;
  subtotalCents: number;
  discountTotalCents: number;
  tradeCreditCents: number;
  netTotalCents: number;
  taxTotalCents: number;
  customerTotalCents: number;
  cashDownCents: number;
  amountFinancedCents: number;
  dealerCostCents: number;
  marginAmountCents: number;
  marginPct: number;
}

export type PersistedQuoteTotals = Omit<
  CanonicalQuoteTotals,
  "dealerCostCents"
>;

export interface QuoteSnapshot {
  id: string;
  workspaceId: string;
  assignedRepId: string | null;
  status: string;
  updatedAt: string;
  versionId: string;
  versionNumber: number;
  lines: QuoteLineSnapshot[];
  pricing: QuotePricingSnapshot;
  persistedTotals: PersistedQuoteTotals;
}

export interface RepriceDraftSnapshot {
  id: string;
  workspaceId: string;
  quotePackageId: string;
  impactId: string;
  eventId: string;
  priceSheetId: string;
  priorPriceSheetId: string | null;
  createdBy: string;
  status: string;
  updatedAt: string;
  approvalCaseId: string | null;
  quoteVersionId: string;
  quoteVersionNumber: number;
  quoteUpdatedAtSnapshot: string;
  impactUpdatedAtSnapshot: string;
}

export interface RepriceImpactSnapshot {
  id: string;
  workspaceId: string;
  quotePackageId: string;
  eventId: string;
  state: string;
  updatedAt: string;
}

export interface MarginOverrideApproval {
  authorized: boolean;
  policyId: string | null;
  reason: string | null;
}

export interface RepriceApprovalSnapshot {
  id: string;
  workspaceId: string;
  quotePackageId: string;
  quoteVersionId: string;
  quoteVersionNumber: number;
  /** Exact draft updated_at captured when the approval case was decided. */
  draftUpdatedAtSnapshot: string;
  status: string;
  decidedBy: string | null;
  decidedByRole: string | null;
  decidedAt: string | null;
  marginOverride: MarginOverrideApproval | null;
}

export interface CustomerPriceLockSnapshot {
  active: boolean;
  /** Date columns are active through the named UTC date, inclusively. */
  expiresAt: string | null;
  reason: string | null;
}

export interface ServerImpactLineSnapshot {
  impactLineId: string;
  quoteLineId: string | null;
  oldUnitPriceCents: number;
  newUnitPriceCents: number;
  quantity: number;
  sourceLocationSnapshot: string | null;
  isYardStockSnapshot: boolean;
  suppressedByStockLock: boolean;
}

export interface ResultQuoteVersion {
  id: string;
  versionNumber: number;
}

export interface AuditQuoteVersion {
  id: string;
  versionNumber: number;
  updatedAt: string;
  status: string;
}

export interface AuditLineChange {
  impactLineId: string;
  quoteLineId: string | null;
  decision: "applied" | "preserved";
  preservationReason: "yard_stock_price_locked" | "draft_stock_lock" | null;
  quantity: number;
  sourceLocation: string | null;
  isYardStock: boolean;
  beforeUnitPriceCents: number;
  afterUnitPriceCents: number;
  beforeExtendedPriceCents: number;
  afterExtendedPriceCents: number;
}

export interface OemDp10CommissionProjection {
  policy: "OEM-DP10";
  rateOfGrossMargin: number;
  grossMarginBeforeCents: number;
  grossMarginAfterCents: number;
  commissionBeforeCents: number;
  commissionAfterCents: number;
  commissionDeltaCents: number;
  /** Deliberately null: E5.2, not A7, owns final split/allocation truth. */
  splitAllocation: null;
}

export interface RepriceApprovalAudit {
  caseId: string;
  status: "approved";
  decidedBy: string;
  decidedByRole: string;
  decidedAt: string;
  quoteVersionId: string;
  quoteVersionNumber: number;
  draftUpdatedAtSnapshot: string;
  marginOverride: MarginOverrideApproval | null;
}

export interface RepriceSourceAudit {
  eventId: string;
  priceSheetId: string;
  priorPriceSheetId: string | null;
  impactId: string;
  draftId: string;
}

export interface ApplyAuditPayload {
  schemaVersion: 1;
  action: "apply";
  idempotencyKey: string;
  workspaceId: string;
  quotePackageId: string;
  actor: Readonly<RepriceActor>;
  approval: Readonly<RepriceApprovalAudit>;
  source: Readonly<RepriceSourceAudit>;
  occurredAt: string;
  before: Readonly<{
    quoteVersion: Readonly<AuditQuoteVersion>;
    totals: Readonly<CanonicalQuoteTotals>;
  }>;
  after: Readonly<{
    quoteVersion: Readonly<AuditQuoteVersion>;
    totals: Readonly<CanonicalQuoteTotals>;
  }>;
  lines: ReadonlyArray<Readonly<AuditLineChange>>;
  commissionProjection: Readonly<OemDp10CommissionProjection>;
  sideEffects: Readonly<{
    customerCommunication: "none";
    emailDraftId: null;
  }>;
}

export interface ReversalAuditPayload {
  schemaVersion: 1;
  action: "reverse";
  idempotencyKey: string;
  workspaceId: string;
  quotePackageId: string;
  actor: Readonly<RepriceActor>;
  source: Readonly<RepriceSourceAudit>;
  approval: Readonly<RepriceApprovalAudit>;
  reversesApplyAuditId: string;
  occurredAt: string;
  before: Readonly<{
    quoteVersion: Readonly<AuditQuoteVersion>;
    totals: Readonly<CanonicalQuoteTotals>;
  }>;
  after: Readonly<{
    quoteVersion: Readonly<AuditQuoteVersion>;
    totals: Readonly<CanonicalQuoteTotals>;
  }>;
  lines: ReadonlyArray<Readonly<AuditLineChange>>;
  commissionProjection: Readonly<OemDp10CommissionProjection>;
  sideEffects: Readonly<{
    customerCommunication: "none";
    emailDraftId: null;
  }>;
}

export interface StoredApplyAudit {
  id: string;
  workspaceId: string;
  quotePackageId: string;
  draftId: string;
  idempotencyKey: string;
  appliedAt: string;
  reversedAt: string | null;
  payload: Readonly<ApplyAuditPayload>;
}

export interface StoredReversalAudit {
  id: string;
  workspaceId: string;
  quotePackageId: string;
  applyAuditId: string;
  idempotencyKey: string;
  payload: Readonly<ReversalAuditPayload>;
}

export interface ApplyRepriceInput {
  now: string;
  actor: RepriceActor;
  quote: QuoteSnapshot;
  draft: RepriceDraftSnapshot;
  impact: RepriceImpactSnapshot;
  approval: RepriceApprovalSnapshot;
  customerPriceLock: CustomerPriceLockSnapshot;
  serverImpactLines: ServerImpactLineSnapshot[];
  marginFloorPct: number;
  resultQuoteVersion: ResultQuoteVersion;
  existingApplication?: StoredApplyAudit | null;
}

export interface ApplyLineMutation {
  quoteLineId: string;
  expectedUnitPriceCents: number;
  expectedQuantity: number;
  expectedSourceLocation: string | null;
  expectedIsYardStock: boolean;
  nextUnitPriceCents: number;
  nextExtendedPriceCents: number;
}

export interface ApplyMutationPlan {
  kind: "apply";
  idempotencyKey: string;
  quotePackageId: string;
  expectedQuoteVersionId: string;
  expectedQuoteVersionNumber: number;
  expectedQuoteUpdatedAt: string;
  resultQuoteVersion: Readonly<ResultQuoteVersion>;
  lineMutations: ReadonlyArray<Readonly<ApplyLineMutation>>;
  nextTotals: Readonly<CanonicalQuoteTotals>;
  stateTransitions: Readonly<{
    draftStatus: "applied";
    impactState: "applied";
    /** RPC must recompute EXISTS(other active impacts); never blindly clear it. */
    quoteRequiresRequote: "recompute_from_active_impacts";
  }>;
  audit: Readonly<ApplyAuditPayload>;
  customerCommunication: "none";
}

export interface ApplyIdempotentResult {
  kind: "idempotent";
  idempotencyKey: string;
  applicationAuditId: string;
  audit: Readonly<ApplyAuditPayload>;
  customerCommunication: "none";
}

export type ApplyRepriceResult = ApplyMutationPlan | ApplyIdempotentResult;

export interface ReverseRepriceInput {
  now: string;
  actor: RepriceActor;
  quote: QuoteSnapshot;
  application: StoredApplyAudit;
  resultQuoteVersion: ResultQuoteVersion;
  existingReversal?: StoredReversalAudit | null;
}

export interface ReversalLineMutation {
  quoteLineId: string;
  expectedUnitPriceCents: number;
  expectedQuantity: number;
  nextUnitPriceCents: number;
  nextExtendedPriceCents: number;
}

export interface ReversalMutationPlan {
  kind: "reverse";
  idempotencyKey: string;
  quotePackageId: string;
  expectedQuoteVersionId: string;
  expectedQuoteVersionNumber: number;
  expectedQuoteUpdatedAt: string;
  resultQuoteVersion: Readonly<ResultQuoteVersion>;
  lineMutations: ReadonlyArray<Readonly<ReversalLineMutation>>;
  nextTotals: Readonly<CanonicalQuoteTotals>;
  stateTransitions: Readonly<{
    draftStatus: "reversed";
    impactState: "visible";
    quoteRequiresRequote: "recompute_from_active_impacts";
  }>;
  audit: Readonly<ReversalAuditPayload>;
  customerCommunication: "none";
}

export interface ReversalIdempotentResult {
  kind: "idempotent";
  idempotencyKey: string;
  reversalAuditId: string;
  audit: Readonly<ReversalAuditPayload>;
  customerCommunication: "none";
}

export type ReverseRepriceResult =
  | ReversalMutationPlan
  | ReversalIdempotentResult;

const roundPct = (value: number): number => Number(value.toFixed(2));

function requireNonEmpty(value: string, field: string): string {
  if (!value.trim()) {
    throw new RepricePolicyError("invalid_input", `${field} is required`, {
      field,
    });
  }
  return value;
}

function requireInstant(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new RepricePolicyError("invalid_input", `${field} is invalid`, {
      field,
    });
  }
  return parsed;
}

function requireCents(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RepricePolicyError(
      "invalid_input",
      `${field} must be a non-negative safe integer number of cents`,
      { field, value },
    );
  }
  return value;
}

function requireQuantity(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RepricePolicyError(
      "invalid_input",
      `${field} must be a positive safe integer`,
      { field, value },
    );
  }
  return value;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      freezeDeep(Reflect.get(value as object, key));
    }
    Object.freeze(value);
  }
  return value;
}

function extendedPrice(line: QuoteLineSnapshot): number {
  return requireCents(line.unitPriceCents, `line ${line.id} unitPriceCents`) *
    requireQuantity(line.quantity, `line ${line.id} quantity`);
}

/**
 * Cents-level mirror of Quote Builder V2's computeQuoteFinancials semantics.
 * Tax remains the transaction-fresh canonical tax snapshot, matching the
 * current Quote Builder behavior; the caller must not source it from a client.
 */
export function computeCanonicalQuoteTotals(
  lines: QuoteLineSnapshot[],
  pricing: QuotePricingSnapshot,
): CanonicalQuoteTotals {
  requireCents(pricing.tradeCreditCents, "pricing.tradeCreditCents");
  requireCents(pricing.taxTotalCents, "pricing.taxTotalCents");
  requireCents(pricing.cashDownCents, "pricing.cashDownCents");

  const customerLines = lines.filter((line) =>
    line.costVisibility === "customer"
  );
  const equipmentTotalCents = customerLines
    .filter((line) => line.lineType === "equipment")
    .reduce((sum, line) => sum + extendedPrice(line), 0);
  const attachmentTotalCents = customerLines
    .filter((line) =>
      line.lineType !== "equipment" && SALE_LINE_TYPES.has(line.lineType)
    )
    .reduce((sum, line) => sum + extendedPrice(line), 0);
  const subtotalCents = equipmentTotalCents + attachmentTotalCents;
  const lineDiscountCents = customerLines
    .filter((line) =>
      DISCOUNT_LINE_TYPES.has(line.lineType) || line.isMiscCredit === true
    )
    .reduce((sum, line) => sum + extendedPrice(line), 0);

  let commercialDiscountCents: number;
  if (pricing.commercialDiscount.type === "percent") {
    const basisPoints = pricing.commercialDiscount.basisPoints;
    if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
      throw new RepricePolicyError(
        "invalid_input",
        "pricing.commercialDiscount.basisPoints must be a non-negative integer",
      );
    }
    commercialDiscountCents = Math.round(
      subtotalCents * Math.min(10_000, basisPoints) / 10_000,
    );
  } else {
    commercialDiscountCents = requireCents(
      pricing.commercialDiscount.valueCents,
      "pricing.commercialDiscount.valueCents",
    );
  }

  const discountTotalCents = lineDiscountCents + commercialDiscountCents;
  const netTotalCents = Math.max(
    0,
    subtotalCents - discountTotalCents - pricing.tradeCreditCents,
  );
  const customerTotalCents = netTotalCents + pricing.taxTotalCents;
  const amountFinancedCents = Math.max(
    0,
    customerTotalCents - pricing.cashDownCents,
  );
  const dealerCostCents = lines
    .filter((line) =>
      SALE_LINE_TYPES.has(line.lineType) ||
      line.costVisibility === "internal"
    )
    .reduce((sum, line) => {
      const explicitCost = line.quotedDealerCostCents === null
        ? 0
        : requireCents(
          line.quotedDealerCostCents,
          `line ${line.id} quotedDealerCostCents`,
        );
      const unitCost = explicitCost > 0
        ? explicitCost
        : line.costVisibility === "internal"
        ? requireCents(line.unitPriceCents, `line ${line.id} unitPriceCents`)
        : explicitCost;
      return sum + unitCost * requireQuantity(
            line.quantity,
            `line ${line.id} quantity`,
          );
    }, 0);
  const marginAmountCents = Math.max(0, netTotalCents - dealerCostCents);
  const marginPct = netTotalCents > 0
    ? roundPct((marginAmountCents / netTotalCents) * 100)
    : 0;

  return {
    equipmentTotalCents,
    attachmentTotalCents,
    subtotalCents,
    discountTotalCents,
    tradeCreditCents: pricing.tradeCreditCents,
    netTotalCents,
    taxTotalCents: pricing.taxTotalCents,
    customerTotalCents,
    cashDownCents: pricing.cashDownCents,
    amountFinancedCents,
    dealerCostCents,
    marginAmountCents,
    marginPct,
  };
}

function persistedTotalsMatch(
  canonical: CanonicalQuoteTotals,
  persisted: PersistedQuoteTotals,
): boolean {
  return canonical.equipmentTotalCents === persisted.equipmentTotalCents &&
    canonical.attachmentTotalCents === persisted.attachmentTotalCents &&
    canonical.subtotalCents === persisted.subtotalCents &&
    canonical.discountTotalCents === persisted.discountTotalCents &&
    canonical.tradeCreditCents === persisted.tradeCreditCents &&
    canonical.netTotalCents === persisted.netTotalCents &&
    canonical.taxTotalCents === persisted.taxTotalCents &&
    canonical.customerTotalCents === persisted.customerTotalCents &&
    canonical.cashDownCents === persisted.cashDownCents &&
    canonical.amountFinancedCents === persisted.amountFinancedCents &&
    canonical.marginAmountCents === persisted.marginAmountCents &&
    canonical.marginPct === persisted.marginPct;
}

export function isCustomerPriceLockActive(
  lock: CustomerPriceLockSnapshot,
  now: string,
): boolean {
  const nowMs = requireInstant(now, "now");
  if (!lock.active) return false;
  if (!lock.expiresAt) return true;
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(lock.expiresAt)?.[1];
  if (dateOnly) {
    return new Date(nowMs).toISOString().slice(0, 10) <= dateOnly;
  }
  return nowMs <= requireInstant(lock.expiresAt, "customerPriceLock.expiresAt");
}

export function applyIdempotencyKey(
  workspaceId: string,
  draftId: string,
): string {
  return `oem-reprice:apply:${workspaceId}:${draftId}`;
}

export function reversalIdempotencyKey(
  workspaceId: string,
  applyAuditId: string,
): string {
  return `oem-reprice:reverse:${workspaceId}:${applyAuditId}`;
}

function ensureWorkspace(
  expected: string,
  fields: Record<string, string>,
): void {
  const mismatched = Object.entries(fields).find(([, value]) =>
    value !== expected
  );
  if (mismatched) {
    throw new RepricePolicyError(
      "cross_workspace",
      `${mismatched[0]} is outside the actor workspace`,
      { expected, actual: mismatched[1], field: mismatched[0] },
    );
  }
}

function ensureActorCanMutateQuote(
  actor: RepriceActor,
  quote: QuoteSnapshot,
  draftCreatedBy?: string,
): void {
  requireNonEmpty(actor.userId, "actor.userId");
  if (ELEVATED_ROLES.has(actor.role)) return;
  if (actor.role !== "rep") {
    throw new RepricePolicyError(
      "unauthorized_actor",
      "Only the assigned rep or an elevated sales role may mutate a reprice",
      { role: actor.role },
    );
  }
  if (quote.assignedRepId !== actor.userId) {
    throw new RepricePolicyError(
      "wrong_rep",
      "The acting rep is not assigned to this quote",
    );
  }
  if (draftCreatedBy && draftCreatedBy !== actor.userId) {
    throw new RepricePolicyError(
      "wrong_rep",
      "A rep may apply only their own approved reprice draft",
    );
  }
}

function ensureResultVersion(
  current: QuoteSnapshot,
  result: ResultQuoteVersion,
): void {
  requireNonEmpty(result.id, "resultQuoteVersion.id");
  if (result.versionNumber !== current.versionNumber + 1) {
    throw new RepricePolicyError(
      "invalid_input",
      "The result quote version must immediately follow the locked version",
      {
        currentVersionNumber: current.versionNumber,
        resultVersionNumber: result.versionNumber,
      },
    );
  }
}

function commissionProjection(
  before: CanonicalQuoteTotals,
  after: CanonicalQuoteTotals,
): OemDp10CommissionProjection {
  const beforeCommission = Math.round(
    before.marginAmountCents * COMMISSION_RATE_OF_GROSS_MARGIN,
  );
  const afterCommission = Math.round(
    after.marginAmountCents * COMMISSION_RATE_OF_GROSS_MARGIN,
  );
  return {
    policy: "OEM-DP10",
    rateOfGrossMargin: COMMISSION_RATE_OF_GROSS_MARGIN,
    grossMarginBeforeCents: before.marginAmountCents,
    grossMarginAfterCents: after.marginAmountCents,
    commissionBeforeCents: beforeCommission,
    commissionAfterCents: afterCommission,
    commissionDeltaCents: afterCommission - beforeCommission,
    splitAllocation: null,
  };
}

function sameInstant(left: string, right: string): boolean {
  return requireInstant(left, "timestamp") ===
    requireInstant(right, "timestamp");
}

function assertCurrentApplySnapshot(input: ApplyRepriceInput): void {
  const { quote, draft, impact, approval } = input;
  if (IRREVERSIBLE_QUOTE_STATUSES.has(quote.status)) {
    throw new RepricePolicyError(
      "quote_state_irreversible",
      "The quote has advanced to an irreversible customer state",
      { status: quote.status },
    );
  }
  if (draft.status !== "approved") {
    throw new RepricePolicyError(
      "draft_not_approved",
      "Only an approved reprice draft may apply",
      { status: draft.status },
    );
  }
  if (impact.state !== "approved") {
    throw new RepricePolicyError(
      "impact_not_approved",
      "The current impact is not approved for apply",
      { state: impact.state },
    );
  }
  if (approval.status !== "approved") {
    throw new RepricePolicyError(
      "approval_not_approved",
      "The linked approval case must be approved without unresolved conditions",
      { status: approval.status },
    );
  }
  if (!approval.decidedBy || !approval.decidedAt) {
    throw new RepricePolicyError(
      "approval_not_current",
      "The linked approval is missing its immutable decision evidence",
    );
  }
  const decidedAtMs = requireInstant(approval.decidedAt, "approval.decidedAt");
  const nowMs = requireInstant(input.now, "now");
  const draftUpdatedAtMs = requireInstant(draft.updatedAt, "draft.updatedAt");
  if (decidedAtMs < draftUpdatedAtMs || decidedAtMs > nowMs) {
    throw new RepricePolicyError(
      "approval_not_current",
      "The approval decision timestamp does not cover the current draft",
    );
  }
  if (!approval.decidedByRole || !ELEVATED_ROLES.has(approval.decidedByRole)) {
    throw new RepricePolicyError(
      "approval_authority_invalid",
      "OEM repricing requires an elevated sales approval authority",
      { role: approval.decidedByRole },
    );
  }
  if (draft.approvalCaseId !== approval.id) {
    throw new RepricePolicyError(
      "approval_not_current",
      "The approval case is not bound to this draft",
    );
  }
  if (!sameInstant(approval.draftUpdatedAtSnapshot, draft.updatedAt)) {
    throw new RepricePolicyError(
      "approval_not_current",
      "The draft changed after the linked approval decision snapshot",
    );
  }
  if (
    draft.quoteVersionId !== quote.versionId ||
    draft.quoteVersionNumber !== quote.versionNumber ||
    approval.quoteVersionId !== quote.versionId ||
    approval.quoteVersionNumber !== quote.versionNumber
  ) {
    throw new RepricePolicyError(
      "quote_version_conflict",
      "The quote version changed after the reprice was prepared or approved",
      {
        currentVersionId: quote.versionId,
        currentVersionNumber: quote.versionNumber,
      },
    );
  }
  if (!sameInstant(draft.quoteUpdatedAtSnapshot, quote.updatedAt)) {
    throw new RepricePolicyError(
      "quote_snapshot_conflict",
      "The quote changed after the reprice snapshot was captured",
    );
  }
  if (!sameInstant(draft.impactUpdatedAtSnapshot, impact.updatedAt)) {
    throw new RepricePolicyError(
      "draft_not_current",
      "The impact changed after the draft was prepared",
    );
  }
}

function existingApplicationResult(
  input: ApplyRepriceInput,
  key: string,
): ApplyIdempotentResult | null {
  const existing = input.existingApplication;
  if (!existing) return null;
  if (
    existing.workspaceId !== input.actor.workspaceId ||
    existing.quotePackageId !== input.quote.id ||
    existing.draftId !== input.draft.id ||
    existing.idempotencyKey !== key ||
    existing.payload.idempotencyKey !== key ||
    existing.payload.action !== "apply" ||
    existing.payload.source.draftId !== input.draft.id
  ) {
    throw new RepricePolicyError(
      "already_applied_conflict",
      "An existing apply record does not match this logical operation",
    );
  }
  return freezeDeep({
    kind: "idempotent",
    idempotencyKey: key,
    applicationAuditId: existing.id,
    audit: existing.payload,
    customerCommunication: "none",
  });
}

export function planRepriceApply(
  input: ApplyRepriceInput,
): ApplyRepriceResult {
  const nowMs = requireInstant(input.now, "now");
  const { actor, quote, draft, impact, approval } = input;
  requireNonEmpty(quote.id, "quote.id");
  requireNonEmpty(draft.id, "draft.id");
  requireNonEmpty(draft.eventId, "draft.eventId");
  requireNonEmpty(draft.priceSheetId, "draft.priceSheetId");
  requireNonEmpty(impact.id, "impact.id");
  requireNonEmpty(approval.id, "approval.id");
  ensureWorkspace(actor.workspaceId, {
    quoteWorkspaceId: quote.workspaceId,
    draftWorkspaceId: draft.workspaceId,
    impactWorkspaceId: impact.workspaceId,
    approvalWorkspaceId: approval.workspaceId,
  });
  if (
    quote.id !== draft.quotePackageId || quote.id !== impact.quotePackageId ||
    quote.id !== approval.quotePackageId || draft.impactId !== impact.id ||
    draft.eventId !== impact.eventId
  ) {
    throw new RepricePolicyError(
      "draft_not_current",
      "The draft, impact, approval, and quote identities do not agree",
    );
  }
  ensureActorCanMutateQuote(actor, quote, draft.createdBy);

  const idempotencyKey = applyIdempotencyKey(actor.workspaceId, draft.id);
  const idempotent = existingApplicationResult(input, idempotencyKey);
  if (idempotent) return idempotent;
  if (draft.status === "applied") {
    throw new RepricePolicyError(
      "already_applied_conflict",
      "The draft is marked applied but its matching audit record is missing",
    );
  }

  assertCurrentApplySnapshot(input);
  ensureResultVersion(quote, input.resultQuoteVersion);
  if (isCustomerPriceLockActive(input.customerPriceLock, input.now)) {
    throw new RepricePolicyError(
      "customer_price_locked",
      "The customer has an active price lock",
      {
        reason: input.customerPriceLock.reason,
        expiresAt: input.customerPriceLock.expiresAt,
      },
    );
  }

  const beforeTotals = computeCanonicalQuoteTotals(quote.lines, quote.pricing);
  if (!persistedTotalsMatch(beforeTotals, quote.persistedTotals)) {
    throw new RepricePolicyError(
      "canonical_totals_conflict",
      "Persisted quote totals do not match transaction-fresh canonical lines",
      {
        expectedNetTotalCents: beforeTotals.netTotalCents,
        persistedNetTotalCents: quote.persistedTotals.netTotalCents,
      },
    );
  }

  const lineById = new Map(quote.lines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  const changedPrices = new Map<string, number>();
  const lineMutations: ApplyLineMutation[] = [];
  const auditLines: AuditLineChange[] = [];

  for (const patch of input.serverImpactLines) {
    requireNonEmpty(patch.impactLineId, "serverImpactLine.impactLineId");
    requireCents(patch.oldUnitPriceCents, "serverImpactLine.oldUnitPriceCents");
    requireCents(patch.newUnitPriceCents, "serverImpactLine.newUnitPriceCents");
    requireQuantity(patch.quantity, "serverImpactLine.quantity");
    if (!patch.quoteLineId) {
      throw new RepricePolicyError(
        "line_snapshot_conflict",
        "A reprice line without a normalized quote line identity cannot apply safely",
        { impactLineId: patch.impactLineId },
      );
    }
    if (seen.has(patch.quoteLineId)) {
      throw new RepricePolicyError(
        "line_snapshot_conflict",
        "A quote line appears more than once in the approved impact",
        { quoteLineId: patch.quoteLineId },
      );
    }
    seen.add(patch.quoteLineId);
    const current = lineById.get(patch.quoteLineId);
    if (!current) {
      throw new RepricePolicyError(
        "line_snapshot_conflict",
        "An approved impact line no longer exists on the quote",
        { quoteLineId: patch.quoteLineId },
      );
    }
    if (
      current.unitPriceCents !== patch.oldUnitPriceCents ||
      current.quantity !== patch.quantity ||
      current.sourceLocation !== patch.sourceLocationSnapshot ||
      current.isYardStock !== patch.isYardStockSnapshot
    ) {
      throw new RepricePolicyError(
        "line_snapshot_conflict",
        "A quote line changed after the approved impact snapshot",
        { quoteLineId: current.id },
      );
    }

    const stockLocked = isStockLockedLine({
      sourceLocation: current.sourceLocation,
      isYardStock: current.isYardStock,
    });
    const preserved = stockLocked || patch.suppressedByStockLock;
    const nextPrice = preserved
      ? current.unitPriceCents
      : patch.newUnitPriceCents;
    auditLines.push({
      impactLineId: patch.impactLineId,
      quoteLineId: current.id,
      decision: preserved ? "preserved" : "applied",
      preservationReason: stockLocked
        ? "yard_stock_price_locked"
        : patch.suppressedByStockLock
        ? "draft_stock_lock"
        : null,
      quantity: current.quantity,
      sourceLocation: current.sourceLocation,
      isYardStock: current.isYardStock,
      beforeUnitPriceCents: current.unitPriceCents,
      afterUnitPriceCents: nextPrice,
      beforeExtendedPriceCents: current.unitPriceCents * current.quantity,
      afterExtendedPriceCents: nextPrice * current.quantity,
    });
    if (!preserved && nextPrice !== current.unitPriceCents) {
      changedPrices.set(current.id, nextPrice);
      lineMutations.push({
        quoteLineId: current.id,
        expectedUnitPriceCents: current.unitPriceCents,
        expectedQuantity: current.quantity,
        expectedSourceLocation: current.sourceLocation,
        expectedIsYardStock: current.isYardStock,
        nextUnitPriceCents: nextPrice,
        nextExtendedPriceCents: nextPrice * current.quantity,
      });
    }
  }
  if (lineMutations.length === 0) {
    throw new RepricePolicyError(
      "no_eligible_lines",
      "No approved, unlocked quote lines remain eligible to apply",
    );
  }

  const afterLines = quote.lines.map((line) => {
    const nextPrice = changedPrices.get(line.id);
    return nextPrice === undefined
      ? line
      : { ...line, unitPriceCents: nextPrice };
  });
  const afterTotals = computeCanonicalQuoteTotals(afterLines, quote.pricing);
  if (
    !Number.isFinite(input.marginFloorPct) || input.marginFloorPct < 0 ||
    input.marginFloorPct > 100
  ) {
    throw new RepricePolicyError(
      "invalid_input",
      "A transaction-fresh margin floor is required",
    );
  }
  if (afterTotals.marginPct < input.marginFloorPct) {
    const marginOverride = approval.marginOverride;
    if (
      !marginOverride?.authorized || !marginOverride.policyId?.trim() ||
      !marginOverride.reason?.trim()
    ) {
      throw new RepricePolicyError(
        "margin_override_required",
        "The repriced quote is below floor and lacks an authorized, auditable override",
        {
          marginFloorPct: input.marginFloorPct,
          projectedMarginPct: afterTotals.marginPct,
        },
      );
    }
  }

  const approvalAudit: RepriceApprovalAudit = {
    caseId: approval.id,
    status: "approved",
    decidedBy: approval.decidedBy!,
    decidedByRole: approval.decidedByRole!,
    decidedAt: approval.decidedAt!,
    quoteVersionId: approval.quoteVersionId,
    quoteVersionNumber: approval.quoteVersionNumber,
    draftUpdatedAtSnapshot: approval.draftUpdatedAtSnapshot,
    marginOverride: approval.marginOverride
      ? { ...approval.marginOverride }
      : null,
  };
  const sourceAudit: RepriceSourceAudit = {
    eventId: draft.eventId,
    priceSheetId: draft.priceSheetId,
    priorPriceSheetId: draft.priorPriceSheetId,
    impactId: impact.id,
    draftId: draft.id,
  };
  const audit = freezeDeep<ApplyAuditPayload>({
    schemaVersion: 1,
    action: "apply",
    idempotencyKey,
    workspaceId: actor.workspaceId,
    quotePackageId: quote.id,
    actor: { ...actor },
    approval: approvalAudit,
    source: sourceAudit,
    occurredAt: new Date(nowMs).toISOString(),
    before: {
      quoteVersion: {
        id: quote.versionId,
        versionNumber: quote.versionNumber,
        updatedAt: quote.updatedAt,
        status: quote.status,
      },
      totals: beforeTotals,
    },
    after: {
      quoteVersion: {
        id: input.resultQuoteVersion.id,
        versionNumber: input.resultQuoteVersion.versionNumber,
        updatedAt: new Date(nowMs).toISOString(),
        status: quote.status,
      },
      totals: afterTotals,
    },
    lines: auditLines,
    commissionProjection: commissionProjection(beforeTotals, afterTotals),
    sideEffects: {
      customerCommunication: "none",
      emailDraftId: null,
    },
  });

  return freezeDeep({
    kind: "apply",
    idempotencyKey,
    quotePackageId: quote.id,
    expectedQuoteVersionId: quote.versionId,
    expectedQuoteVersionNumber: quote.versionNumber,
    expectedQuoteUpdatedAt: quote.updatedAt,
    resultQuoteVersion: { ...input.resultQuoteVersion },
    lineMutations,
    nextTotals: afterTotals,
    stateTransitions: {
      draftStatus: "applied",
      impactState: "applied",
      quoteRequiresRequote: "recompute_from_active_impacts",
    },
    audit,
    customerCommunication: "none",
  });
}

function existingReversalResult(
  input: ReverseRepriceInput,
  key: string,
): ReversalIdempotentResult | null {
  const existing = input.existingReversal;
  if (!existing) return null;
  if (
    existing.workspaceId !== input.actor.workspaceId ||
    existing.quotePackageId !== input.quote.id ||
    existing.applyAuditId !== input.application.id ||
    existing.idempotencyKey !== key ||
    existing.payload.idempotencyKey !== key ||
    existing.payload.action !== "reverse" ||
    existing.payload.reversesApplyAuditId !== input.application.id
  ) {
    throw new RepricePolicyError(
      "already_reversed_conflict",
      "An existing reversal record does not match this logical operation",
    );
  }
  return freezeDeep({
    kind: "idempotent",
    idempotencyKey: key,
    reversalAuditId: existing.id,
    audit: existing.payload,
    customerCommunication: "none",
  });
}

export function planRepriceReversal(
  input: ReverseRepriceInput,
): ReverseRepriceResult {
  const nowMs = requireInstant(input.now, "now");
  const appliedAtMs = requireInstant(input.application.appliedAt, "appliedAt");
  const { actor, quote, application } = input;
  ensureWorkspace(actor.workspaceId, {
    quoteWorkspaceId: quote.workspaceId,
    applicationWorkspaceId: application.workspaceId,
    auditWorkspaceId: application.payload.workspaceId,
  });
  if (
    application.quotePackageId !== quote.id ||
    application.payload.quotePackageId !== quote.id ||
    application.payload.source.draftId !== application.draftId
  ) {
    throw new RepricePolicyError(
      "reversal_state_conflict",
      "The application audit does not belong to this quote",
    );
  }
  if (!sameInstant(application.appliedAt, application.payload.occurredAt)) {
    throw new RepricePolicyError(
      "reversal_state_conflict",
      "The stored apply timestamp does not match its immutable audit payload",
    );
  }
  ensureActorCanMutateQuote(actor, quote);

  const idempotencyKey = reversalIdempotencyKey(
    actor.workspaceId,
    application.id,
  );
  const idempotent = existingReversalResult(input, idempotencyKey);
  if (idempotent) return idempotent;
  if (application.reversedAt) {
    throw new RepricePolicyError(
      "already_reversed_conflict",
      "The apply audit is marked reversed but its matching reversal audit is missing",
    );
  }
  if (nowMs > appliedAtMs + REPRICE_REVERSAL_WINDOW_MS) {
    throw new RepricePolicyError(
      "reversal_window_expired",
      "The seven-day reprice reversal window has expired",
      {
        deadline: new Date(appliedAtMs + REPRICE_REVERSAL_WINDOW_MS)
          .toISOString(),
      },
    );
  }
  if (IRREVERSIBLE_QUOTE_STATUSES.has(quote.status)) {
    throw new RepricePolicyError(
      "quote_state_irreversible",
      "The quote has advanced to an irreversible customer state",
      { status: quote.status },
    );
  }
  ensureResultVersion(quote, input.resultQuoteVersion);

  const appliedSnapshot = application.payload.after;
  if (
    quote.versionId !== appliedSnapshot.quoteVersion.id ||
    quote.versionNumber !== appliedSnapshot.quoteVersion.versionNumber
  ) {
    throw new RepricePolicyError(
      "quote_version_conflict",
      "The quote version changed after the OEM reprice was applied",
    );
  }
  if (
    !sameInstant(quote.updatedAt, appliedSnapshot.quoteVersion.updatedAt) ||
    quote.status !== appliedSnapshot.quoteVersion.status
  ) {
    throw new RepricePolicyError(
      "reversal_state_conflict",
      "The quote state changed after the OEM reprice was applied",
    );
  }

  const currentTotals = computeCanonicalQuoteTotals(quote.lines, quote.pricing);
  if (
    !persistedTotalsMatch(currentTotals, quote.persistedTotals) ||
    JSON.stringify(currentTotals) !== JSON.stringify(appliedSnapshot.totals)
  ) {
    throw new RepricePolicyError(
      "canonical_totals_conflict",
      "Current totals no longer match the applied audit snapshot",
    );
  }

  const lineById = new Map(quote.lines.map((line) => [line.id, line]));
  const restoredPrices = new Map<string, number>();
  const lineMutations: ReversalLineMutation[] = [];
  const auditLines: AuditLineChange[] = [];
  for (const appliedLine of application.payload.lines) {
    if (appliedLine.decision !== "applied" || !appliedLine.quoteLineId) {
      continue;
    }
    const current = lineById.get(appliedLine.quoteLineId);
    if (
      !current || current.quantity !== appliedLine.quantity ||
      current.unitPriceCents !== appliedLine.afterUnitPriceCents
    ) {
      throw new RepricePolicyError(
        "line_snapshot_conflict",
        "A repriced line changed after apply and cannot be overwritten by reversal",
        { quoteLineId: appliedLine.quoteLineId },
      );
    }
    restoredPrices.set(current.id, appliedLine.beforeUnitPriceCents);
    lineMutations.push({
      quoteLineId: current.id,
      expectedUnitPriceCents: current.unitPriceCents,
      expectedQuantity: current.quantity,
      nextUnitPriceCents: appliedLine.beforeUnitPriceCents,
      nextExtendedPriceCents: appliedLine.beforeExtendedPriceCents,
    });
    auditLines.push({
      impactLineId: appliedLine.impactLineId,
      quoteLineId: current.id,
      decision: "applied",
      preservationReason: null,
      quantity: current.quantity,
      sourceLocation: current.sourceLocation,
      isYardStock: current.isYardStock,
      beforeUnitPriceCents: current.unitPriceCents,
      afterUnitPriceCents: appliedLine.beforeUnitPriceCents,
      beforeExtendedPriceCents: current.unitPriceCents * current.quantity,
      afterExtendedPriceCents: appliedLine.beforeExtendedPriceCents,
    });
  }
  if (lineMutations.length === 0) {
    throw new RepricePolicyError(
      "reversal_state_conflict",
      "The apply audit has no reversible line mutations",
    );
  }

  const restoredLines = quote.lines.map((line) => {
    const restored = restoredPrices.get(line.id);
    return restored === undefined
      ? line
      : { ...line, unitPriceCents: restored };
  });
  const restoredTotals = computeCanonicalQuoteTotals(
    restoredLines,
    quote.pricing,
  );
  if (
    JSON.stringify(restoredTotals) !==
      JSON.stringify(application.payload.before.totals)
  ) {
    throw new RepricePolicyError(
      "reversal_state_conflict",
      "The reversal no longer reconstructs the exact pre-apply totals",
    );
  }

  const audit = freezeDeep<ReversalAuditPayload>({
    schemaVersion: 1,
    action: "reverse",
    idempotencyKey,
    workspaceId: actor.workspaceId,
    quotePackageId: quote.id,
    actor: { ...actor },
    source: { ...application.payload.source },
    approval: {
      ...application.payload.approval,
      marginOverride: application.payload.approval.marginOverride
        ? { ...application.payload.approval.marginOverride }
        : null,
    },
    reversesApplyAuditId: application.id,
    occurredAt: new Date(nowMs).toISOString(),
    before: {
      quoteVersion: {
        id: quote.versionId,
        versionNumber: quote.versionNumber,
        updatedAt: quote.updatedAt,
        status: quote.status,
      },
      totals: currentTotals,
    },
    after: {
      quoteVersion: {
        id: input.resultQuoteVersion.id,
        versionNumber: input.resultQuoteVersion.versionNumber,
        updatedAt: new Date(nowMs).toISOString(),
        status: quote.status,
      },
      totals: restoredTotals,
    },
    lines: auditLines,
    commissionProjection: commissionProjection(currentTotals, restoredTotals),
    sideEffects: {
      customerCommunication: "none",
      emailDraftId: null,
    },
  });

  return freezeDeep({
    kind: "reverse",
    idempotencyKey,
    quotePackageId: quote.id,
    expectedQuoteVersionId: quote.versionId,
    expectedQuoteVersionNumber: quote.versionNumber,
    expectedQuoteUpdatedAt: quote.updatedAt,
    resultQuoteVersion: { ...input.resultQuoteVersion },
    lineMutations,
    nextTotals: restoredTotals,
    stateTransitions: {
      draftStatus: "reversed",
      impactState: "visible",
      quoteRequiresRequote: "recompute_from_active_impacts",
    },
    audit,
    customerCommunication: "none",
  });
}
