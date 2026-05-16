import { supabase } from "@/lib/supabase";
export { getTradeValuation } from "@/features/qrm/lib/trade-walkaround-api";
import type {
  CompetitorListing,
  PortalQuoteRevisionCompare,
  PortalQuoteRevisionDraft,
  PortalQuoteRevisionPublishState,
  QuoteApprovalCaseSummary,
  QuoteApprovalDecisionResult,
  QuoteApprovalCaseStatus,
  QuoteApprovalCondition,
  QuoteApprovalConditionDraft,
  QuoteApprovalConditionEvaluation,
  QuoteApprovalConditionType,
  QuoteApprovalDecision,
  QuoteApprovalPolicy,
  QuoteApprovalRouteMode,
  QuoteApprovalSubmitResult,
  QuoteFinancingPreview,
  QuoteFinanceScenario,
  QuoteListItem,
  QuoteRecommendation,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import type { ClosedDealAuditRow } from "./closed-deals-audit";
import type { DealFactorObservation } from "./factor-attribution";
import type { FactorVerdict } from "./factor-verdict";
import type { CalibrationObservation, CalibrationOutcome } from "./scorer-calibration";
import { equipmentOverridePriceCents, equipmentSystemBasePrice } from "./equipment-override-price";
import { quoteLineCostVisibility } from "./quote-workspace";

const QUOTE_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-builder-v2`;

export type QuoteListAction = "resume" | "resend" | "duplicate" | "mark_sent" | "archive" | "discard";

export const QUOTE_PACKAGE_STATUS_VALUES = [
  "draft",
  "pending_approval",
  "approved",
  "approved_with_conditions",
  "changes_requested",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "rejected",
  "expired",
  "converted_to_deal",
  "archived",
] as const;

export interface QuotePackageSaveResponse {
  id?: string;
  deal_id?: string;
  quote_package_version_id?: string | null;
  version_number?: number | null;
  quote?: { id?: string; deal_id?: string; status?: string; updated_at?: string };
  warning?: string | null;
  partial_error?: string | null;
}

export interface PortalRevisionEnvelope {
  review: {
    id: string;
    status: string;
    counter_notes: string | null;
    current_version: {
      version_number: number | null;
      dealer_message: string | null;
      revision_summary: string | null;
    } | null;
  } | null;
  draft: PortalQuoteRevisionDraft | null;
  publishState: PortalQuoteRevisionPublishState | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

async function readJsonRecord(res: Response): Promise<Record<string, unknown>> {
  return recordOrEmpty(await res.json().catch(() => ({})));
}

function errorDetail(body: Record<string, unknown>): string {
  return firstString(body.error, body.message) ?? "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isCalibrationOutcome(value: unknown): value is CalibrationOutcome {
  return value === "won" || value === "lost" || value === "expired";
}

function normalizeFactorRows(value: unknown): Array<{ label: string; weight: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const label = firstString(row.label);
    const weight = numOrNull(row.weight);
    if (!label || weight == null) return [];
    return [{ label, weight }];
  });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = firstString(item);
    return text ? [text] : [];
  });
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Buffer in seconds — if the JWT expires within this window we refresh
 * proactively rather than send a soon-to-expire token. 30s is generous
 * enough to ride out the edge function round trip.
 */
const JWT_REFRESH_BUFFER_SECONDS = 30;

async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const sessionResult = await supabase.auth.getSession();
  let session = sessionResult.data.session;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = session?.expires_at ?? 0;

  // Refresh when: caller asked us to (post-401 retry), we have no token,
  // or the token is within JWT_REFRESH_BUFFER_SECONDS of expiry. The
  // previous version only refreshed on the no-token branch, which let
  // stale-but-present JWTs sail through to the gateway and 401 there.
  const needsRefresh =
    forceRefresh
    || !session?.access_token
    || expiresAt <= now + JWT_REFRESH_BUFFER_SECONDS;

  if (needsRefresh) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session ?? null;
  }

  if (!session?.access_token) {
    throw new Error("Quote session unavailable. Sign in again to continue.");
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Wraps fetch with one automatic retry on 401 — covers the edge case
 * where our token passed `expires_at` checks client-side but still
 * got rejected by the gateway (clock skew, mid-flight expiry). The
 * second attempt forces a refresh before trying again.
 *
 * Non-401 errors pass through unmodified.
 */
async function fetchWithSessionRetry(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(await getAuthHeaders()) },
  });
  if (res.status !== 401) return res;
  return fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(await getAuthHeaders(true)) },
  });
}

export async function listQuotePackages(params?: {
  status?: string;
  search?: string;
}): Promise<{ items: QuoteListItem[] }> {
  const res = await fetchWithSessionRetry(buildQuoteListUrl(params));
  if (!res.ok) {
    // Preserve the real server detail. The edge function returns a
    // structured { error: string } body on 4xx/5xx; bubble it up so the
    // sidebar can show the specific cause (auth expired vs DB error vs
    // RLS block) instead of a generic "failed" that hides the root.
    // 401 after the retry means the gateway is still rejecting — the
    // session is genuinely unrecoverable at that point and the user
    // needs to sign out / in.
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    if (res.status === 401) {
      throw new Error(
        detail
          ? `Session expired: ${detail}. Sign out and sign in again.`
          : "Session expired. Sign out and sign in again to continue.",
      );
    }
    throw new Error(detail.trim() || `Failed to list quotes (HTTP ${res.status})`);
  }
  return normalizeQuoteListResponse(await res.json().catch(() => ({})));
}

export function buildQuoteListUrl(params?: { status?: string; search?: string }): string {
  const qs = new URLSearchParams();
  if (params?.status && params.status !== "all") qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return `${QUOTE_API_URL}/list${suffix}`;
}

export function buildQuoteListActionPayload(input: {
  quotePackageId: string;
  action: Exclude<QuoteListAction, "resume" | "resend">;
}): { quote_package_id: string; action: Exclude<QuoteListAction, "resume" | "resend"> } {
  return {
    quote_package_id: input.quotePackageId,
    action: input.action,
  };
}

export function normalizeQuoteListItem(value: unknown): QuoteListItem | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0) return null;
  return {
    id: value.id,
    quote_number: nullableString(value.quote_number),
    customer_name: nullableString(value.customer_name),
    customer_company: nullableString(value.customer_company),
    contact_name: nullableString(value.contact_name),
    status: requiredString(value.status, "draft"),
    net_total: numOrNull(value.net_total),
    equipment_summary: requiredString(value.equipment_summary),
    entry_mode: nullableString(value.entry_mode),
    created_at: requiredString(value.created_at),
    updated_at: requiredString(value.updated_at),
    accepted_at: nullableString(value.accepted_at),
    win_probability_score: numOrNull(value.win_probability_score),
    is_prospect_quote: value.is_prospect_quote === true,
  };
}

export function normalizeQuoteListResponse(value: unknown): { items: QuoteListItem[] } {
  const record = recordOrEmpty(value);
  const items = Array.isArray(record.items) ? record.items : [];
  return {
    items: items.flatMap((item) => {
      const normalized = normalizeQuoteListItem(item);
      return normalized ? [normalized] : [];
    }),
  };
}

export function normalizeQuoteListActionResponse(
  value: unknown,
): { ok: true; quote?: QuoteListItem | null } {
  const record = recordOrEmpty(value);
  const quote = normalizeQuoteListItem(record.quote);
  return record.ok === true && "quote" in record
    ? { ok: true, quote }
    : { ok: true };
}

export function normalizeScorerCalibrationObservations(value: unknown): CalibrationObservation[] {
  const observations = recordOrEmpty(value).observations;
  if (!Array.isArray(observations)) return [];
  return observations.flatMap((row) => {
    if (!isRecord(row)) return [];
    const score = numOrNull(row.score);
    if (score == null || !isCalibrationOutcome(row.outcome)) return [];
    return [{ score, outcome: row.outcome }];
  });
}

export function normalizeFactorAttributionDeals(value: unknown): DealFactorObservation[] {
  const deals = recordOrEmpty(value).deals;
  if (!Array.isArray(deals)) return [];
  return deals.flatMap((row) => {
    if (!isRecord(row) || !isCalibrationOutcome(row.outcome)) return [];
    return [{ outcome: row.outcome, factors: normalizeFactorRows(row.factors) }];
  });
}

export function normalizeFactorVerdicts(value: unknown): Map<string, FactorVerdict> {
  const verdicts = recordOrEmpty(value).verdicts;
  const out = new Map<string, FactorVerdict>();
  if (!Array.isArray(verdicts)) return out;
  for (const row of verdicts) {
    if (!isRecord(row)) continue;
    const label = firstString(row.label);
    if (!label) continue;
    if (row.verdict !== "proven" && row.verdict !== "suspect" && row.verdict !== "unknown") {
      continue;
    }
    out.set(label, row.verdict);
  }
  return out;
}

export function normalizeClosedDealsAudit(value: unknown): ClosedDealAuditRow[] {
  const audits = recordOrEmpty(value).audits;
  if (!Array.isArray(audits)) return [];
  return audits.flatMap((row) => {
    if (!isRecord(row) || !isCalibrationOutcome(row.outcome)) return [];
    const packageId = firstString(row.packageId, row.package_id);
    const score = numOrNull(row.score);
    if (!packageId || score == null) return [];
    return [{
      packageId,
      score,
      outcome: row.outcome,
      factors: normalizeFactorRows(row.factors),
      capturedAt: nullableString(row.capturedAt ?? row.captured_at),
    }];
  });
}

export function normalizeQuoteRecommendation(value: unknown): QuoteRecommendation {
  const record = recordOrEmpty(value);
  const source = isRecord(record.recommendation) ? record.recommendation : record;
  const alternativeRecord = isRecord(source.alternative) ? source.alternative : null;
  const triggerRecord = isRecord(source.trigger) ? source.trigger : null;
  return {
    machine: firstString(source.machine) ?? "",
    attachments: normalizeStringArray(source.attachments),
    reasoning: firstString(source.reasoning) ?? "",
    trigger: triggerRecord
      ? {
          triggerType: triggerRecord.triggerType === "ai_chat_prompt"
            || triggerRecord.triggerType === "manual_request"
            || triggerRecord.triggerType === "quote_event"
            ? triggerRecord.triggerType
            : "voice_transcript",
          sourceField: firstString(triggerRecord.sourceField) ?? "",
          excerpt: nullableString(triggerRecord.excerpt),
          createdAt: nullableString(triggerRecord.createdAt),
        }
      : null,
    alternative: alternativeRecord
      ? {
          machine: firstString(alternativeRecord.machine) ?? "",
          attachments: normalizeStringArray(alternativeRecord.attachments),
          reasoning: firstString(alternativeRecord.reasoning) ?? "",
          whyNotChosen: nullableString(alternativeRecord.whyNotChosen),
        }
      : null,
    jobConsiderations: Array.isArray(source.jobConsiderations)
      ? normalizeStringArray(source.jobConsiderations)
      : null,
    jobFacts: Array.isArray(source.jobFacts)
      ? source.jobFacts.flatMap((fact) => {
          if (!isRecord(fact)) return [];
          const label = firstString(fact.label);
          const factValue = firstString(fact.value);
          return label && factValue ? [{ label, value: factValue }] : [];
        })
      : null,
    transcriptHighlights: Array.isArray(source.transcriptHighlights)
      ? source.transcriptHighlights.flatMap((highlight) => {
          if (!isRecord(highlight)) return [];
          const quote = firstString(highlight.quote);
          const supports = firstString(highlight.supports);
          return quote && supports ? [{ quote, supports }] : [];
        })
      : null,
  };
}

export interface SendQuotePackageResponse {
  sent: boolean;
  to_email: string;
  share_token: string | null;
  public_url: string | null;
  delivery_event_id: string | null;
}

export function normalizeSendQuotePackageResponse(value: unknown): SendQuotePackageResponse {
  const record = recordOrEmpty(value);
  return {
    sent: record.sent === true,
    to_email: firstString(record.to_email, record.toEmail) ?? "",
    share_token: nullableString(record.share_token ?? record.shareToken),
    public_url: nullableString(record.public_url ?? record.publicUrl),
    delivery_event_id: nullableString(record.delivery_event_id ?? record.deliveryEventId),
  };
}

function normalizeApprovalRouteMode(value: unknown): QuoteApprovalRouteMode {
  return value === "branch_sales_manager"
    || value === "branch_general_manager"
    || value === "owner_direct"
    || value === "admin_direct"
    || value === "admin_queue"
    || value === "owner_queue"
    || value === "manager_queue"
    ? value
    : "manager_queue";
}

function normalizeApprovalCaseStatus(value: unknown): QuoteApprovalCaseStatus {
  return value === "approved"
    || value === "approved_with_conditions"
    || value === "changes_requested"
    || value === "rejected"
    || value === "escalated"
    || value === "cancelled"
    || value === "superseded"
    || value === "expired"
    ? value
    : "pending";
}

function normalizeApprovalConditionType(value: unknown): QuoteApprovalConditionType {
  return value === "max_trade_allowance"
    || value === "required_cash_down"
    || value === "required_finance_scenario"
    || value === "remove_attachment"
    || value === "expiry_hours"
    ? value
    : "min_margin_pct";
}

function normalizeApprovalCondition(value: unknown): QuoteApprovalCondition | null {
  if (!isRecord(value)) return null;
  const id = firstString(value.id);
  if (!id) return null;
  return {
    id,
    approvalCaseId: nullableString(value.approvalCaseId ?? value.approval_case_id),
    conditionType: normalizeApprovalConditionType(value.conditionType ?? value.condition_type),
    conditionPayload: normalizeRecord(value.conditionPayload ?? value.condition_payload),
    sortOrder: numOrNull(value.sortOrder ?? value.sort_order) ?? 0,
    createdAt: nullableString(value.createdAt ?? value.created_at),
  };
}

function normalizeApprovalEvaluation(value: unknown): QuoteApprovalConditionEvaluation | null {
  if (!isRecord(value)) return null;
  const id = firstString(value.id);
  if (!id) return null;
  return {
    id,
    conditionType: normalizeApprovalConditionType(value.conditionType ?? value.condition_type),
    label: firstString(value.label) ?? "",
    satisfied: value.satisfied === true,
    detail: firstString(value.detail) ?? "",
    blocking: value.blocking === true,
  };
}

export function normalizeQuoteApprovalCaseSummary(value: unknown): QuoteApprovalCaseSummary | null {
  if (!isRecord(value)) return null;
  const id = firstString(value.id);
  const quotePackageId = firstString(value.quotePackageId, value.quote_package_id);
  const quotePackageVersionId = firstString(value.quotePackageVersionId, value.quote_package_version_id);
  if (!id || !quotePackageId || !quotePackageVersionId) return null;
  const conditions = Array.isArray(value.conditions) ? value.conditions : [];
  const evaluations = Array.isArray(value.evaluations) ? value.evaluations : [];
  return {
    id,
    quotePackageId,
    quotePackageVersionId,
    versionNumber: numOrNull(value.versionNumber ?? value.version_number),
    dealId: nullableString(value.dealId ?? value.deal_id),
    branchSlug: nullableString(value.branchSlug ?? value.branch_slug),
    branchName: nullableString(value.branchName ?? value.branch_name),
    submittedBy: nullableString(value.submittedBy ?? value.submitted_by),
    submittedByName: nullableString(value.submittedByName ?? value.submitted_by_name),
    assignedTo: nullableString(value.assignedTo ?? value.assigned_to),
    assignedToName: nullableString(value.assignedToName ?? value.assigned_to_name),
    assignedRole: nullableString(value.assignedRole ?? value.assigned_role),
    routeMode: normalizeApprovalRouteMode(value.routeMode ?? value.route_mode),
    policySnapshot: normalizeRecord(value.policySnapshot ?? value.policy_snapshot),
    reasonSummary: normalizeRecord(value.reasonSummary ?? value.reason_summary),
    status: normalizeApprovalCaseStatus(value.status),
    decisionNote: nullableString(value.decisionNote ?? value.decision_note),
    decidedBy: nullableString(value.decidedBy ?? value.decided_by),
    decidedByName: nullableString(value.decidedByName ?? value.decided_by_name),
    decidedAt: nullableString(value.decidedAt ?? value.decided_at),
    dueAt: nullableString(value.dueAt ?? value.due_at),
    escalateAt: nullableString(value.escalateAt ?? value.escalate_at),
    flowApprovalId: nullableString(value.flowApprovalId ?? value.flow_approval_id),
    conditions: conditions.flatMap((condition) => {
      const normalized = normalizeApprovalCondition(condition);
      return normalized ? [normalized] : [];
    }),
    evaluations: evaluations.flatMap((evaluation) => {
      const normalized = normalizeApprovalEvaluation(evaluation);
      return normalized ? [normalized] : [];
    }),
    canSend: value.canSend === true || value.can_send === true,
  };
}

export function normalizeQuoteApprovalSubmitResult(value: unknown): QuoteApprovalSubmitResult {
  const record = recordOrEmpty(value);
  const statusRaw = firstString(record.status);
  const status: QuoteApprovalSubmitResult["status"] = statusRaw === "approved"
    ? "approved"
    : statusRaw === "approved_with_conditions"
      ? "approved_with_conditions"
      : "pending_approval";
  const autoSendRecord = recordOrEmpty(record.auto_send ?? record.autoSend);
  return {
    approvalCaseId: firstString(record.approvalCaseId, record.approval_case_id) ?? "",
    approvalId: firstString(record.approvalId, record.approval_id) ?? "",
    quotePackageVersionId: firstString(record.quotePackageVersionId, record.quote_package_version_id) ?? "",
    versionNumber: numOrNull(record.versionNumber ?? record.version_number) ?? 0,
    status,
    branchName: nullableString(record.branchName ?? record.branch_name),
    assignedToName: nullableString(record.assignedToName ?? record.assigned_to_name),
    routeMode: normalizeApprovalRouteMode(record.routeMode ?? record.route_mode),
    alreadyPending: record.alreadyPending === true || record.already_pending === true,
    bypassRuleId: nullableString(record.bypassRuleId ?? record.bypass_rule_id),
    bypassRuleName: nullableString(record.bypassRuleName ?? record.bypass_rule_name),
    autoSend: Object.keys(autoSendRecord).length > 0
      ? {
        attempted: autoSendRecord.attempted === true,
        sent: autoSendRecord.sent === true,
        reason: nullableString(autoSendRecord.reason),
        error: nullableString(autoSendRecord.error),
      }
      : null,
  };
}

export function normalizeQuoteApprovalPolicy(value: unknown): QuoteApprovalPolicy {
  const record = recordOrEmpty(value);
  const allowedRaw = record.allowedConditionTypes ?? record.allowed_condition_types;
  const allowed = Array.isArray(allowedRaw) ? allowedRaw : [];
  return {
    workspaceId: firstString(record.workspaceId, record.workspace_id) ?? "",
    branchManagerMinMarginPct: numOrNull(record.branchManagerMinMarginPct ?? record.branch_manager_min_margin_pct) ?? 0,
    standardMarginFloorPct: numOrNull(record.standardMarginFloorPct ?? record.standard_margin_floor_pct) ?? 0,
    branchManagerMaxQuoteAmount: numOrNull(record.branchManagerMaxQuoteAmount ?? record.branch_manager_max_quote_amount) ?? 0,
    tradeCreditMax: numOrNull(record.tradeCreditMax ?? record.trade_credit_max),
    repDiscountMaxPct: numOrNull(record.repDiscountMaxPct ?? record.rep_discount_max_pct),
    submitSlaHours: numOrNull(record.submitSlaHours ?? record.submit_sla_hours) ?? 0,
    escalationSlaHours: numOrNull(record.escalationSlaHours ?? record.escalation_sla_hours) ?? 0,
    ownerEscalationRole: record.ownerEscalationRole === "admin" || record.owner_escalation_role === "admin"
      ? "admin"
      : "owner",
    authorityBand: record.authorityBand === "branch_manager" || record.authority_band === "branch_manager"
      ? "branch_manager"
      : "owner_admin",
    namedBranchSalesManagerPrimary: record.namedBranchSalesManagerPrimary === true || record.named_branch_sales_manager_primary === true,
    namedBranchGeneralManagerFallback: record.namedBranchGeneralManagerFallback === true || record.named_branch_general_manager_fallback === true,
    allowedConditionTypes: allowed.map((item) => normalizeApprovalConditionType(item)),
    updatedAt: nullableString(record.updatedAt ?? record.updated_at),
    updatedBy: nullableString(record.updatedBy ?? record.updated_by),
  };
}

function normalizePortalRevisionDraftStatus(value: unknown): PortalQuoteRevisionDraft["status"] {
  return value === "awaiting_approval"
    || value === "published"
    || value === "superseded"
    ? value
    : "draft";
}

function normalizePortalPublicationStatus(value: unknown): PortalQuoteRevisionPublishState["publicationStatus"] {
  return value === "draft_revision"
    || value === "awaiting_approval"
    || value === "published"
    ? value
    : "none";
}

export function normalizePortalQuoteRevisionCompare(value: unknown): PortalQuoteRevisionCompare | null {
  if (!isRecord(value)) return null;
  return {
    hasChanges: value.hasChanges === true || value.has_changes === true,
    priceChanges: normalizeStringArray(value.priceChanges ?? value.price_changes),
    equipmentChanges: normalizeStringArray(value.equipmentChanges ?? value.equipment_changes),
    financingChanges: normalizeStringArray(value.financingChanges ?? value.financing_changes),
    termsChanges: normalizeStringArray(value.termsChanges ?? value.terms_changes),
    dealerMessageChange: nullableString(value.dealerMessageChange ?? value.dealer_message_change),
  };
}

export function normalizePortalQuoteRevisionDraft(value: unknown): PortalQuoteRevisionDraft | null {
  if (!isRecord(value)) return null;
  const id = firstString(value.id);
  const portalQuoteReviewId = firstString(value.portalQuoteReviewId, value.portal_quote_review_id);
  const quotePackageId = firstString(value.quotePackageId, value.quote_package_id);
  const dealId = firstString(value.dealId, value.deal_id);
  if (!id || !portalQuoteReviewId || !quotePackageId || !dealId) return null;
  return {
    id,
    portalQuoteReviewId,
    quotePackageId,
    dealId,
    preparedBy: nullableString(value.preparedBy ?? value.prepared_by),
    approvedBy: nullableString(value.approvedBy ?? value.approved_by),
    status: normalizePortalRevisionDraftStatus(value.status),
    quoteData: isRecord(value.quoteData ?? value.quote_data)
      ? normalizeRecord(value.quoteData ?? value.quote_data)
      : null,
    quotePdfUrl: nullableString(value.quotePdfUrl ?? value.quote_pdf_url),
    dealerMessage: nullableString(value.dealerMessage ?? value.dealer_message),
    revisionSummary: nullableString(value.revisionSummary ?? value.revision_summary),
    customerRequestSnapshot: nullableString(value.customerRequestSnapshot ?? value.customer_request_snapshot),
    compareSnapshot: normalizePortalQuoteRevisionCompare(value.compareSnapshot ?? value.compare_snapshot),
    createdAt: firstString(value.createdAt, value.created_at) ?? "",
    updatedAt: firstString(value.updatedAt, value.updated_at) ?? "",
    publishedAt: nullableString(value.publishedAt ?? value.published_at),
  };
}

export function normalizePortalRevisionPublishState(value: unknown): PortalQuoteRevisionPublishState | null {
  if (!isRecord(value)) return null;
  const portalQuoteReviewId = firstString(value.portalQuoteReviewId, value.portal_quote_review_id);
  if (!portalQuoteReviewId) return null;
  return {
    portalQuoteReviewId,
    currentPublishedVersionNumber: numOrNull(
      value.currentPublishedVersionNumber ?? value.current_published_version_number,
    ),
    currentPublishedDealerMessage: nullableString(
      value.currentPublishedDealerMessage ?? value.current_published_dealer_message,
    ),
    currentPublishedRevisionSummary: nullableString(
      value.currentPublishedRevisionSummary ?? value.current_published_revision_summary,
    ),
    latestCustomerRequestSnapshot: nullableString(
      value.latestCustomerRequestSnapshot ?? value.latest_customer_request_snapshot,
    ),
    publicationStatus: normalizePortalPublicationStatus(value.publicationStatus ?? value.publication_status),
  };
}

export function normalizePortalRevisionEnvelope(value: unknown): PortalRevisionEnvelope {
  const record = recordOrEmpty(value);
  const reviewRecord = isRecord(record.review) ? record.review : null;
  const currentVersionRecord = isRecord(reviewRecord?.current_version) ? reviewRecord.current_version : null;
  const review = reviewRecord && firstString(reviewRecord.id)
    ? {
        id: firstString(reviewRecord.id) ?? "",
        status: firstString(reviewRecord.status) ?? "",
        counter_notes: nullableString(reviewRecord.counter_notes),
        current_version: currentVersionRecord
          ? {
              version_number: numOrNull(currentVersionRecord.version_number),
              dealer_message: nullableString(currentVersionRecord.dealer_message),
              revision_summary: nullableString(currentVersionRecord.revision_summary),
            }
          : null,
      }
    : null;
  return {
    review,
    draft: normalizePortalQuoteRevisionDraft(record.draft),
    publishState: normalizePortalRevisionPublishState(record.publishState ?? record.publish_state),
  };
}

export function normalizePortalRevisionMutationResponse(value: unknown): {
  draft: PortalQuoteRevisionDraft;
  publishState: PortalQuoteRevisionPublishState;
} {
  const record = recordOrEmpty(value);
  const draft = normalizePortalQuoteRevisionDraft(record.draft);
  const publishState = normalizePortalRevisionPublishState(record.publishState ?? record.publish_state);
  if (!draft || !publishState) {
    throw new Error("Portal revision response was malformed.");
  }
  return { draft, publishState };
}

export function normalizePortalRevisionPublishResponse(value: unknown): {
  draft: PortalQuoteRevisionDraft | null;
  publishState: PortalQuoteRevisionPublishState;
} {
  const record = recordOrEmpty(value);
  const draft = normalizePortalQuoteRevisionDraft(record.draft);
  const publishState = normalizePortalRevisionPublishState(record.publishState ?? record.publish_state);
  if (!publishState) {
    throw new Error("Portal revision publish response was malformed.");
  }
  return { draft, publishState };
}

export function normalizeQuoteSignatureResponse(value: unknown): Record<string, unknown> {
  return normalizeRecord(value);
}

export async function performQuoteListAction(input: {
  quotePackageId: string;
  action: Exclude<QuoteListAction, "resume" | "resend">;
}): Promise<{ ok: true; quote?: QuoteListItem | null }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/list-action`, {
    method: "POST",
    body: JSON.stringify(buildQuoteListActionPayload(input)),
  });
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    throw new Error(detail.trim() || `Quote action failed (HTTP ${res.status})`);
  }
  return normalizeQuoteListActionResponse(await res.json().catch(() => ({})));
}

