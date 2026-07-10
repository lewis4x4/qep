import { supabase } from "@/lib/supabase";

// Phase 1 OEM price feeds operate on persisted qb_quote_reprice_impacts created
// by the admin staged-publish lane. (The legacy price-file-import / requote-drafts
// CLIENT lane was retired; its edge functions remain for any server/cron callers.)
const OEM_PRICE_FEEDS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oem-price-feeds`;

async function authHeadersJson(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export type RepPriceImpactState =
  | "visible"
  | "draft_created"
  | "approval_pending"
  | "approved"
  | "applied"
  | "dismissed"
  | "quiet"
  | "superseded"
  | "stale";

export type RepPriceImpactMateriality =
  "line_pct" | "quote_delta" | "both" | "quiet";
export type RepPriceImpactCategory =
  "list_price" | "freight" | "rebate" | "incentive";

export interface RepPriceImpactSummary {
  visibleImpactCount: number;
  affectedQuoteCount: number;
  totalDeltaCents: number;
  needsApprovalCount: number;
}

export interface RepPriceImpactLine {
  id: string;
  modelCode: string;
  make: string | null;
  quantity: number;
  oldListPriceCents: number | null;
  newListPriceCents: number | null;
  deltaCents: number;
  deltaPct: number | null;
  sourceLocation: string | null;
  isYardStock: boolean;
  suppressedByStockLock: boolean;
  suppressionReason: string | null;
}

export interface RepRepriceDraft {
  id: string;
  status:
    | "draft"
    | "approval_pending"
    | "approved"
    | "applied"
    | "reversed"
    | "rejected"
    | "stale"
    | "cancelled";
  approvalCaseId: string | null;
  appliedAt: string | null;
  reversedAt: string | null;
}

export interface RepRepriceAudit {
  id: string;
  action: "apply" | "reverse";
  applyAuditId: string | null;
  draftId: string;
  actorRole: string | null;
  createdAt: string;
  beforeVersionNumber: number | null;
  afterVersionNumber: number | null;
  canReverse: boolean;
  reversalDeadline: string | null;
  reversedByAuditId: string | null;
  customerCommunication: "none";
}

export interface RepPriceImpact {
  id: string;
  eventId: string;
  quotePackageId: string;
  dealId: string | null;
  assignedRepId: string | null;
  quoteStatus: string | null;
  quoteUpdatedAt: string | null;
  totalDeltaCents: number;
  maxLineDeltaPct: number | null;
  oldMarginPct: number | null;
  projectedMarginPct: number | null;
  marginFloorPct: number | null;
  belowMarginFloor: boolean;
  materialityTrigger: RepPriceImpactMateriality;
  requiresManagerReview: boolean;
  approvalRequiredReasons: string[];
  oldCommissionCents: number | null;
  projectedCommissionCents: number | null;
  commissionDeltaCents: number | null;
  changeCategories: RepPriceImpactCategory[];
  catalogChanges: Array<Record<string, unknown>>;
  contextSnapshot: Record<string, unknown>;
  customerCompanyId: string | null;
  suppressedByCustomerLock: boolean;
  customerPriceLockReason: string | null;
  customerPriceLockExpiresAt: string | null;
  state: RepPriceImpactState;
  createdAt: string | null;
  updatedAt: string | null;
  currentDraft: RepRepriceDraft | null;
  history: RepRepriceAudit[];
  lines: RepPriceImpactLine[];
}

export interface RepPriceImpactsResponse {
  summary: RepPriceImpactSummary;
  impacts: RepPriceImpact[];
}

export interface CreateRepriceDraftResponse {
  ok: boolean;
  draftId: string;
  status: "draft" | "approval_pending";
  approvalRequired: boolean;
  approvalReasons: string[];
  emailDraftId: string | null;
  approvalCaseId: string | null;
  customerCommunication: "none";
  idempotent: boolean;
}

export interface ApplyRepriceDraftResponse {
  ok: boolean;
  action: "apply";
  auditId: string;
  quotePackageId: string;
  afterQuoteVersionId: string;
  afterVersionNumber: number | null;
  appliedLineCount: number | null;
  customerCommunication: "none";
  idempotent: boolean;
}

export interface ReverseRepriceApplyResponse {
  ok: boolean;
  action: "reverse";
  auditId: string;
  applyAuditId: string;
  quotePackageId: string;
  afterQuoteVersionId: string;
  afterVersionNumber: number | null;
  reversedLineCount: number | null;
  customerCommunication: "none";
  idempotent: boolean;
}

export interface DismissRepriceImpactResponse {
  ok: boolean;
  impactId: string;
  state: "dismissed";
}

/* ── API functions ───────────────────────────────────────────────── */

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function impactCategories(value: unknown): RepPriceImpactCategory[] {
  return stringArray(value).filter(
    (item): item is RepPriceImpactCategory =>
      item === "list_price" ||
      item === "freight" ||
      item === "rebate" ||
      item === "incentive",
  );
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return Object.keys(record).length ? [record] : [];
      })
    : [];
}

function valueAt(row: JsonRecord, camelKey: string, snakeKey: string): unknown {
  return row[camelKey] ?? row[snakeKey];
}

export function normalizeRepPriceImpactLine(
  value: unknown,
): RepPriceImpactLine {
  const row = asRecord(value);
  return {
    id:
      nullableString(row.id) ??
      `line-${nullableString(row.model_code) ?? "unknown"}`,
    modelCode: nullableString(row.model_code) ?? "Unknown model",
    make: nullableString(row.make),
    quantity: Math.max(1, Math.trunc(numberOrZero(row.quantity)) || 1),
    oldListPriceCents: numberOrNull(row.old_list_price_cents),
    newListPriceCents: numberOrNull(row.new_list_price_cents),
    deltaCents: numberOrZero(row.delta_cents),
    deltaPct: numberOrNull(row.delta_pct),
    sourceLocation: nullableString(row.source_location),
    isYardStock: row.is_yard_stock === true,
    suppressedByStockLock: row.suppressed_by_stock_lock === true,
    suppressionReason: nullableString(row.suppression_reason),
  };
}

function normalizeImpactState(value: unknown): RepPriceImpactState {
  if (
    value === "visible" ||
    value === "draft_created" ||
    value === "approval_pending" ||
    value === "approved" ||
    value === "applied" ||
    value === "dismissed" ||
    value === "quiet" ||
    value === "superseded" ||
    value === "stale"
  )
    return value;
  return "stale";
}

function normalizeMateriality(value: unknown): RepPriceImpactMateriality {
  if (value === "line_pct" || value === "quote_delta" || value === "both") {
    return value;
  }
  return "quiet";
}

function normalizeRepriceDraftStatus(
  value: unknown,
): RepRepriceDraft["status"] | null {
  if (
    value === "draft" ||
    value === "approval_pending" ||
    value === "approved" ||
    value === "applied" ||
    value === "reversed" ||
    value === "rejected" ||
    value === "stale" ||
    value === "cancelled"
  )
    return value;
  return null;
}

function normalizeRepriceDraft(value: unknown): RepRepriceDraft | null {
  const row = asRecord(value);
  const id = nullableString(row.id);
  const status = normalizeRepriceDraftStatus(row.status);
  if (!id || !status) return null;
  return {
    id,
    status,
    approvalCaseId: nullableString(row.approval_case_id),
    appliedAt: nullableString(row.applied_at),
    reversedAt: nullableString(row.reversed_at),
  };
}

export function normalizeRepriceAudit(value: unknown): RepRepriceAudit | null {
  const row = asRecord(value);
  const id = nullableString(row.id);
  const draftId = nullableString(valueAt(row, "draftId", "draft_id"));
  const createdAt = nullableString(valueAt(row, "createdAt", "created_at"));
  const action = row.action === "reverse"
    ? "reverse"
    : row.action === "apply"
      ? "apply"
      : null;
  if (!id || !draftId || !createdAt || !action) return null;
  return {
    id,
    action,
    applyAuditId: nullableString(valueAt(row, "applyAuditId", "apply_audit_id")),
    draftId,
    actorRole: nullableString(valueAt(row, "actorRole", "actor_role")),
    createdAt,
    beforeVersionNumber: numberOrNull(
      valueAt(row, "beforeVersionNumber", "before_version_number"),
    ),
    afterVersionNumber: numberOrNull(
      valueAt(row, "afterVersionNumber", "after_version_number"),
    ),
    canReverse: valueAt(row, "canReverse", "can_reverse") === true,
    reversalDeadline: nullableString(
      valueAt(row, "reversalDeadline", "reversal_deadline"),
    ),
    reversedByAuditId: nullableString(
      valueAt(row, "reversedByAuditId", "reversed_by_audit_id"),
    ),
    customerCommunication: "none",
  };
}

export function normalizeRepPriceImpact(value: unknown): RepPriceImpact {
  const row = asRecord(value);
  const lines = Array.isArray(row.qb_quote_reprice_impact_lines)
    ? row.qb_quote_reprice_impact_lines.map(normalizeRepPriceImpactLine)
    : [];
  const directDraft = normalizeRepriceDraft(
    valueAt(row, "currentDraft", "current_draft"),
  );
  const relatedDrafts = Array.isArray(row.qb_quote_reprice_drafts)
    ? row.qb_quote_reprice_drafts
        .map(normalizeRepriceDraft)
        .filter((draft): draft is RepRepriceDraft => draft !== null)
    : [];
  const currentDraft =
    directDraft ??
    relatedDrafts.sort((left, right) => {
      const rank: Record<RepRepriceDraft["status"], number> = {
        approved: 8,
        approval_pending: 7,
        draft: 6,
        applied: 5,
        reversed: 4,
        stale: 3,
        rejected: 2,
        cancelled: 1,
      };
      return rank[right.status] - rank[left.status];
    })[0] ??
    null;
  const rawHistory = valueAt(row, "history", "reprice_history");
  const history = Array.isArray(rawHistory)
    ? rawHistory
      .map(normalizeRepriceAudit)
      .filter((audit): audit is RepRepriceAudit => audit !== null)
      .sort((left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
      )
    : [];
  return {
    id: nullableString(row.id) ?? "",
    eventId: nullableString(row.event_id) ?? "",
    quotePackageId: nullableString(row.quote_package_id) ?? "",
    dealId: nullableString(row.deal_id),
    assignedRepId: nullableString(row.assigned_rep_id),
    quoteStatus: nullableString(row.quote_status_snapshot),
    quoteUpdatedAt: nullableString(row.quote_updated_at_snapshot),
    totalDeltaCents: numberOrZero(row.total_delta_cents),
    maxLineDeltaPct: numberOrNull(row.max_line_delta_pct),
    oldMarginPct: numberOrNull(row.old_margin_pct),
    projectedMarginPct: numberOrNull(row.projected_margin_pct),
    marginFloorPct: numberOrNull(row.margin_floor_pct),
    belowMarginFloor: row.below_margin_floor === true,
    materialityTrigger: normalizeMateriality(row.materiality_trigger),
    requiresManagerReview: row.requires_manager_review === true,
    approvalRequiredReasons: stringArray(row.approval_required_reasons),
    oldCommissionCents: numberOrNull(row.old_commission_cents),
    projectedCommissionCents: numberOrNull(row.projected_commission_cents),
    commissionDeltaCents: numberOrNull(row.commission_delta_cents),
    changeCategories: impactCategories(row.change_categories),
    catalogChanges: recordArray(row.catalog_changes),
    contextSnapshot: asRecord(row.context_snapshot),
    customerCompanyId: nullableString(row.customer_company_id),
    suppressedByCustomerLock: row.suppressed_by_customer_lock === true,
    customerPriceLockReason: nullableString(row.customer_price_lock_reason),
    customerPriceLockExpiresAt: nullableString(
      row.customer_price_lock_expires_at,
    ),
    state: normalizeImpactState(row.state),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    currentDraft,
    history,
    lines,
  };
}

export function normalizeRepPriceImpactsResponse(
  value: unknown,
): RepPriceImpactsResponse {
  const payload = asRecord(value);
  const summary = asRecord(payload.summary);
  const impacts = Array.isArray(payload.impacts)
    ? payload.impacts
        .map(normalizeRepPriceImpact)
        .filter((impact) => impact.id && impact.quotePackageId)
    : [];
  return {
    summary: {
      visibleImpactCount: numberOrZero(
        valueAt(summary, "visibleImpactCount", "visible_impact_count"),
      ),
      affectedQuoteCount: numberOrZero(
        valueAt(summary, "affectedQuoteCount", "affected_quote_count"),
      ),
      totalDeltaCents: numberOrZero(
        valueAt(summary, "totalDeltaCents", "total_delta_cents"),
      ),
      needsApprovalCount: numberOrZero(
        valueAt(summary, "needsApprovalCount", "needs_approval_count"),
      ),
    },
    impacts,
  };
}

async function jsonError(res: Response, fallback: string): Promise<Error> {
  const err = await res.json().catch(() => ({ error: fallback }));
  return new Error(
    (err as { error?: string }).error ?? `${fallback} (${res.status})`,
  );
}

export async function fetchRepPriceImpacts(): Promise<RepPriceImpactsResponse> {
  const res = await fetch(`${OEM_PRICE_FEEDS_URL}/rep-impacts`, {
    method: "GET",
    headers: await authHeadersJson(),
  });
  if (!res.ok) throw await jsonError(res, "Failed to load OEM price impacts");
  return normalizeRepPriceImpactsResponse(await res.json());
}

export function normalizeCreateRepriceDraftResponse(
  value: unknown,
): CreateRepriceDraftResponse {
  const payload = asRecord(value);
  const status = valueAt(payload, "status", "status");
  const normalizedStatus =
    status === "approval_pending" ? "approval_pending" : "draft";
  return {
    ok: payload.ok === true,
    draftId: nullableString(valueAt(payload, "draftId", "draft_id")) ?? "",
    status: normalizedStatus,
    approvalRequired:
      valueAt(payload, "approvalRequired", "approval_required") === true,
    approvalReasons: stringArray(
      valueAt(payload, "approvalReasons", "approval_reasons"),
    ),
    emailDraftId: nullableString(
      valueAt(payload, "emailDraftId", "email_draft_id"),
    ),
    approvalCaseId: nullableString(
      valueAt(payload, "approvalCaseId", "approval_case_id"),
    ),
    customerCommunication: "none",
    idempotent: valueAt(payload, "idempotent", "idempotent") === true,
  };
}

function normalizeMutationResponse(
  value: unknown,
  action: "apply" | "reverse",
): ApplyRepriceDraftResponse | ReverseRepriceApplyResponse {
  const payload = asRecord(value);
  const common = {
    ok: payload.ok === true,
    action,
    auditId: nullableString(valueAt(payload, "auditId", "audit_id")) ?? "",
    quotePackageId:
      nullableString(valueAt(payload, "quotePackageId", "quote_package_id")) ??
      "",
    afterQuoteVersionId:
      nullableString(
        valueAt(payload, "afterQuoteVersionId", "after_quote_version_id"),
      ) ?? "",
    afterVersionNumber: numberOrNull(
      valueAt(payload, "afterVersionNumber", "after_version_number"),
    ),
    customerCommunication: "none" as const,
    idempotent: valueAt(payload, "idempotent", "idempotent") === true,
  };
  if (action === "apply") {
    return {
      ...common,
      action,
      appliedLineCount: numberOrNull(
        valueAt(payload, "appliedLineCount", "applied_line_count"),
      ),
    };
  }
  return {
    ...common,
    action,
    applyAuditId:
      nullableString(valueAt(payload, "applyAuditId", "apply_audit_id")) ?? "",
    reversedLineCount: numberOrNull(
      valueAt(payload, "reversedLineCount", "reversed_line_count"),
    ),
  };
}

export function normalizeApplyRepriceDraftResponse(
  value: unknown,
): ApplyRepriceDraftResponse {
  return normalizeMutationResponse(value, "apply") as ApplyRepriceDraftResponse;
}

export function normalizeReverseRepriceApplyResponse(
  value: unknown,
): ReverseRepriceApplyResponse {
  return normalizeMutationResponse(
    value,
    "reverse",
  ) as ReverseRepriceApplyResponse;
}

export async function createRepriceDraft(
  impactId: string,
): Promise<CreateRepriceDraftResponse> {
  const res = await fetch(`${OEM_PRICE_FEEDS_URL}/impacts/${impactId}/draft`, {
    method: "POST",
    headers: await authHeadersJson(),
  });
  if (!res.ok) throw await jsonError(res, "Reprice draft failed");
  return normalizeCreateRepriceDraftResponse(await res.json());
}

export async function applyRepriceDraft(
  draftId: string,
): Promise<ApplyRepriceDraftResponse> {
  const res = await fetch(`${OEM_PRICE_FEEDS_URL}/drafts/${draftId}/apply`, {
    method: "POST",
    headers: await authHeadersJson(),
  });
  if (!res.ok) throw await jsonError(res, "Apply approved re-price failed");
  return normalizeApplyRepriceDraftResponse(await res.json());
}

export async function reverseRepriceApply(
  applyAuditId: string,
): Promise<ReverseRepriceApplyResponse> {
  const res = await fetch(
    `${OEM_PRICE_FEEDS_URL}/applies/${applyAuditId}/reverse`,
    { method: "POST", headers: await authHeadersJson() },
  );
  if (!res.ok) throw await jsonError(res, "Reverse OEM re-price failed");
  return normalizeReverseRepriceApplyResponse(await res.json());
}

export async function dismissRepriceImpact(
  impactId: string,
  reason: string,
): Promise<DismissRepriceImpactResponse> {
  const res = await fetch(
    `${OEM_PRICE_FEEDS_URL}/impacts/${impactId}/dismiss`,
    {
      method: "POST",
      headers: await authHeadersJson(),
      body: JSON.stringify({ reason }),
    },
  );
  if (!res.ok) throw await jsonError(res, "Dismiss failed");
  return res.json();
}
