import { supabase } from "@/lib/supabase";
export { getTradeValuation } from "@/features/qrm/lib/trade-walkaround-api";
import type {
  CompetitorListing,
  PortalQuoteRevisionCompare,
  PortalQuoteRevisionDraft,
  PortalQuoteRevisionPublishState,
  QuoteApprovalCaseSummary,
  QuoteApprovalConditionDraft,
  QuoteApprovalDecision,
  QuoteApprovalPolicy,
  QuoteApprovalSubmitResult,
  QuoteFinancingPreview,
  QuoteFinanceScenario,
  QuoteListItem,
  QuoteRecommendation,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

const QUOTE_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-builder-v2`;

export type QuoteListAction = "resume" | "resend" | "duplicate" | "mark_sent" | "archive" | "discard";

export interface QuotePackageSaveResponse {
  id?: string;
  deal_id?: string;
  quote_package_version_id?: string | null;
  version_number?: number | null;
  quote?: { id?: string; deal_id?: string; status?: string };
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
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string; message?: string }).error
      ?? (body as { message?: string }).message
      ?? "";
    if (res.status === 401) {
      throw new Error(
        detail
          ? `Session expired: ${detail}. Sign out and sign in again.`
          : "Session expired. Sign out and sign in again to continue.",
      );
    }
    throw new Error(detail.trim() || `Failed to list quotes (HTTP ${res.status})`);
  }
  return res.json();
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

export async function performQuoteListAction(input: {
  quotePackageId: string;
  action: Exclude<QuoteListAction, "resume" | "resend">;
}): Promise<{ ok: true; quote?: QuoteListItem | null }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/list-action`, {
    method: "POST",
    body: JSON.stringify(buildQuoteListActionPayload(input)),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string; message?: string }).error
      ?? (body as { message?: string }).message
      ?? "";
    throw new Error(detail.trim() || `Quote action failed (HTTP ${res.status})`);
  }
  return res.json() as Promise<{ ok: true; quote?: QuoteListItem | null }>;
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
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    return { ok: false, reason: "error", message: detail };
  }
  const body = (await res.json()) as {
    observations?: Array<{ score: number; outcome: "won" | "lost" | "expired" }>;
  };
  return { ok: true, observations: Array.isArray(body.observations) ? body.observations : [] };
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
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    return { ok: false, reason: "error", message: detail };
  }
  const body = (await res.json()) as {
    deals?: Array<{ factors: Array<{ label: string; weight: number }>; outcome: "won" | "lost" | "expired" }>;
  };
  return { ok: true, deals: Array.isArray(body.deals) ? body.deals : [] };
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
    const body = (await res.json()) as {
      verdicts?: Array<{ label: string; verdict: "proven" | "suspect" | "unknown" }>;
    };
    const out = new Map<string, "proven" | "suspect" | "unknown">();
    if (!Array.isArray(body.verdicts)) return out;
    for (const row of body.verdicts) {
      if (!row || typeof row.label !== "string" || row.label.length === 0) continue;
      if (row.verdict !== "proven" && row.verdict !== "suspect" && row.verdict !== "unknown") {
        continue;
      }
      out.set(row.label, row.verdict);
    }
    return out;
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
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    return { ok: false, reason: "error", message: detail };
  }
  const body = (await res.json()) as {
    audits?: Array<{
      packageId: string;
      score: number;
      outcome: "won" | "lost" | "expired";
      factors: Array<{ label: string; weight: number }>;
      capturedAt: string | null;
    }>;
  };
  return { ok: true, audits: Array.isArray(body.audits) ? body.audits : [] };
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
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string; message?: string }).error
      ?? (body as { message?: string }).message
      ?? "";
    if (res.status === 401) {
      throw new Error(
        detail
          ? `Session expired: ${detail}. Sign out and sign in again.`
          : "Session expired. Sign out and sign in again to continue.",
      );
    }
    throw new Error(detail.trim() || `AI recommendation failed (HTTP ${res.status})`);
  }
  const json = await res.json();
  return (json?.recommendation ?? json) as QuoteRecommendation;
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

export function normalizeQuoteFinanceScenario(raw: Record<string, unknown>): QuoteFinanceScenario {
  const type = firstString(raw.type, "cash") as QuoteFinanceScenario["type"];
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
    label,
    monthlyPayment,
    apr: rate,
    termMonths,
    totalCost,
    rate,
    lender,
  };
}