/**
 * Slice 20f — fetch the raw (score, outcome) observations the edge
 * function joined from quote_packages × qb_quote_outcomes. The pure
 * calibration math is done client-side by `computeCalibrationReport`
 * so the report can be re-derived without another round trip if the
 * component needs to re-render with different filters later.
 *
 * 403 means the user isn't manager/owner — callers should render the
 * card as hidden rather than an error. We surface the role-gated error
 * as a distinct typed return so the component doesn't have to parse
 * the message.
 */
export async function getScorerCalibrationObservations(): Promise<
  | { ok: true; observations: Array<{ score: number; outcome: "won" | "lost" | "expired" }> }
  | { ok: false; reason: "forbidden" | "error"; message: string }
> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/scorer-calibration`);
  if (res.status === 403) {
    return { ok: false, reason: "forbidden", message: "Requires manager or owner role" };
  }
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body) || `HTTP ${res.status}`;
    return { ok: false, reason: "error", message: detail };
  }
  return { ok: true, observations: normalizeScorerCalibrationObservations(await res.json().catch(() => ({}))) };
}

/**
 * Slice 20g — fetch deal-grouped factor observations for attribution
 * analysis. Same discriminated-union shape as the calibration helper
 * so the card can render a distinct empty / forbidden / error state.
 *
 * The edge function does the version-gate filter + malformed-row
 * filter; this helper just shuttles the list.
 */
export async function getFactorAttributionDeals(): Promise<
  | { ok: true; deals: Array<{ factors: Array<{ label: string; weight: number }>; outcome: "won" | "lost" | "expired" }> }
  | { ok: false; reason: "forbidden" | "error"; message: string }
> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/factor-attribution`);
  if (res.status === 403) {
    return { ok: false, reason: "forbidden", message: "Requires manager or owner role" };
  }
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body) || `HTTP ${res.status}`;
    return { ok: false, reason: "error", message: detail };
  }
  return { ok: true, deals: normalizeFactorAttributionDeals(await res.json().catch(() => ({}))) };
}

