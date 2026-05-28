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
  | "dismissed"
  | "quiet"
  | "superseded"
  | "stale";

export type RepPriceImpactMateriality = "line_pct" | "quote_delta" | "both" | "quiet";

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
  state: RepPriceImpactState;
  createdAt: string | null;
  updatedAt: string | null;
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
    ? value as JsonRecord
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

function valueAt(row: JsonRecord, camelKey: string, snakeKey: string): unknown {
  return row[camelKey] ?? row[snakeKey];
}

export function normalizeRepPriceImpactLine(value: unknown): RepPriceImpactLine {
  const row = asRecord(value);
  return {
    id: nullableString(row.id) ?? `line-${nullableString(row.model_code) ?? "unknown"}`,
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
    value === "dismissed" ||
    value === "quiet" ||
    value === "superseded" ||
    value === "stale"
  ) return value;
  return "stale";
}

function normalizeMateriality(value: unknown): RepPriceImpactMateriality {
  if (value === "line_pct" || value === "quote_delta" || value === "both") {
    return value;
  }
  return "quiet";
}

export function normalizeRepPriceImpact(value: unknown): RepPriceImpact {
  const row = asRecord(value);
  const lines = Array.isArray(row.qb_quote_reprice_impact_lines)
    ? row.qb_quote_reprice_impact_lines.map(normalizeRepPriceImpactLine)
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
    state: normalizeImpactState(row.state),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    lines,
  };
}

export function normalizeRepPriceImpactsResponse(value: unknown): RepPriceImpactsResponse {
  const payload = asRecord(value);
  const summary = asRecord(payload.summary);
  const impacts = Array.isArray(payload.impacts)
    ? payload.impacts.map(normalizeRepPriceImpact).filter((impact) => impact.id && impact.quotePackageId)
    : [];
  return {
    summary: {
      visibleImpactCount: numberOrZero(valueAt(summary, "visibleImpactCount", "visible_impact_count")),
      affectedQuoteCount: numberOrZero(valueAt(summary, "affectedQuoteCount", "affected_quote_count")),
      totalDeltaCents: numberOrZero(valueAt(summary, "totalDeltaCents", "total_delta_cents")),
      needsApprovalCount: numberOrZero(valueAt(summary, "needsApprovalCount", "needs_approval_count")),
    },
    impacts,
  };
}

async function jsonError(res: Response, fallback: string): Promise<Error> {
  const err = await res.json().catch(() => ({ error: fallback }));
  return new Error((err as { error?: string }).error ?? `${fallback} (${res.status})`);
}

export async function fetchRepPriceImpacts(): Promise<RepPriceImpactsResponse> {
  const res = await fetch(`${OEM_PRICE_FEEDS_URL}/rep-impacts`, {
    method: "GET",
    headers: await authHeadersJson(),
  });
  if (!res.ok) throw await jsonError(res, "Failed to load OEM price impacts");
  return normalizeRepPriceImpactsResponse(await res.json());
}

export function normalizeCreateRepriceDraftResponse(value: unknown): CreateRepriceDraftResponse {
  const payload = asRecord(value);
  const status = valueAt(payload, "status", "status");
  const normalizedStatus = status === "approval_pending" ? "approval_pending" : "draft";
  return {
    ok: payload.ok === true,
    draftId: nullableString(valueAt(payload, "draftId", "draft_id")) ?? "",
    status: normalizedStatus,
    approvalRequired: valueAt(payload, "approvalRequired", "approval_required") === true,
    approvalReasons: stringArray(valueAt(payload, "approvalReasons", "approval_reasons")),
    emailDraftId: nullableString(valueAt(payload, "emailDraftId", "email_draft_id")),
  };
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

export async function dismissRepriceImpact(
  impactId: string,
  reason: string,
): Promise<DismissRepriceImpactResponse> {
  const res = await fetch(`${OEM_PRICE_FEEDS_URL}/impacts/${impactId}/dismiss`, {
    method: "POST",
    headers: await authHeadersJson(),
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw await jsonError(res, "Dismiss failed");
  return res.json();
}