export function normalizeQuoteFinancingPreview(raw: Record<string, unknown> | null | undefined): QuoteFinancingPreview {
  const scenariosRaw = Array.isArray(raw?.scenarios) ? raw.scenarios : [];
  const applicableRaw = Array.isArray((raw?.incentives as { applicable?: unknown[] } | undefined)?.applicable)
    ? ((raw?.incentives as { applicable?: unknown[] }).applicable ?? [])
    : [];
  return {
    scenarios: scenariosRaw
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map((row) => normalizeQuoteFinanceScenario(row)),
    margin_check: raw?.margin_check && typeof raw.margin_check === "object"
      ? {
          flagged: Boolean((raw.margin_check as { flagged?: unknown }).flagged),
          message: firstString((raw.margin_check as { message?: unknown }).message) ?? undefined,
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
          total_savings: numOrNull((raw.incentives as { total_savings?: unknown }).total_savings) ?? 0,
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
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string; message?: string }).error
      ?? (body as { message?: string }).message
      ?? "";
    throw new Error(detail.trim() || `Failed to save quote (HTTP ${res.status})`);
  }
  return res.json();
}

export async function sendQuotePackage(quotePackageId: string): Promise<{ sent: boolean; to_email: string }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/send-package`, {
    method: "POST",
    body: JSON.stringify({ quote_package_id: quotePackageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to send quote" }));
    throw new Error((err as { error?: string }).error ?? "Failed to send quote");
  }
  return res.json() as Promise<{ sent: boolean; to_email: string }>;
}

export async function submitQuoteForApproval(quotePackageId: string): Promise<QuoteApprovalSubmitResult> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/submit-approval`, {
    method: "POST",
    body: JSON.stringify({ quote_package_id: quotePackageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to submit quote for approval" }));
    throw new Error((err as { error?: string }).error ?? "Failed to submit quote for approval");
  }
  const body = await res.json() as Record<string, unknown>;
  return {
    approvalCaseId: String(body.approval_case_id ?? ""),
    approvalId: String(body.approval_id ?? ""),
    quotePackageVersionId: String(body.quote_package_version_id ?? ""),
    versionNumber: Number(body.version_number ?? 0) || 0,
    status: "pending_approval",
    branchName: typeof body.branch_name === "string" ? body.branch_name : null,
    assignedToName: typeof body.assigned_to_name === "string" ? body.assigned_to_name : null,
    routeMode: (typeof body.route_mode === "string" ? body.route_mode : "manager_queue") as QuoteApprovalSubmitResult["routeMode"],
    alreadyPending: body.already_pending === true,
  };
}

export async function getQuoteApprovalCase(quotePackageId: string): Promise<QuoteApprovalCaseSummary | null> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/approval-case?quote_package_id=${encodeURIComponent(quotePackageId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load quote approval case" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load quote approval case");
  }
  const body = await res.json() as { approval_case?: QuoteApprovalCaseSummary | null };
  return body.approval_case ?? null;
}

export async function decideQuoteApprovalCase(input: {
  approvalCaseId: string;
  decision: QuoteApprovalDecision;
  note?: string | null;
  conditions?: QuoteApprovalConditionDraft[];
}): Promise<QuoteApprovalCaseSummary | null> {
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
    const err = await res.json().catch(() => ({ error: "Failed to decide quote approval case" }));
    throw new Error((err as { error?: string }).error ?? "Failed to decide quote approval case");
  }
  const body = await res.json() as { approval_case?: QuoteApprovalCaseSummary | null };
  return body.approval_case ?? null;
}