/**
 * Slice 20i — fetch label → verdict map for the live WinProbabilityStrip.
 * Rep-accessible endpoint — no role gate. Returns only the ternary
 * verdict per factor label ("proven" | "suspect" | "unknown"), never
 * the underlying win rates or counts.
 *
 * On error we return an empty map rather than a discriminated union —
 * the live strip must not be blocked by an instrumentation failure,
 * and reps don't need to see an error message for a nice-to-have
 * badge. Silent-fail is the right call here; a bug would be visible
 * via the list page's factor breakdown card instead.
 */
export async function getFactorVerdicts(): Promise<
  Map<string, "proven" | "suspect" | "unknown">
> {
  try {
    const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/factor-verdicts`);
    if (!res.ok) return new Map();
    return normalizeFactorVerdicts(await res.json().catch(() => ({})));
  } catch {
    return new Map();
  }
}

/**
 * Slice 20h — fetch closed-deal audit rows. Discriminated union so the
 * card can distinguish forbidden (hide) / error (warn) / empty (hint)
 * states without string-parsing the message.
 *
 * The edge function version-gates on weightsVersion="v1" and filters
 * malformed rows; this helper just shuttles the list.
 */
export async function getClosedDealsAudit(): Promise<
  | {
      ok: true;
      audits: Array<{
        packageId: string;
        score: number;
        outcome: "won" | "lost" | "expired";
        factors: Array<{ label: string; weight: number }>;
        capturedAt: string | null;
      }>;
    }
  | { ok: false; reason: "forbidden" | "error"; message: string }
> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/closed-deals-audit`);
  if (res.status === 403) {
    return { ok: false, reason: "forbidden", message: "Requires manager or owner role" };
  }
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body) || `HTTP ${res.status}`;
    return { ok: false, reason: "error", message: detail };
  }
  return { ok: true, audits: normalizeClosedDealsAudit(await res.json().catch(() => ({}))) };
}

export async function getCompetitorListings(make: string, model?: string): Promise<{ listings: CompetitorListing[] }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/competitors`, {
    method: "POST",
    body: JSON.stringify({ make, model }),
  });
  if (!res.ok) return { listings: [] };
  return res.json();
}

export async function getSavedQuotePackage(params: {
  dealId?: string;
  packageId?: string;
}): Promise<{ quote: Record<string, unknown> | null }> {
  const qs = new URLSearchParams();
  if (params.packageId) qs.set("package_id", params.packageId);
  if (params.dealId) qs.set("deal_id", params.dealId);
  const suffix = qs.toString();

  if (!suffix) {
    throw new Error("dealId or packageId is required to load a saved quote.");
  }

  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}?${suffix}`);
  if (!res.ok) throw new Error("Failed to load quote");
  return res.json();
}

