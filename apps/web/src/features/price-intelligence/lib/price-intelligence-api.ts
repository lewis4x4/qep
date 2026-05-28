import { supabase } from "@/lib/supabase";

// Legacy direct import/requote endpoints are retained for compatibility only.
// Phase 1 OEM price feeds must use OEM_PRICE_FEEDS_URL wrappers below so views/actions
// operate on persisted qb_quote_reprice_impacts created by the admin staged publish lane.
const PRICE_IMPORT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/price-file-import`;
const REQUOTE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/requote-drafts`;
const OEM_PRICE_FEEDS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oem-price-feeds`;

async function authHeadersJson(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

async function authHeadersFormData(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}

/* ── Types matching backend response ────────────────────────────── */

export interface ImpactItem {
  quote_package_id: string;
  workspace_id?: string;
  deal_id: string | null;
  quote_status: string;
  quote_total: number | null;
  quote_created_at: string;
  line_item_id: string;
  catalog_entry_id: string | null;
  make: string | null;
  model: string | null;
  quoted_list_price: number | null;
  current_list_price: number | null;
  price_delta_total: number | null;
  price_change_pct: number | null;
  price_changed_at: string | null;
  price_change_source: string | null;
}

export interface ImpactSummary {
  total_quotes_affected: number;
  total_deals_affected: number;
  total_dollar_exposure: number;
}

export interface ImpactReportResponse {
  summary: ImpactSummary;
  impact_items: ImpactItem[];
}

export interface PriceFileImportResult {
  rows_parsed: number;
  rows_imported: number;
  prices_changed: number;
  quotes_flagged: number;
  errors: string[];
}

export interface PriceFileImportResponse {
  ok: boolean;
  results: PriceFileImportResult;
  impact_report?: {
    total_line_items_affected: number;
    total_quotes_affected: number;
    total_deals_affected: number;
    total_dollar_exposure: number;
    top_10_by_dollar_impact: Array<{
      quote_package_id: string;
      deal_id: string | null;
      make: string | null;
      model: string | null;
      price_delta_total: number | null;
      price_change_pct: number | null;
    }>;
  };
}

export interface RequoteDraftResult {
  ok: boolean;
  email_draft: {
    id: string | null;
    subject: string;
    body: string;
    tone: "urgent" | "professional" | "friendly";
    ai_generated: boolean;
  };
  impact: {
    line_items_affected: number;
    total_dollar_delta: number;
    manufacturers: string;
    effective_date: string;
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

/** @deprecated Legacy price-file-import lane. Do not use for Phase 1 OEM impact views. */
export async function fetchImpactReport(): Promise<ImpactReportResponse> {
  const res = await fetch(`${REQUOTE_URL}/impact`, {
    method: "GET",
    headers: await authHeadersJson(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load impact report" }));
    throw new Error((err as { error?: string }).error ?? `Failed to load (${res.status})`);
  }
  return res.json();
}

/** @deprecated Admin-only compatibility import outside Phase 1 OEM feeds. */
export async function uploadPriceFile(file: File): Promise<PriceFileImportResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(PRICE_IMPORT_URL, {
    method: "POST",
    headers: await authHeadersFormData(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Price file import failed" }));
    throw new Error((err as { error?: string }).error ?? `Import failed (${res.status})`);
  }
  return res.json();
}

/** @deprecated Draft by persisted impact ID with createRepriceDraft() for Phase 1. */
export async function draftRequote(quotePackageId: string): Promise<RequoteDraftResult> {
  const res = await fetch(`${REQUOTE_URL}/draft`, {
    method: "POST",
    headers: await authHeadersJson(),
    body: JSON.stringify({ quote_package_id: quotePackageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Requote draft failed" }));
    throw new Error((err as { error?: string }).error ?? `Requote failed (${res.status})`);
  }
  return res.json();
}

export interface BatchRequoteResult {
  ok: boolean;
  generated: number;
  failed: number;
  results: Array<{ quote_package_id: string; draft_id: string | null; error?: string }>;
}

/** @deprecated Batch legacy quote-package drafts are outside Phase 1 OEM feeds. */
export async function batchRequote(quotePackageIds: string[]): Promise<BatchRequoteResult> {
  const res = await fetch(`${REQUOTE_URL}/batch`, {
    method: "POST",
    headers: await authHeadersJson(),
    body: JSON.stringify({ quote_package_ids: quotePackageIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Batch requote failed" }));
    throw new Error((err as { error?: string }).error ?? `Batch failed (${res.status})`);
  }
  return res.json();
}

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
