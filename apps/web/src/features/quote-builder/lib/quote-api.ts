import { supabase } from "@/lib/supabase";
export { getTradeValuation } from "@/features/qrm/lib/trade-walkaround-api";
import type {
  CompetitorListing,
  PortalQuoteRevisionCompare,
  PortalQuoteRevisionDraft,
  PortalQuoteRevisionPublishState,
  QuoteFinancingPreview,
  QuoteFinanceScenario,
  QuoteListItem,
  QuoteRecommendation,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

const QUOTE_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-builder-v2`;

export interface QuotePackageSaveResponse {
  id?: string;
  quote?: { id?: string };
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
  const qs = new URLSearchParams();
  if (params?.status && params.status !== "all") qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/list${suffix}`);
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

export async function getCompetitorListings(make: string, model?: string): Promise<{ listings: CompetitorListing[] }> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/competitors`, {
    method: "POST",
    body: JSON.stringify({ make, model }),
  });
  if (!res.ok) return { listings: [] };
  return res.json();
}

export async function getQuoteForDeal(dealId: string) {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}?deal_id=${dealId}`);
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

export async function calculateFinancing(
  totalAmount: number,
  marginPct?: number,
  manufacturer?: string,
): Promise<QuoteFinancingPreview> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/calculate`, {
    method: "POST",
    body: JSON.stringify({ total_amount: totalAmount, margin_pct: marginPct, manufacturer }),
  });
  if (!res.ok) throw new Error("Financing calculation failed");
  return res.json();
}

export async function saveQuotePackage(data: Record<string, unknown>): Promise<QuotePackageSaveResponse> {
  const res = await fetchWithSessionRetry(`${QUOTE_API_URL}/save`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save quote");
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
    netTotal: number;
    marginAmount: number;
    marginPct: number;
  },
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
    equipment_total: computed.equipmentTotal,
    attachment_total: computed.attachmentTotal,
    subtotal: computed.subtotal,
    trade_credit: draft.tradeAllowance,
    net_total: computed.netTotal,
    margin_amount: computed.marginAmount,
    margin_pct: computed.marginPct,
    ai_recommendation: draft.recommendation,
    entry_mode: draft.entryMode,
    status: "ready",
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
    netTotal: number;
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
      lender: scenario.lender ?? null,
    })),
    terms: ["Subject to dealership approval and final document review."],
    subtotal: computed.subtotal,
    trade_allowance: draft.tradeAllowance,
    net_total: computed.netTotal,
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

  return (data ?? []).map((row) => {
    const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
    const make = brand?.name ?? row.name_display?.split(" ")[0] ?? "";
    return {
      id: row.id,
      make,
      model: row.model_code ?? "",
      year: row.model_year ?? null,
      category: row.family ?? brand?.category ?? null,
      list_price: row.list_price_cents != null ? Number(row.list_price_cents) / 100 : null,
      stock_number: null as string | null,
      condition: "new" as const,
      attachments: [] as Array<{ name: string; price: number }>,
    };
  });
}