export async function getAiEquipmentRecommendation(jobDescription: string): Promise<QuoteRecommendation> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/recommend`, {
    method: "POST",
    body: JSON.stringify({ job_description: jobDescription }),
  });
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    if (res.status === 401) {
      throw new Error(
        detail
          ? `Session expired: ${detail}. Sign out and sign in again.`
          : "Session expired. Sign out and sign in again to continue.",
      );
    }
    throw new Error(detail.trim() || `AI recommendation failed (HTTP ${res.status})`);
  }
  return normalizeQuoteRecommendation(await res.json().catch(() => ({})));
}

export interface QuoteAvailabilityCandidate {
  id: string;
  requestId: string | null;
  candidateType: string;
  catalogModelId: string | null;
  equipmentId: string | null;
  score: number;
  availabilityStatus: string;
  etaDays: number | null;
  estimatedCost: number | null;
  estimatedMargin: number | null;
  reason: string | null;
  selectedAt: string | null;
  selectedBy: string | null;
  sourceRef: string | null;
  sourceConfidence: string | null;
  customerSafeLabel: string | null;
  internalNote: string | null;
  metadata: Record<string, unknown>;
  model: Record<string, unknown> | null;
  equipment: Record<string, unknown> | null;
  createdAt: string | null;
}

export interface QuoteAvailabilityEvent {
  id: string;
  requestId: string | null;
  actorId: string | null;
  actorName: string | null;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

export interface QuoteAvailabilityRequest {
  id: string;
  quotePackageId: string | null;
  quoteLineItemId: string | null;
  catalogModelId: string | null;
  clientLineKey: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  status: string;
  urgency: string;
  customerNeed: string | null;
  requestedMachineLabel: string;
  requestedBudget: number | null;
  requestedTimeline: string | null;
  availabilityEta: string | null;
  decisionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  priorityScore: number;
  slaDueAt: string | null;
  lastActivityAt: string | null;
  managerOverrideBy: string | null;
  managerOverrideAt: string | null;
  managerOverrideReason: string | null;
  repVisibilityNote: string | null;
  customerSafeSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  quote: Record<string, unknown> | null;
  candidates: QuoteAvailabilityCandidate[];
  events: QuoteAvailabilityEvent[];
}

export interface QuoteAvailabilityRequestInput {
  quotePackageId?: string | null;
  availabilityRequestId?: string | null;
  clientLineKey: string;
  sourceCatalog?: string | null;
  sourceId?: string | null;
  catalogModelId?: string | null;
  requestedMachineLabel: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  customerNeed?: string | null;
  requestedBudget?: number | null;
  requestedTimeline?: string | null;
  urgency?: "low" | "normal" | "rush" | "customer_waiting";
  allowAlternatives?: boolean;
}

export interface QuoteAvailabilityQueueFilters {
  status?: string;
  assignedTo?: string;
  search?: string;
  overdue?: boolean;
}

export interface QuoteAvailabilitySummary {
  openCount: number;
  overdueCount: number;
  blockedQuoteValue: number;
  byStatus: Record<string, number>;
}

export interface QuoteAvailabilityResponseInput {
  requestId: string;
  status: string;
  note?: string | null;
  selectedCandidateId?: string | null;
  availabilityEta?: string | null;
  repVisibilityNote?: string | null;
  customerSafeSummary?: string | null;
}

function normalizeAvailabilityEvent(value: unknown): QuoteAvailabilityEvent | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    requestId: nullableString(value.request_id ?? value.requestId),
    actorId: nullableString(value.actor_id ?? value.actorId),
    actorName: nullableString(value.actor_name ?? value.actorName),
    eventType: requiredString(value.event_type ?? value.eventType, "event"),
    fromStatus: nullableString(value.from_status ?? value.fromStatus),
    toStatus: nullableString(value.to_status ?? value.toStatus),
    note: nullableString(value.note),
    metadata: normalizeRecord(value.metadata),
    createdAt: nullableString(value.created_at ?? value.createdAt),
  };
}

function normalizeAvailabilityCandidate(value: unknown): QuoteAvailabilityCandidate | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    requestId: nullableString(value.request_id ?? value.requestId),
    candidateType: requiredString(value.candidate_type ?? value.candidateType, "unknown"),
    catalogModelId: nullableString(value.catalog_model_id ?? value.catalogModelId),
    equipmentId: nullableString(value.equipment_id ?? value.equipmentId),
    score: numOrNull(value.score) ?? 0,
    availabilityStatus: requiredString(value.availability_status ?? value.availabilityStatus, "unknown"),
    etaDays: numOrNull(value.eta_days ?? value.etaDays),
    estimatedCost: numOrNull(value.estimated_cost ?? value.estimatedCost),
    estimatedMargin: numOrNull(value.estimated_margin ?? value.estimatedMargin),
    reason: nullableString(value.reason),
    selectedAt: nullableString(value.selected_at ?? value.selectedAt),
    selectedBy: nullableString(value.selected_by ?? value.selectedBy),
    sourceRef: nullableString(value.source_ref ?? value.sourceRef),
    sourceConfidence: nullableString(value.source_confidence ?? value.sourceConfidence),
    customerSafeLabel: nullableString(value.customer_safe_label ?? value.customerSafeLabel),
    internalNote: nullableString(value.internal_note ?? value.internalNote),
    metadata: normalizeRecord(value.metadata),
    model: isRecord(value.model) ? value.model : null,
    equipment: isRecord(value.equipment) ? value.equipment : null,
    createdAt: nullableString(value.created_at ?? value.createdAt),
  };
}

export function normalizeAvailabilityRequest(value: unknown): QuoteAvailabilityRequest | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  const events = Array.isArray(value.events) ? value.events : [];
  return {
    id: value.id,
    quotePackageId: nullableString(value.quote_package_id ?? value.quotePackageId),
    quoteLineItemId: nullableString(value.quote_line_item_id ?? value.quoteLineItemId),
    catalogModelId: nullableString(value.catalog_model_id ?? value.catalogModelId),
    clientLineKey: nullableString(value.client_line_key ?? value.clientLineKey),
    requestedBy: nullableString(value.requested_by ?? value.requestedBy),
    requestedByName: nullableString(value.requested_by_name ?? value.requestedByName),
    assignedTo: nullableString(value.assigned_to ?? value.assignedTo),
    assignedToName: nullableString(value.assigned_to_name ?? value.assignedToName),
    status: requiredString(value.status, "pending"),
    urgency: requiredString(value.urgency, "normal"),
    customerNeed: nullableString(value.customer_need ?? value.customerNeed),
    requestedMachineLabel: requiredString(value.requested_machine_label ?? value.requestedMachineLabel, "Equipment"),
    requestedBudget: numOrNull(value.requested_budget ?? value.requestedBudget),
    requestedTimeline: nullableString(value.requested_timeline ?? value.requestedTimeline),
    availabilityEta: nullableString(value.availability_eta ?? value.availabilityEta),
    decisionNote: nullableString(value.decision_note ?? value.decisionNote),
    resolvedBy: nullableString(value.resolved_by ?? value.resolvedBy),
    resolvedAt: nullableString(value.resolved_at ?? value.resolvedAt),
    priorityScore: numOrNull(value.priority_score ?? value.priorityScore) ?? 0,
    slaDueAt: nullableString(value.sla_due_at ?? value.slaDueAt),
    lastActivityAt: nullableString(value.last_activity_at ?? value.lastActivityAt),
    managerOverrideBy: nullableString(value.manager_override_by ?? value.managerOverrideBy),
    managerOverrideAt: nullableString(value.manager_override_at ?? value.managerOverrideAt),
    managerOverrideReason: nullableString(value.manager_override_reason ?? value.managerOverrideReason),
    repVisibilityNote: nullableString(value.rep_visibility_note ?? value.repVisibilityNote),
    customerSafeSummary: nullableString(value.customer_safe_summary ?? value.customerSafeSummary),
    metadata: normalizeRecord(value.metadata),
    createdAt: nullableString(value.created_at ?? value.createdAt),
    updatedAt: nullableString(value.updated_at ?? value.updatedAt),
    quote: isRecord(value.quote) ? value.quote : null,
    candidates: candidates.flatMap((candidate) => {
      const normalized = normalizeAvailabilityCandidate(candidate);
      return normalized ? [normalized] : [];
    }),
    events: events.flatMap((event) => {
      const normalized = normalizeAvailabilityEvent(event);
      return normalized ? [normalized] : [];
    }),
  };
}

export async function requestQuoteAvailability(input: QuoteAvailabilityRequestInput): Promise<QuoteAvailabilityRequest> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/availability/request`, {
    method: "POST",
    body: JSON.stringify({
      quote_package_id: input.quotePackageId ?? null,
      availability_request_id: input.availabilityRequestId ?? null,
      client_line_key: input.clientLineKey,
      source_catalog: input.sourceCatalog ?? null,
      source_id: input.sourceId ?? null,
      catalog_model_id: input.catalogModelId ?? null,
      requested_machine_label: input.requestedMachineLabel,
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      customer_need: input.customerNeed ?? null,
      requested_budget: input.requestedBudget ?? null,
      requested_timeline: input.requestedTimeline ?? null,
      urgency: input.urgency ?? "normal",
      allow_alternatives: input.allowAlternatives ?? true,
    }),
  });
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    throw new Error(detail.trim() || `Availability request failed (HTTP ${res.status})`);
  }
  const body = await readJsonRecord(res);
  const request = normalizeAvailabilityRequest(body.request);
  if (!request) throw new Error("Availability request response was malformed.");
  return request;
}

export async function listQuoteAvailabilityRequests(quotePackageId: string): Promise<QuoteAvailabilityRequest[]> {
  const qs = new URLSearchParams({ quote_package_id: quotePackageId });
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/availability?${qs.toString()}`);
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    throw new Error(detail.trim() || `Failed to load availability requests (HTTP ${res.status})`);
  }
  const body = await readJsonRecord(res);
  const source = Array.isArray(body.requests) ? body.requests : [];
  return source.flatMap((item) => {
    const request = normalizeAvailabilityRequest(item);
    return request ? [request] : [];
  });
}

export async function listQuoteAvailabilityQueue(filters: QuoteAvailabilityQueueFilters = {}): Promise<QuoteAvailabilityRequest[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.assignedTo) qs.set("assigned_to", filters.assignedTo);
  if (filters.search) qs.set("search", filters.search);
  if (filters.overdue) qs.set("overdue", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/availability/queue${suffix}`);
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    throw new Error(detail.trim() || `Failed to load availability queue (HTTP ${res.status})`);
  }
  const body = await readJsonRecord(res);
  const source = Array.isArray(body.requests) ? body.requests : [];
  return source.flatMap((item) => {
    const request = normalizeAvailabilityRequest(item);
    return request ? [request] : [];
  });
}