export async function getQuoteApprovalPolicy(): Promise<QuoteApprovalPolicy> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/approval-policy`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load quote approval policy" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load quote approval policy");
  }
  const body = await res.json() as { policy: QuoteApprovalPolicy };
  return body.policy;
}

export async function saveQuoteApprovalPolicy(policy: Partial<QuoteApprovalPolicy>): Promise<QuoteApprovalPolicy> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/approval-policy`, {
    method: "POST",
    body: JSON.stringify({
      branch_manager_min_margin_pct: policy.branchManagerMinMarginPct,
      standard_margin_floor_pct: policy.standardMarginFloorPct,
      branch_manager_max_quote_amount: policy.branchManagerMaxQuoteAmount,
      submit_sla_hours: policy.submitSlaHours,
      escalation_sla_hours: policy.escalationSlaHours,
      owner_escalation_role: policy.ownerEscalationRole,
      named_branch_sales_manager_primary: policy.namedBranchSalesManagerPrimary,
      named_branch_general_manager_fallback: policy.namedBranchGeneralManagerFallback,
      allowed_condition_types: policy.allowedConditionTypes,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to save quote approval policy" }));
    throw new Error((err as { error?: string }).error ?? "Failed to save quote approval policy");
  }
  const body = await res.json() as { policy: QuoteApprovalPolicy };
  return body.policy;
}

export async function saveQuoteSignature(data: {
  quote_package_id: string;
  deal_id?: string;
  signer_name: string;
  signer_email?: string | null;
  signature_png_base64?: string | null;
}) {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/sign`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to save signature" }));
    throw new Error((err as { error?: string }).error ?? "Failed to save signature");
  }
  return res.json();
}

export async function getPortalRevision(dealId: string): Promise<PortalRevisionEnvelope> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision?deal_id=${encodeURIComponent(dealId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load portal revision" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load portal revision");
  }
  return res.json();
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
    const err = await res.json().catch(() => ({ error: "Failed to save portal revision draft" }));
    throw new Error((err as { error?: string }).error ?? "Failed to save portal revision draft");
  }
  return res.json();
}

export async function submitPortalRevision(data: {
  deal_id: string;
}): Promise<{ draft: PortalQuoteRevisionDraft; publishState: PortalQuoteRevisionPublishState }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision/submit`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to submit portal revision" }));
    throw new Error((err as { error?: string }).error ?? "Failed to submit portal revision");
  }
  return res.json();
}

export async function returnPortalRevisionToDraft(data: {
  deal_id: string;
}): Promise<{ draft: PortalQuoteRevisionDraft; publishState: PortalQuoteRevisionPublishState }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision/return-to-draft`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to return revision to draft" }));
    throw new Error((err as { error?: string }).error ?? "Failed to return revision to draft");
  }
  return res.json();
}

export async function publishPortalRevision(data: {
  deal_id: string;
}): Promise<{ draft: PortalQuoteRevisionDraft | null; publishState: PortalQuoteRevisionPublishState }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/portal-revision/publish`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to publish portal revision" }));
    throw new Error((err as { error?: string }).error ?? "Failed to publish portal revision");
  }
  return res.json();
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
): Record<string, unknown> {
  return {
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
      make: item.make,
      model: item.model,
      year: item.year,
      price: item.unitPrice,
    })),
    attachments_included: draft.attachments.map((item) => ({
      name: item.title,
      price: item.unitPrice,
    })),
    trade_in_valuation_id: draft.tradeValuationId,
    trade_allowance: draft.tradeAllowance,
    financing_scenarios: financeScenarios.map((scenario) => ({
      type: scenario.type,
      label: scenario.label,
      term_months: scenario.termMonths ?? null,
      apr: scenario.apr ?? scenario.rate ?? null,
      monthly_payment: scenario.monthlyPayment ?? null,
      total_cost: scenario.totalCost ?? null,
      lender: scenario.lender ?? null,
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
    margin_amount: computed.marginAmount,
    margin_pct: computed.marginPct,
    ai_recommendation: draft.recommendation,
    entry_mode: draft.entryMode,
    status: "draft",
    customer_name: draft.customerName || null,
    customer_company: draft.customerCompany || null,
    customer_phone: draft.customerPhone || null,
    customer_email: draft.customerEmail || null,
    originating_log_id: draft.originatingLogId ?? null,
    win_probability_snapshot: winProbabilitySnapshot ?? null,
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
  if (!sanitized) return [];

  const { data, error } = await supabase
    .from("qb_equipment_models")
    .select(
      `id, model_code, family, series, name_display, model_year, list_price_cents,
       brand:qb_brands!brand_id ( id, code, name, category )`,
    )
    .eq("active", true)
    .is("deleted_at", null)
    .or(
      `model_code.ilike.%${sanitized}%,family.ilike.%${sanitized}%,series.ilike.%${sanitized}%,name_display.ilike.%${sanitized}%`,
    )
    .order("name_display", { ascending: true })
    .limit(20);
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
      make,
      model: row.model_code ?? "",
      year: row.model_year ?? null,
      category: row.family ?? brand?.category ?? null,
      list_price: row.list_price_cents != null ? Number(row.list_price_cents) / 100 : null,
      stock_number: null as string | null,
      condition: "new" as const,
      attachments: compatibleAttachments,
    };
  });
}
