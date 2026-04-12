import { supabase } from "@/lib/supabase";
export { getTradeValuation } from "@/features/qrm/lib/trade-walkaround-api";
import type {
  PortalQuoteRevisionCompare,
  PortalQuoteRevisionDraft,
  PortalQuoteRevisionPublishState,
  QuoteFinancingPreview,
  QuoteFinanceScenario,
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

async function getAuthHeaders(): Promise<Record<string, string>> {
  const sessionResult = await supabase.auth.getSession();
  let session = sessionResult.data.session;
  if (!session?.access_token) {
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

export async function getQuoteForDeal(dealId: string) {
  const res = await fetch(`${QUOTE_API_URL}?deal_id=${dealId}`, {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load quote");
  return res.json();
}

export async function getAiEquipmentRecommendation(jobDescription: string): Promise<QuoteRecommendation> {
  const res = await fetch(`${QUOTE_API_URL}/recommend`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ job_description: jobDescription }),
  });
  if (!res.ok) throw new Error("AI recommendation failed");
  return res.json();
}

export async function calculateFinancing(
  totalAmount: number,
  marginPct?: number,
  manufacturer?: string,
): Promise<QuoteFinancingPreview> {
  const res = await fetch(`${QUOTE_API_URL}/calculate`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ total_amount: totalAmount, margin_pct: marginPct, manufacturer }),
  });
  if (!res.ok) throw new Error("Financing calculation failed");
  return res.json();
}

export async function saveQuotePackage(data: Record<string, unknown>): Promise<QuotePackageSaveResponse> {
  const res = await fetch(`${QUOTE_API_URL}/save`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save quote");
  return res.json();
}

export async function sendQuotePackage(quotePackageId: string): Promise<{ sent: boolean; to_email: string }> {
  const res = await fetch(`${QUOTE_API_URL}/send-package`, {
    method: "POST",
    headers: await getAuthHeaders(),
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
  const res = await fetch(`${QUOTE_API_URL}/sign`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to save signature" }));
    throw new Error((err as { error?: string }).error ?? "Failed to save signature");
  }
  return res.json();
}

export async function getPortalRevision(dealId: string): Promise<PortalRevisionEnvelope> {
  const res = await fetch(`${QUOTE_API_URL}/portal-revision?deal_id=${encodeURIComponent(dealId)}`, {
    headers: await getAuthHeaders(),
  });
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
  const res = await fetch(`${QUOTE_API_URL}/portal-revision/draft`, {
    method: "POST",
    headers: await getAuthHeaders(),
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
  const res = await fetch(`${QUOTE_API_URL}/portal-revision/submit`, {
    method: "POST",
    headers: await getAuthHeaders(),
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
  const res = await fetch(`${QUOTE_API_URL}/portal-revision/return-to-draft`, {
    method: "POST",
    headers: await getAuthHeaders(),
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
  const res = await fetch(`${QUOTE_API_URL}/portal-revision/publish`, {
    method: "POST",
    headers: await getAuthHeaders(),
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
): Record<string, unknown> {
  return {
    deal_id: draft.dealId,
    contact_id: draft.contactId || undefined,
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
    .from("catalog_entries")
    .select("*")
    .eq("is_available", true)
    .or(`make.ilike.%${sanitized}%,model.ilike.%${sanitized}%,category.ilike.%${sanitized}%`)
    .order("make", { ascending: true })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}