export async function getQuoteAvailabilitySummary(): Promise<QuoteAvailabilitySummary> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/availability/summary`);
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    throw new Error(detail.trim() || `Failed to load availability summary (HTTP ${res.status})`);
  }
  const body = await readJsonRecord(res);
  return {
    openCount: numOrNull(body.open_count ?? body.openCount) ?? 0,
    overdueCount: numOrNull(body.overdue_count ?? body.overdueCount) ?? 0,
    blockedQuoteValue: numOrNull(body.blocked_quote_value ?? body.blockedQuoteValue) ?? 0,
    byStatus: normalizeRecord(body.by_status ?? body.byStatus) as Record<string, number>,
  };
}

async function mutateQuoteAvailability(path: string, payload: Record<string, unknown>): Promise<QuoteAvailabilityRequest> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/availability/${path}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    throw new Error(detail.trim() || `Availability ${path} failed (HTTP ${res.status})`);
  }
  const body = await readJsonRecord(res);
  const request = normalizeAvailabilityRequest(body.request);
  if (!request) throw new Error("Availability mutation response was malformed.");
  return request;
}

export function assignQuoteAvailabilityRequest(requestId: string, assignedTo: string | null = "me"): Promise<QuoteAvailabilityRequest> {
  return mutateQuoteAvailability("assign", { request_id: requestId, assigned_to: assignedTo });
}

export function respondToQuoteAvailabilityRequest(input: QuoteAvailabilityResponseInput): Promise<QuoteAvailabilityRequest> {
  return mutateQuoteAvailability("respond", {
    request_id: input.requestId,
    status: input.status,
    note: input.note ?? null,
    selected_candidate_id: input.selectedCandidateId ?? null,
    availability_eta: input.availabilityEta ?? null,
    rep_visibility_note: input.repVisibilityNote ?? null,
    customer_safe_summary: input.customerSafeSummary ?? null,
  });
}

export function overrideQuoteAvailabilityRequest(input: { requestId: string; reason: string }): Promise<QuoteAvailabilityRequest> {
  return mutateQuoteAvailability("override", { request_id: input.requestId, reason: input.reason });
}

export function cancelQuoteAvailabilityRequest(input: { requestId: string; note?: string | null }): Promise<QuoteAvailabilityRequest> {
  return mutateQuoteAvailability("cancel", { request_id: input.requestId, note: input.note ?? null });
}

export function addQuoteAvailabilityCandidate(input: {
  requestId: string;
  candidateType?: string;
  reason: string;
  availabilityStatus?: string;
  etaDays?: number | null;
  estimatedCost?: number | null;
  sourceRef?: string | null;
  sourceConfidence?: string | null;
  customerSafeLabel?: string | null;
  internalNote?: string | null;
}): Promise<QuoteAvailabilityRequest> {
  return mutateQuoteAvailability("candidate", {
    request_id: input.requestId,
    candidate_type: input.candidateType ?? "vendor_order",
    reason: input.reason,
    availability_status: input.availabilityStatus ?? "source_required",
    eta_days: input.etaDays ?? null,
    estimated_cost: input.estimatedCost ?? null,
    source_ref: input.sourceRef ?? null,
    source_confidence: input.sourceConfidence ?? null,
    customer_safe_label: input.customerSafeLabel ?? null,
    internal_note: input.internalNote ?? null,
  });
}

export interface QuoteFinancingRequest {
  packageSubtotal: number;
  discountTotal: number;
  tradeAllowance: number;
  taxTotal: number;
  cashDown: number;
  amountFinanced: number;
  marginPct?: number;
  manufacturer?: string;
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const text = firstString(item);
    if (!text || seen.has(text)) return [];
    seen.add(text);
    return [text];
  });
}

function normalizeEquipmentAvailability(value: unknown): "in_stock" | "in_transit" | "source_required" {
  const text = firstString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (["available", "in_stock", "ready", "on_hand"].includes(text)) return "in_stock";
  if (["in_transit", "transit", "on_order", "ordered"].includes(text)) return "in_transit";
  return "source_required";
}

/** True if any of the keys is boolean true, 1, or common truthy strings (matches edge `boolMetadata`). */
function metadataBooleanTrue(metadata: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = metadata[key];
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    }
  }
  return false;
}

export interface CrmEquipmentQuoteSeed {
  id: string;
  sourceCatalog: "catalog_entries";
  sourceId: string;
  dealerCost: number | null;
  make: string;
  model: string;
  year: number | null;
  list_price: number | null;
  stock_number: string | null;
  serial_number: string | null;
  condition: string | null;
  warranty_text: string | null;
  long_description: string | null;
  spec_bullets: string[];
  photo_url: string | null;
  photo_urls: string[];
  vendor_logo_url: string | null;
  media_source: "crm_equipment";
  media_source_id: string;
  media_kind: "actual";
  availabilityStatus: "in_stock" | "in_transit" | "source_required";
  /** ISO timestamp: physical yard / stock receipt — used by approval bypass rules (e.g. min stock age). */
  received_at: string | null;
  /** Hot-list / priority merchandising flag from CRM — forwarded to line metadata for `requires_hot_list` bypass rules. */
  hot_list: boolean;
  attachments: Array<{ id: string; name: string; price: number }>;
}

export function normalizeCrmEquipmentQuoteSeed(row: unknown): CrmEquipmentQuoteSeed | null {
  if (!isRecord(row)) return null;
  const id = firstString(row.id);
  if (!id) return null;
  const metadata = normalizeRecord(row.metadata);
  const make = firstString(row.make, metadata.make);
  const model = firstString(row.model, metadata.model, row.name, metadata.name);
  if (!make && !model) return null;
  const photos = stringArray(row.photo_urls);
  const year = numOrNull(row.year ?? metadata.year);
  const hours = numOrNull(row.engine_hours ?? metadata.engine_hours ?? metadata.hours);
  const specBullets = [
    hours != null ? `${hours.toLocaleString("en-US")} hours` : null,
    firstString(metadata.horsepower, metadata.hp) ? `${firstString(metadata.horsepower, metadata.hp)} HP` : null,
    firstString(row.fuel_type, metadata.fuel_type) ? `Fuel type: ${firstString(row.fuel_type, metadata.fuel_type)}` : null,
    firstString(row.weight_class, metadata.weight_class) ? `Weight class: ${firstString(row.weight_class, metadata.weight_class)}` : null,
    firstString(row.operating_capacity, metadata.operating_capacity) ? `Operating capacity: ${firstString(row.operating_capacity, metadata.operating_capacity)}` : null,
    firstString(metadata.operating_weight) ? `Operating weight: ${firstString(metadata.operating_weight)}` : null,
    firstString(metadata.lift_capacity) ? `Lift capacity: ${firstString(metadata.lift_capacity)}` : null,
  ].flatMap((item) => item ? [item] : []);
  const warrantyExpiresOn = firstString(row.warranty_expires_on, metadata.warranty_expires_on);
  const receivedAt = firstString(
    metadata.received_at,
    metadata.date_received_to_yard,
    metadata.physical_received_at,
    metadata.received_in_stock_at,
    metadata.yard_received_at,
  );
  const hotList = metadataBooleanTrue(metadata, ["hot_list", "on_hot_list", "hotList"]);
  return {
    id,
    sourceCatalog: "catalog_entries",
    sourceId: id,
    dealerCost: null,
    make: make ?? "",
    model: model ?? "",
    year,
    list_price: numOrNull(row.replacement_cost ?? row.current_market_value ?? row.purchase_price),
    stock_number: firstString(row.stock_number, row.asset_tag, metadata.stock_number, metadata.asset_tag),
    serial_number: firstString(row.serial_number, metadata.serial_number, metadata.vin, metadata.pin),
    condition: firstString(row.condition, metadata.condition),
    warranty_text: warrantyExpiresOn ? `Warranty through ${warrantyExpiresOn}` : firstString(metadata.warranty_text),
    long_description: firstString(row.notes, metadata.description, row.name),
    spec_bullets: specBullets.slice(0, 8),
    photo_url: photos[0] ?? null,
    photo_urls: photos,
    vendor_logo_url: firstString(metadata.vendor_logo_url),
    media_source: "crm_equipment",
    media_source_id: id,
    media_kind: "actual",
    availabilityStatus: normalizeEquipmentAvailability(row.availability ?? metadata.availability),
    received_at: receivedAt,
    hot_list: hotList,
    attachments: [],
  };
}

function normalizeQuoteScenarioType(value: unknown): QuoteFinanceScenario["type"] {
  return value === "lease" ? "lease" : value === "finance" ? "finance" : "cash";
}

function normalizeQuoteScenarioKind(value: unknown): QuoteFinanceScenario["kind"] {
  return value === "lease_fmv" || value === "lease_fppo" || value === "finance" || value === "cash"
    ? value
    : undefined;
}

export function normalizeQuoteFinanceScenario(raw: Record<string, unknown>): QuoteFinanceScenario {
  const kind = normalizeQuoteScenarioKind(raw.kind);
  const type = raw.type == null && kind
    ? kind === "finance"
      ? "finance"
      : kind === "lease_fmv" || kind === "lease_fppo"
        ? "lease"
        : "cash"
    : normalizeQuoteScenarioType(firstString(raw.type, "cash"));
  const termMonths = numOrNull(raw.termMonths ?? raw.term_months);
  const rate = numOrNull(raw.rate ?? raw.apr);
  const monthlyPayment = numOrNull(raw.monthlyPayment ?? raw.monthly_payment);
  const totalCost = numOrNull(raw.totalCost ?? raw.total_cost);
  const lender = firstString(raw.lender) ?? null;
  const label = firstString(
    raw.label,
    type === "cash"
      ? "Cash"
      : termMonths != null
        ? `${type === "lease" ? "Lease" : "Finance"} ${termMonths} mo`
        : type === "lease"
          ? "Lease"
          : "Finance",
  ) ?? "Scenario";

  return {
    type: type === "lease" ? "lease" : type === "finance" ? "finance" : "cash",
    kind,
    label,
    monthlyPayment,
    apr: rate,
    termMonths,
    totalCost,
    rate,
    lender,
    downPayment: numOrNull(raw.downPayment ?? raw.down_payment),
    residualAmount: numOrNull(raw.residualAmount ?? raw.residual_amount),
    moneyFactor: numOrNull(raw.moneyFactor ?? raw.money_factor),
    isDefault: raw.isDefault === true || raw.is_default === true,
  };
}

export function normalizeQuoteFinancingPreview(raw: Record<string, unknown> | null | undefined): QuoteFinancingPreview {
  const scenariosRaw = Array.isArray(raw?.scenarios) ? raw.scenarios : [];
  const incentivesRecord = normalizeRecord(raw?.incentives);
  const marginCheckRecord = normalizeRecord(raw?.margin_check);
  const applicableRaw = Array.isArray(incentivesRecord.applicable) ? incentivesRecord.applicable : [];
  return {
    scenarios: scenariosRaw
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map((row) => normalizeQuoteFinanceScenario(row)),
    margin_check: isRecord(raw?.margin_check)
      ? {
          flagged: Boolean(marginCheckRecord.flagged),
          message: firstString(marginCheckRecord.message) ?? undefined,
        }
      : null,
    amountFinanced: numOrNull(raw?.amountFinanced ?? raw?.amount_financed),
    taxTotal: numOrNull(raw?.taxTotal ?? raw?.tax_total),
    customerTotal: numOrNull(raw?.customerTotal ?? raw?.customer_total),
    discountTotal: numOrNull(raw?.discountTotal ?? raw?.discount_total),
    incentives: raw?.incentives && typeof raw.incentives === "object"
      ? {
          applicable: applicableRaw
            .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
            .map((row) => ({
              id: firstString(row.id) ?? crypto.randomUUID(),
              name: firstString(row.name, row.incentive_name) ?? "Incentive",
              oem_name: firstString(row.oem_name, row.manufacturer) ?? undefined,
              discount_type: firstString(row.discount_type) ?? "flat",
              discount_value: numOrNull(row.discount_value) ?? 0,
              estimated_savings: numOrNull(row.estimated_savings) ?? 0,
              end_date: firstString(row.end_date) ?? undefined,
            })),
          total_savings: numOrNull(incentivesRecord.total_savings) ?? 0,
        }
      : null,
  };
}

export async function calculateFinancing(
  input: QuoteFinancingRequest,
): Promise<QuoteFinancingPreview> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/calculate`, {
    method: "POST",
    body: JSON.stringify({
      package_subtotal: input.packageSubtotal,
      discount_total: input.discountTotal,
      trade_allowance: input.tradeAllowance,
      tax_total: input.taxTotal,
      cash_down: input.cashDown,
      amount_financed: input.amountFinanced,
      margin_pct: input.marginPct,
      manufacturer: input.manufacturer,
    }),
  });
  if (!res.ok) throw new Error("Financing calculation failed");
  const body = await res.json();
  return normalizeQuoteFinancingPreview(body);
}

export async function saveQuotePackage(data: Record<string, unknown>): Promise<QuotePackageSaveResponse> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/save`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await readJsonRecord(res);
    const detail = errorDetail(body);
    throw new Error(detail.trim() || `Failed to save quote (HTTP ${res.status})`);
  }
  return res.json();
}

export async function sendQuotePackage(quotePackageId: string, options?: { documentArtifactId?: string | null; followUpAt?: string | null }): Promise<SendQuotePackageResponse> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/send-package`, {
    method: "POST",
    body: JSON.stringify({
      quote_package_id: quotePackageId,
      document_artifact_id: options?.documentArtifactId ?? null,
      follow_up_at: options?.followUpAt ?? null,
    }),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to send quote");
  }
  return normalizeSendQuotePackageResponse(await res.json().catch(() => ({})));
}

export type QuoteDeliveryEventChannel = "preview" | "email" | "text" | "link" | "print";
export type QuoteDeliveryEventStatus = "draft" | "attempted" | "sent" | "failed";

export interface QuoteDocumentArtifactInput {
  quotePackageId: string;
  quotePackageVersionId?: string | null;
  blob: Blob;
  filename: string;
  generatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface QuoteDocumentArtifactResult {
  id: string;
  storageBucket: string;
  storageKey: string;
}

function safeDocumentPathSegment(value: string, fallback: string): string {
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || fallback;
}

export async function persistQuoteDocumentArtifact(input: QuoteDocumentArtifactInput): Promise<QuoteDocumentArtifactResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user?.id) {
    throw new Error(userError?.message || "Sign in again before generating a stored quote document.");
  }

  const storageBucket = "documents";
  const generatedDate = input.generatedAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const filename = safeDocumentPathSegment(input.filename, "quote-proposal.pdf");
  const packageId = safeDocumentPathSegment(input.quotePackageId, "quote");
  const storageKey = [
    userData.user.id,
    "quote-documents",
    packageId,
    `${generatedDate}-${Date.now()}-${filename}`,
  ].join("/");

  const { error: uploadError } = await supabase.storage
    .from(storageBucket)
    .upload(storageKey, input.blob, {
      contentType: input.blob.type || "application/pdf",
      upsert: false,
    });
  if (uploadError) {
    throw new Error(uploadError.message || "Failed to upload quote document artifact.");
  }

  const { data, error } = await supabase
    .from("quote_document_artifacts")
    .insert({
      quote_package_id: input.quotePackageId,
      quote_package_version_id: input.quotePackageVersionId ?? null,
      artifact_type: "customer_quote_pdf",
      storage_bucket: storageBucket,
      storage_key: storageKey,
      status: "generated",
      generated_at: input.generatedAt,
      generated_by: userData.user.id,
      metadata: {
        filename,
        content_type: input.blob.type || "application/pdf",
        size_bytes: input.blob.size,
        ...(input.metadata ?? {}),
      },
    })
    .select("id, storage_bucket, storage_key")
    .maybeSingle();
  if (error || !data?.id) {
    await supabase.storage.from(storageBucket).remove([storageKey]).catch(() => {
      // The artifact row is the source of truth; a failed cleanup should not hide the real insert error.
    });
    throw new Error(error?.message || "Failed to register quote document artifact.");
  }

  return {
    id: String(data.id),
    storageBucket: String(data.storage_bucket || storageBucket),
    storageKey: String(data.storage_key || storageKey),
  };
}

export interface QuoteDeliveryEventInput {
  quotePackageId: string;
  documentArtifactId?: string | null;
  channel: QuoteDeliveryEventChannel;
  status: QuoteDeliveryEventStatus;
  recipient?: string | null;
  subject?: string | null;
  messageBody?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  followUpAt?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logQuoteDeliveryEvent(input: QuoteDeliveryEventInput): Promise<{ id: string | null }> {
  const row = {
    quote_package_id: input.quotePackageId,
    document_artifact_id: input.documentArtifactId ?? null,
    channel: input.channel,
    status: input.status,
    recipient: input.recipient ?? null,
    subject: input.subject ?? null,
    message_body: input.messageBody ?? null,
    provider: input.provider ?? null,
    provider_message_id: input.providerMessageId ?? null,
    error_message: input.errorMessage ?? null,
    follow_up_at: input.followUpAt ?? null,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase
    .from("quote_delivery_events")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(error.message || "Failed to log quote delivery event");
  }
  return { id: typeof data?.id === "string" ? data.id : null };
}

export async function submitQuoteForApproval(quotePackageId: string): Promise<QuoteApprovalSubmitResult> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/submit-approval`, {
    method: "POST",
    body: JSON.stringify({ quote_package_id: quotePackageId }),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to submit quote for approval");
  }
  return normalizeQuoteApprovalSubmitResult(await res.json().catch(() => ({})));
}

export async function getQuoteApprovalCase(quotePackageId: string): Promise<QuoteApprovalCaseSummary | null> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/approval-case?quote_package_id=${encodeURIComponent(quotePackageId)}`);
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to load quote approval case");
  }
  const body = await readJsonRecord(res);
  return normalizeQuoteApprovalCaseSummary(body.approval_case);
}

export async function decideQuoteApprovalCase(input: {
  approvalCaseId: string;
  decision: QuoteApprovalDecision;
  note?: string | null;
  conditions?: QuoteApprovalConditionDraft[];
}): Promise<QuoteApprovalDecisionResult> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/decide-approval-case`, {
    method: "POST",
    body: JSON.stringify({
      approval_case_id: input.approvalCaseId,
      decision: input.decision,
      note: input.note ?? null,
      conditions: input.conditions ?? [],
    }),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to decide quote approval case");
  }
  const body = await readJsonRecord(res);
  const autoSendRecord = recordOrEmpty(body.auto_send ?? body.autoSend);
  return {
    approvalCase: normalizeQuoteApprovalCaseSummary(body.approval_case),
    autoSend: Object.keys(autoSendRecord).length > 0
      ? {
        attempted: autoSendRecord.attempted === true,
        sent: autoSendRecord.sent === true,
        reason: nullableString(autoSendRecord.reason),
        error: nullableString(autoSendRecord.error),
      }
      : null,
  };
}

export async function getQuoteApprovalPolicy(): Promise<QuoteApprovalPolicy> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/approval-policy`);
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to load quote approval policy");
  }
  const body = await readJsonRecord(res);
  return normalizeQuoteApprovalPolicy(body.policy);
}

export async function saveQuoteApprovalPolicy(policy: Partial<QuoteApprovalPolicy>): Promise<QuoteApprovalPolicy> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/approval-policy`, {
    method: "POST",
    body: JSON.stringify({
      branch_manager_min_margin_pct: policy.branchManagerMinMarginPct,
      standard_margin_floor_pct: policy.standardMarginFloorPct,
      branch_manager_max_quote_amount: policy.branchManagerMaxQuoteAmount,
      trade_credit_max: policy.tradeCreditMax,
      rep_discount_max_pct: policy.repDiscountMaxPct,
      submit_sla_hours: policy.submitSlaHours,
      escalation_sla_hours: policy.escalationSlaHours,
      owner_escalation_role: policy.ownerEscalationRole,
      authority_band: policy.authorityBand,
      named_branch_sales_manager_primary: policy.namedBranchSalesManagerPrimary,
      named_branch_general_manager_fallback: policy.namedBranchGeneralManagerFallback,
      allowed_condition_types: policy.allowedConditionTypes,
    }),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to save quote approval policy");
  }
  const body = await readJsonRecord(res);
  return normalizeQuoteApprovalPolicy(body.policy);
}

export async function saveQuoteSignature(data: {
  quote_package_id: string;
  deal_id?: string;
  signer_name: string;
  signer_email?: string | null;
  signature_png_base64?: string | null;
}): Promise<Record<string, unknown>> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/sign`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to save signature");
  }
  return normalizeQuoteSignatureResponse(await res.json().catch(() => ({})));
}

export async function getPortalRevision(dealId: string): Promise<PortalRevisionEnvelope> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision?deal_id=${encodeURIComponent(dealId)}`);
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to load portal revision");
  }
  return normalizePortalRevisionEnvelope(await res.json().catch(() => ({})));
}

export async function savePortalRevisionDraft(data: {
  deal_id: string;
  quote_package_id: string;
  quote_data: Record<string, unknown>;
  quote_pdf_url?: string | null;
  dealer_message?: string | null;
  revision_summary?: string | null;
}): Promise<{ draft: PortalQuoteRevisionDraft; publishState: PortalQuoteRevisionPublishState }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision/draft`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to save portal revision draft");
  }
  return normalizePortalRevisionMutationResponse(await res.json().catch(() => ({})));
}

export async function submitPortalRevision(data: {
  deal_id: string;
}): Promise<{ draft: PortalQuoteRevisionDraft; publishState: PortalQuoteRevisionPublishState }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision/submit`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to submit portal revision");
  }
  return normalizePortalRevisionMutationResponse(await res.json().catch(() => ({})));
}

export async function returnPortalRevisionToDraft(data: {
  deal_id: string;
}): Promise<{ draft: PortalQuoteRevisionDraft; publishState: PortalQuoteRevisionPublishState }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision/return-to-draft`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to return revision to draft");
  }
  return normalizePortalRevisionMutationResponse(await res.json().catch(() => ({})));
}

export async function publishPortalRevision(data: {
  deal_id: string;
}): Promise<{ draft: PortalQuoteRevisionDraft | null; publishState: PortalQuoteRevisionPublishState }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision/publish`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readJsonRecord(res);
    throw new Error(errorDetail(err) || "Failed to publish portal revision");
  }
  return normalizePortalRevisionPublishResponse(await res.json().catch(() => ({})));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_DISCOUNT_REASON_CODES = new Set(["competitive_match", "volume_buyer", "aged_inventory", "loyalty", "other"]);

function safeLineReasonCode(item: QuoteWorkspaceDraft["equipment"][number]): string | undefined {
  return item.kind === "discount" && item.reasonCode && LINE_DISCOUNT_REASON_CODES.has(String(item.reasonCode))
    ? String(item.reasonCode)
    : undefined;
}

export function buildQuoteSavePayload(
  draft: QuoteWorkspaceDraft,
  computed: {
    equipmentTotal: number;
    attachmentTotal: number;
    subtotal: number;
    discountTotal: number;
    discountedSubtotal: number;
    netTotal: number;
    taxTotal: number;
    customerTotal: number;
    cashDown: number;
    amountFinanced: number;
    marginAmount: number;
    marginPct: number;
  },
  financeScenarios: QuoteFinanceScenario[],
  /** Slice 20e: win-probability snapshot captured at save time. Passed
   *  opaquely to the edge function where it's validated + persisted to
   *  quote_packages.win_probability_snapshot. Optional so legacy
   *  callers keep working. */
  winProbabilitySnapshot?: Record<string, unknown> | null,
  options?: {
    quotePackageId?: string | null;
    expectedUpdatedAt?: string | null;
    saveMode?: "manual" | "autosave";
  },
): Record<string, unknown> {
  const pricingLines = draft.pricingLines ?? [];
  const isProspectQuote = !draft.contactId && !draft.companyId && (
    draft.customerWarmth === "new"
    || /prospect/i.test(`${draft.customerName ?? ""} ${draft.customerCompany ?? ""}`)
  );
  const prospectConversionSource = isProspectQuote
    ? {
        original_customer_name: draft.customerName || null,
        original_customer_company: draft.customerCompany || null,
        original_customer_phone: draft.customerPhone || null,
        original_customer_email: draft.customerEmail || null,
        conversion_status: "pending_crm_link",
      }
    : null;
  const financeScenarioSource = draft.savedFinanceScenarios?.length
    ? draft.savedFinanceScenarios
    : financeScenarios;
  const buildLineMetadata = (item: QuoteWorkspaceDraft["equipment"][number], defaults: Record<string, unknown>) => ({
    ...defaults,
    ...(item.metadata ?? {}),
    source_catalog: item.sourceCatalog ?? defaults.source_catalog,
    source_id: item.sourceId ?? item.id ?? defaults.source_id ?? null,
  });
  const catalogEntryIdForLine = (item: QuoteWorkspaceDraft["equipment"][number]) => {
    if (item.sourceCatalog !== "catalog_entries") return undefined;
    const candidate = item.sourceId ?? item.id;
    return candidate && UUID_RE.test(candidate) ? candidate : undefined;
  };
  const pricingFieldKey = (item: QuoteWorkspaceDraft["equipment"][number]): string | null => {
    const value = item.metadata?.pricing_field_key;
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const freightDirection = (item: QuoteWorkspaceDraft["equipment"][number]): "inbound" | "outbound" | null => {
    const explicit = item.metadata?.freight_direction;
    if (explicit === "inbound" || explicit === "outbound") return explicit;
    const key = pricingFieldKey(item);
    if (key === "inbound_freight") return "inbound";
    if (key === "outbound_delivery") return "outbound";
    return null;
  };
  const lineItems = [
    ...draft.equipment.map((item, index) => {
      const overrideCents = equipmentOverridePriceCents(item);
      return {
        id: item.id,
        catalog_entry_id: catalogEntryIdForLine(item),
        line_type: "equipment",
        description: item.title,
        make: item.make,
        model: item.model,
        year: item.year,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        extended_price: item.unitPrice * item.quantity,
        equipment_override_price_cents: overrideCents,
        quoted_dealer_cost: item.dealerCost ?? undefined,
        display_order: index,
        reason_code: safeLineReasonCode(item),
        approval_required: item.approvalRequired === true,
        cost_visibility: quoteLineCostVisibility(item),
        metadata: buildLineMetadata(item, {
          source_catalog: item.sourceCatalog ?? "qb_equipment_models",
          source_id: item.sourceId ?? item.id ?? null,
          system_base_unit_price: equipmentSystemBasePrice(item),
        }),
      };
    }),
    ...draft.attachments.map((item, index) => ({
      id: item.id,
      catalog_entry_id: catalogEntryIdForLine(item),
      line_type: item.kind,
      description: item.title,
      make: item.make,
      model: item.model,
      year: item.year,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      extended_price: item.unitPrice * item.quantity,
      quoted_dealer_cost: item.dealerCost ?? undefined,
      display_order: draft.equipment.length + index,
      reason_code: safeLineReasonCode(item),
      approval_required: item.approvalRequired === true,
      cost_visibility: quoteLineCostVisibility(item),
      metadata: buildLineMetadata(item, {
        source_catalog: item.sourceCatalog ?? (item.kind === "attachment" ? "qb_attachments" : "manual"),
        source_id: item.sourceId ?? item.id ?? null,
      }),
    })),
    ...pricingLines.map((item, index) => ({
      id: item.id,
      catalog_entry_id: catalogEntryIdForLine(item),
      line_type: item.kind,
      description: item.title,
      make: item.make,
      model: item.model,
      year: item.year,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      extended_price: item.unitPrice * item.quantity,
      quoted_dealer_cost: item.dealerCost ?? undefined,
      inbound_freight_amount: item.kind === "freight" && freightDirection(item) === "inbound" ? item.unitPrice * item.quantity : undefined,
      outbound_delivery_amount: item.kind === "freight" && freightDirection(item) !== "inbound" ? item.unitPrice * item.quantity : undefined,
      display_order: draft.equipment.length + draft.attachments.length + index,
      reason_code: safeLineReasonCode(item),
      approval_required: item.approvalRequired === true,
      cost_visibility: quoteLineCostVisibility(item),
      metadata: buildLineMetadata(item, {
        source_catalog: item.sourceCatalog ?? "manual",
        source_id: item.sourceId ?? item.id ?? null,
      }),
    })),
  ];
  const recommendationTrigger = draft.recommendation
    ? draft.recommendation.trigger ?? {
        triggerType: draft.entryMode === "voice"
          ? "voice_transcript"
          : draft.entryMode === "ai_chat"
            ? "ai_chat_prompt"
            : "manual_request",
        sourceField: draft.entryMode === "voice" ? "voice_transcript" : "opportunity_description",
        excerpt: draft.voiceSummary ? draft.voiceSummary.trim().slice(0, 240) : null,
        createdAt: new Date().toISOString(),
      }
    : null;
  const recommendation = draft.recommendation
    ? { ...draft.recommendation, trigger: recommendationTrigger }
    : null;

  return {
    quote_package_id: options?.quotePackageId ?? null,
    deal_id: draft.dealId,
    contact_id: draft.contactId || undefined,
    // Slice: Customer Picker. When the rep picks an existing customer
    // from the CRM, companyId flows through to the save payload so
    // Slice-17 similar-deals + Slice-10 outcome capture can attribute
    // the quote to the company without relying on string matching on
    // customer_company.
    company_id: draft.companyId || undefined,
    equipment: draft.equipment.map((item) => ({
      id: item.id,
      kind: item.kind,
      sourceCatalog: item.sourceCatalog,
      sourceId: item.sourceId ?? item.id,
      dealerCost: item.dealerCost ?? null,
      make: item.make,
      model: item.model,
      year: item.year,
      quantity: item.quantity,
      title: item.title,
      price: item.unitPrice,
    })),
    attachments_included: draft.attachments.map((item) => ({
      id: item.id,
      kind: item.kind,
      sourceCatalog: item.sourceCatalog,
      sourceId: item.sourceId ?? item.id,
      dealerCost: item.dealerCost ?? null,
      name: item.title,
      quantity: item.quantity,
      price: item.unitPrice,
    })),
    line_items: lineItems,
    trade_in_valuation_id: draft.tradeValuationId,
    trade_allowance: draft.tradeAllowance,
    financing_scenarios: financeScenarioSource.map((scenario) => ({
      type: scenario.type,
      kind: scenario.kind ?? scenario.type,
      label: scenario.label,
      term_months: scenario.termMonths ?? null,
      apr: scenario.apr ?? scenario.rate ?? null,
      down_payment: scenario.downPayment ?? null,
      residual_amount: scenario.residualAmount ?? null,
      money_factor: scenario.moneyFactor ?? null,
      monthly_payment: scenario.monthlyPayment ?? null,
      total_cost: scenario.totalCost ?? null,
      lender: scenario.lender ?? null,
      is_default: scenario.isDefault === true || scenario.label === draft.selectedFinanceScenario,
    })),
    equipment_total: computed.equipmentTotal,
    attachment_total: computed.attachmentTotal,
    subtotal: computed.subtotal,
    branch_slug: draft.branchSlug || null,
    commercial_discount_type: draft.commercialDiscountType,
    commercial_discount_value: draft.commercialDiscountValue,
    discount_total: computed.discountTotal,
    discounted_subtotal: computed.discountedSubtotal,
    trade_credit: draft.tradeAllowance,
    net_total: computed.netTotal,
    tax_profile: draft.taxProfile,
    tax_total: computed.taxTotal,
    customer_total: computed.customerTotal,
    cash_down: computed.cashDown,
    amount_financed: computed.amountFinanced,
    selected_finance_scenario: draft.selectedFinanceScenario,
    wizard_step: draft.wizardStep ?? null,
    expires_at: draft.expiresAt ?? null,
    follow_up_at: draft.followUpAt ?? null,
    post_approval_action: draft.postApprovalAction ?? "return_to_rep",
    deposit_required_amount: draft.depositRequiredAmount ?? null,
    delivery_eta: draft.deliveryEta ?? null,
    delivery_state: draft.deliveryState ?? null,
    delivery_county: draft.deliveryCounty ?? null,
    special_terms: draft.specialTerms ?? null,
    why_this_machine: draft.whyThisMachine ?? null,
    why_this_machine_confirmed: draft.whyThisMachineConfirmed === true,
    tax_jurisdiction_id: draft.taxJurisdictionId ?? null,
    tax_override_amount: draft.taxOverrideAmount ?? null,
    tax_override_reason: draft.taxOverrideReason ?? null,
    selected_promotion_ids: (draft.selectedPromotionIds ?? []).filter((id) => UUID_RE.test(id)),
    margin_amount: computed.marginAmount,
    margin_pct: computed.marginPct,
    ai_recommendation: recommendation,
    entry_mode: draft.entryMode,
    status: "draft",
    customer_name: draft.customerName || null,
    customer_company: draft.customerCompany || null,
    customer_phone: draft.customerPhone || null,
    customer_email: draft.customerEmail || null,
    customer_warmth: draft.customerWarmth ?? null,
    is_prospect_quote: isProspectQuote,
    prospect_conversion_source: prospectConversionSource,
    opportunity_description: draft.voiceSummary || null,
    voice_transcript: draft.entryMode === "voice" ? draft.voiceSummary || null : null,
    originating_log_id: draft.originatingLogId ?? null,
    win_probability_snapshot: winProbabilitySnapshot ?? null,
    expected_updated_at: options?.expectedUpdatedAt ?? null,
    save_mode: options?.saveMode ?? "manual",
  };
}

export function buildPortalRevisionQuoteData(
  draft: QuoteWorkspaceDraft,
  computed: {
    subtotal: number;
    discountTotal: number;
    netTotal: number;
    taxTotal: number;
    customerTotal: number;
    cashDown: number;
    amountFinanced: number;
  },
  financeScenarios: QuoteFinanceScenario[],
  dealerMessage?: string | null,
  revisionSummary?: string | null,
): Record<string, unknown> {
  return {
    summary: draft.recommendation?.reasoning ?? null,
    equipment: draft.equipment.map((item) => ({
      make: item.make,
      model: item.model,
      year: item.year,
      quantity: item.quantity,
      amount: item.unitPrice,
      description: item.title,
    })),
    line_items: [
      ...draft.equipment.map((item) => ({
        description: item.title,
        quantity: item.quantity,
        amount: item.unitPrice * item.quantity,
      })),
      ...draft.attachments.map((item) => ({
        description: item.title,
        quantity: item.quantity,
        amount: item.unitPrice * item.quantity,
      })),
    ],
    financing: financeScenarios.map((scenario) => ({
      type: scenario.type,
      monthlyPayment: scenario.monthlyPayment ?? null,
      termMonths: scenario.termMonths ?? null,
      totalCost: scenario.totalCost ?? null,
      apr: scenario.apr ?? scenario.rate ?? null,
      lender: scenario.lender ?? null,
    })),
    terms: ["Subject to dealership approval and final document review."],
    subtotal: computed.subtotal,
    discount_total: computed.discountTotal,
    trade_allowance: draft.tradeAllowance,
    net_total: computed.netTotal,
    tax_profile: draft.taxProfile,
    tax_total: computed.taxTotal,
    customer_total: computed.customerTotal,
    cash_down: computed.cashDown,
    amount_financed: computed.amountFinanced,
    selected_finance_scenario: draft.selectedFinanceScenario,
    dealer_message: dealerMessage ?? null,
    revision_summary: revisionSummary ?? null,
  };
}

export async function searchCatalog(query: string) {
  // Sanitize query: strip PostgREST filter metacharacters to prevent injection
  const sanitized = query.replace(/[%,().!]/g, "").trim().substring(0, 100);

  let catalogQuery = supabase
    .from("qb_equipment_models")
    .select(
      `id, model_code, family, series, name_display, model_year, list_price_cents,
       brand:qb_brands!brand_id ( id, code, name, category )`,
    )
    .eq("active", true)
    .is("deleted_at", null)
    .order("name_display", { ascending: true })
    .limit(sanitized ? 20 : 100);
  if (sanitized) {
    catalogQuery = catalogQuery.or(
      `model_code.ilike.%${sanitized}%,family.ilike.%${sanitized}%,series.ilike.%${sanitized}%,name_display.ilike.%${sanitized}%`,
    );
  }
  const { data, error } = await catalogQuery;
  if (error) throw error;

  const models = data ?? [];
  const brandIds = Array.from(
    new Set(
      models
        .map((row) => {
          const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
          return brand?.id ?? null;
        })
        .filter(Boolean),
    ),
  );

  const { data: attachmentData, error: attachmentError } = brandIds.length
    ? await supabase
        .from("qb_attachments")
        .select("id, brand_id, name, list_price_cents, compatible_model_ids, universal")
        .in("brand_id", brandIds)
        .eq("active", true)
        .is("deleted_at", null)
        .limit(500)
    : { data: [], error: null };

  if (attachmentError) throw attachmentError;

  const attachments = attachmentData ?? [];

  return models.map((row) => {
    const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
    const make = brand?.name ?? row.name_display?.split(" ")[0] ?? "";
    const compatibleAttachments = attachments
      .filter((attachment) => {
        const compatibleIds = Array.isArray(attachment.compatible_model_ids)
          ? attachment.compatible_model_ids
          : [];
        return attachment.universal || compatibleIds.includes(row.id);
      })
      .map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        price: attachment.list_price_cents != null ? Number(attachment.list_price_cents) / 100 : 0,
      }));
    return {
      id: row.id,
      sourceCatalog: "qb_equipment_models" as const,
      sourceId: row.id,
      dealerCost: null,
      make,
      model: row.model_code ?? "",
      year: row.model_year ?? null,
      category: row.family ?? brand?.category ?? null,
      list_price: row.list_price_cents != null ? Number(row.list_price_cents) / 100 : null,
      stock_number: null as string | null,
      serial_number: null as string | null,
      condition: "new" as const,
      warranty_text: null as string | null,
      long_description: null as string | null,
      spec_bullets: [] as string[],
      photo_url: null as string | null,
      photo_urls: [] as string[],
      vendor_logo_url: null as string | null,
      media_source: "qb_equipment_models" as const,
      media_source_id: row.id,
      media_kind: null as string | null,
      attachments: compatibleAttachments,
    };
  });
}

export async function getCrmEquipmentQuoteSeed(equipmentId: string): Promise<CrmEquipmentQuoteSeed | null> {
  if (!equipmentId || !UUID_RE.test(equipmentId)) return null;
  const { data, error } = await supabase
    .from("crm_equipment")
    .select("id, name, make, model, year, serial_number, asset_tag, condition, availability, current_market_value, replacement_cost, purchase_price, photo_urls, engine_hours, warranty_expires_on, notes, fuel_type, weight_class, operating_capacity, metadata")
    .eq("id", equipmentId)
    .maybeSingle();
  if (error) throw error;
  return normalizeCrmEquipmentQuoteSeed(data);
}

export async function searchQuoteAttachments(query: string) {
  const sanitized = sanitizeCatalogSearch(query);

  let attachmentQuery = supabase
    .from("qb_attachments")
    .select(
      `id, name, list_price_cents, universal,
       brand:qb_brands!brand_id ( id, code, name, category )`,
    )
    .eq("active", true)
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .limit(sanitized ? 20 : 100);

  if (sanitized) {
    attachmentQuery = attachmentQuery.ilike("name", `%${sanitized}%`);
  }

  const { data, error } = await attachmentQuery;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
    return {
      id: row.id,
      name: row.name ?? "",
      price: row.list_price_cents != null ? Number(row.list_price_cents) / 100 : 0,
      brandName: brand?.name ?? null,
      category: brand?.category ?? null,
      universal: row.universal === true,
    };
  });
}

export type QuotePackageCatalogKind = "attachment" | "option" | "accessory" | "part" | "warranty";

export interface QuotePackageCatalogItem {
  id: string;
  kind: QuotePackageCatalogKind;
  name: string;
  price: number;
  dealerCost: number | null;
  brandName: string | null;
  category: string | null;
  universal: boolean;
  sourceCatalog: "qb_equipment_models" | "qb_attachments" | "catalog_entries" | "manual";
  sourceId: string;
  metadata: Record<string, unknown> | null;
}

const PACKAGE_ITEM_STARTER_CATALOG: QuotePackageCatalogItem[] = [
  {
    id: "starter-option-hydraulic-thumb-kit",
    kind: "option",
    name: "Hydraulic thumb kit",
    price: 4_800,
    dealerCost: null,
    brandName: "QEP",
    category: "Excavator options",
    universal: false,
    sourceCatalog: "manual",
    sourceId: "starter-option-hydraulic-thumb-kit",
    metadata: { source: "starter_package_catalog", compatibility: "model_or_dealer_verified" },
  },
  {
    id: "starter-option-enclosed-cab-upgrade",
    kind: "option",
    name: "Enclosed cab upgrade",
    price: 6_500,
    dealerCost: null,
    brandName: "QEP",
    category: "Comfort options",
    universal: false,
    sourceCatalog: "manual",
    sourceId: "starter-option-enclosed-cab-upgrade",
    metadata: { source: "starter_package_catalog", compatibility: "model_or_dealer_verified" },
  },
  {
    id: "starter-accessory-led-work-light-kit",
    kind: "accessory",
    name: "LED work light kit",
    price: 950,
    dealerCost: null,
    brandName: "QEP",
    category: "Jobsite accessories",
    universal: true,
    sourceCatalog: "manual",
    sourceId: "starter-accessory-led-work-light-kit",
    metadata: { source: "starter_package_catalog", compatibility: "universal" },
  },
  {
    id: "starter-accessory-bluetooth-telematics-tag",
    kind: "accessory",
    name: "Bluetooth telematics tag",
    price: 375,
    dealerCost: null,
    brandName: "QEP Fleet",
    category: "Telematics",
    universal: true,
    sourceCatalog: "manual",
    sourceId: "starter-accessory-bluetooth-telematics-tag",
    metadata: { source: "starter_package_catalog", compatibility: "universal" },
  },
  {
    id: "starter-warranty-extended-powertrain-36",
    kind: "warranty",
    name: "Extended powertrain warranty — 36 months",
    price: 2_950,
    dealerCost: null,
    brandName: "QEP Protect",
    category: "Extended warranty",
    universal: true,
    sourceCatalog: "manual",
    sourceId: "starter-warranty-extended-powertrain-36",
    metadata: { source: "starter_package_catalog", term_months: 36, coverage: "powertrain" },
  },
  {
    id: "starter-warranty-premier-protection-60",
    kind: "warranty",
    name: "Premier protection plan — 60 months",
    price: 4_250,
    dealerCost: null,
    brandName: "QEP Protect",
    category: "Extended warranty",
    universal: true,
    sourceCatalog: "manual",
    sourceId: "starter-warranty-premier-protection-60",
    metadata: { source: "starter_package_catalog", term_months: 60, coverage: "premier" },
  },
];

function sanitizeCatalogSearch(query: string): string {
  return query.replace(/[%,().!]/g, "").trim().substring(0, 100);
}

export function normalizeQuotePackageCatalogItem(
  value: unknown,
  kind: QuotePackageCatalogKind,
): QuotePackageCatalogItem | null {
  if (!isRecord(value)) return null;
  const id = firstString(value.id, value.source_id);
  const name = firstString(value.name, value.title, value.name_display);
  if (!id || !name) return null;
  const brand = Array.isArray(value.brand) ? value.brand[0] : value.brand;
  const brandRecord = recordOrEmpty(brand);
  const listPriceCents = numOrNull(value.list_price_cents);
  const dealerCostCents = numOrNull(value.dealer_cost_cents);
  const directPrice = numOrNull(value.price) ?? numOrNull(value.unit_price) ?? numOrNull(value.list_price);
  const directDealerCost = numOrNull(value.dealerCost) ?? numOrNull(value.dealer_cost);
  return {
    id,
    kind,
    name,
    price: listPriceCents != null ? listPriceCents / 100 : directPrice ?? 0,
    dealerCost: dealerCostCents != null ? dealerCostCents / 100 : directDealerCost,
    brandName: firstString(brandRecord.name, value.brandName, value.brand_name),
    category: firstString(value.category, brandRecord.category),
    universal: value.universal === true,
    sourceCatalog: kind === "attachment" ? "qb_attachments" : "manual",
    sourceId: id,
    metadata: {
      catalog_kind: kind,
      source: kind === "attachment" ? "qb_attachments" : "qb_package_items",
      term_months: numOrNull(value.warranty_term_months),
      compatibility: value.universal === true ? "universal" : "catalog_match",
    },
  };
}

function starterPackageItems(kind: QuotePackageCatalogKind, query: string): QuotePackageCatalogItem[] {
  const sanitized = sanitizeCatalogSearch(query).toLowerCase();
  return PACKAGE_ITEM_STARTER_CATALOG.filter((item) => {
    if (item.kind !== kind) return false;
    if (!sanitized) return true;
    return [item.name, item.brandName, item.category]
      .filter(Boolean)
      .some((field) => field!.toLowerCase().includes(sanitized));
  });
}

export async function searchQuotePackageItems(params: {
  kind: QuotePackageCatalogKind;
  query: string;
}): Promise<QuotePackageCatalogItem[]> {
  const sanitized = sanitizeCatalogSearch(params.query);
  if (params.kind === "attachment") {
    const attachments = await searchQuoteAttachments(sanitized);
    return attachments.map((entry) => ({
      id: entry.id,
      kind: "attachment" as const,
      name: entry.name,
      price: entry.price,
      dealerCost: null,
      brandName: entry.brandName,
      category: entry.category,
      universal: entry.universal,
      sourceCatalog: "qb_attachments" as const,
      sourceId: entry.id,
      metadata: {
        catalog_kind: entry.universal ? "universal_attachment" : "attachment",
        brand_name: entry.brandName ?? null,
        category: entry.category ?? null,
        compatibility: entry.universal ? "universal" : "catalog_match",
      },
    }));
  }

  if (params.kind === "part") {
    try {
      let inventoryQuery = supabase
        .from("parts_inventory")
        .select(
          "part_number, qty_on_hand, catalog:parts_catalog!parts_inventory_catalog_id_fkey(id, part_number, description, category, manufacturer, list_price, cost_price)",
        )
        .is("deleted_at", null)
        .limit(sanitized ? 200 : 400);

      if (sanitized) {
        inventoryQuery = inventoryQuery.or(`part_number.ilike.%${sanitized}%`);
      }

      const { data: inventoryRows, error: inventoryErr } = await inventoryQuery;
      if (inventoryErr) throw inventoryErr;

      const byPartNumber = new Map<string, {
        partNumber: string;
        qtyOnHand: number;
        catalogId: string | null;
        description: string;
        category: string | null;
        manufacturer: string | null;
        listPrice: number;
        costPrice: number | null;
      }>();

      for (const row of inventoryRows ?? []) {
        const partNumber = typeof row.part_number === "string" ? row.part_number.trim() : "";
        if (!partNumber) continue;
        const key = partNumber.toLowerCase();
        const qty = Number(row.qty_on_hand ?? 0);
        const catalogRow = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog;
        const existing = byPartNumber.get(key);
        const next = {
          partNumber,
          qtyOnHand: (existing?.qtyOnHand ?? 0) + (Number.isFinite(qty) ? qty : 0),
          catalogId: typeof catalogRow?.id === "string" ? catalogRow.id : (existing?.catalogId ?? null),
          description: typeof catalogRow?.description === "string" ? catalogRow.description : (existing?.description ?? ""),
          category: typeof catalogRow?.category === "string" ? catalogRow.category : (existing?.category ?? null),
          manufacturer: typeof catalogRow?.manufacturer === "string" ? catalogRow.manufacturer : (existing?.manufacturer ?? null),
          listPrice: Number(catalogRow?.list_price ?? existing?.listPrice ?? 0),
          costPrice: Number.isFinite(Number(catalogRow?.cost_price))
            ? Number(catalogRow?.cost_price)
            : (existing?.costPrice ?? null),
        };
        byPartNumber.set(key, next);
      }

      const inventoryItems = [...byPartNumber.values()]
        .filter((row) => {
          if (!sanitized) return true;
          const needle = sanitized.toLowerCase();
          return row.partNumber.toLowerCase().includes(needle)
            || row.description.toLowerCase().includes(needle)
            || (row.manufacturer ?? "").toLowerCase().includes(needle);
        })
        .sort((a, b) => b.qtyOnHand - a.qtyOnHand || a.partNumber.localeCompare(b.partNumber))
        .slice(0, 40)
        .map((row) => {
          const title = row.description.length > 0
            ? `${row.partNumber} — ${row.description}`
            : row.partNumber;
          const sourceId = row.catalogId ?? row.partNumber;
          return {
            id: `inventory-${row.partNumber}`,
            kind: "part" as const,
            name: title,
            price: Number.isFinite(row.listPrice) ? row.listPrice : 0,
            dealerCost: row.costPrice,
            brandName: row.manufacturer,
            category: row.category,
            universal: false,
            sourceCatalog: "manual" as const,
            sourceId,
            metadata: {
              catalog_kind: "part",
              source: "parts_inventory",
              part_number: row.partNumber,
              description: row.description || null,
              qty_on_hand: row.qtyOnHand,
              compatibility: "catalog_match",
            },
          };
        });

      if (inventoryItems.length > 0) return inventoryItems;

      let partsQuery = supabase
        .from("parts_catalog")
        .select("id, part_number, description, category, manufacturer, list_price, cost_price")
        .is("deleted_at", null)
        .order("part_number", { ascending: true })
        .limit(sanitized ? 25 : 100);

      if (sanitized) {
        partsQuery = partsQuery.or(
          `part_number.ilike.%${sanitized}%,description.ilike.%${sanitized}%,manufacturer.ilike.%${sanitized}%`,
        );
      }

      const { data, error } = await partsQuery;
      if (error) throw error;

      return (data ?? []).map((row) => {
        const partNumber = row.part_number ?? "";
        const description = row.description ?? "";
        const title = description.length > 0
          ? `${partNumber} — ${description}`
          : partNumber;
        const sourceId = row.id ?? partNumber;
        return {
          id: sourceId,
          kind: "part" as const,
          name: title,
          price: row.list_price != null ? Number(row.list_price) : 0,
          dealerCost: row.cost_price != null ? Number(row.cost_price) : null,
          brandName: row.manufacturer ?? null,
          category: row.category ?? null,
          universal: false,
          sourceCatalog: "manual" as const,
          sourceId,
          metadata: {
            catalog_kind: "part",
            source: "parts_catalog",
            part_number: partNumber,
            description: description || null,
            compatibility: "catalog_match",
          },
        };
      });
    } catch {
      return [];
    }
  }

  const starterRows = starterPackageItems(params.kind, sanitized);

  try {
    let packageQuery = supabase
      .from("qb_package_items")
      .select(
        `id, kind, name, category, list_price_cents, dealer_cost_cents, universal, warranty_term_months,
         brand:qb_brands!brand_id ( id, code, name, category )`,
      )
      .eq("kind", params.kind)
      .eq("active", true)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(sanitized ? 20 : 100);

    if (sanitized) {
      packageQuery = packageQuery.or(`name.ilike.%${sanitized}%,category.ilike.%${sanitized}%`);
    }

    const { data, error } = await packageQuery;
    if (error) throw error;
    const rows = (data ?? []).flatMap((row) => {
      const normalized = normalizeQuotePackageCatalogItem(row, params.kind);
      return normalized ? [normalized] : [];
    });
    const seen = new Set(rows.map((row) => row.id));
    return [...rows, ...starterRows.filter((row) => !seen.has(row.id))];
  } catch {
    return starterRows;
  }
}
