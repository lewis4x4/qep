import { supabase } from "@/lib/supabase";

const QUOTE_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-builder-v2`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface DealRoomEquipmentLine {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  price?: number | null;
  title?: string | null;
}

export interface DealRoomAttachment {
  name?: string | null;
  price?: number | null;
}

export interface DealRoomFinanceScenario {
  label?: string | null;
  type?: string | null;
  term_months?: number | null;
  apr?: number | null;
  rate?: number | null;
  monthly_payment?: number | null;
  total_cost?: number | null;
  lender?: string | null;
}

export interface DealRoomRecommendation {
  machine?: string | null;
  reasoning?: string | null;
  attachments?: string[] | null;
  alternative?: {
    machine?: string | null;
    reasoning?: string | null;
    attachments?: string[] | null;
    whyNotChosen?: string | null;
  } | null;
  jobConsiderations?: string[] | null;
  jobFacts?: Array<{ label: string; value: string }> | null;
  transcriptHighlights?: Array<{ quote: string; supports: string }> | null;
}

export interface DealRoomQuote {
  id: string | null;
  quote_number: string | null;
  status: string;
  customer_name: string | null;
  customer_company: string | null;
  branch_slug: string | null;
  equipment: DealRoomEquipmentLine[];
  attachments_included: DealRoomAttachment[];
  subtotal: number | null;
  equipment_total: number | null;
  attachment_total: number | null;
  discount_total: number | null;
  trade_credit: number | null;
  net_total: number | null;
  tax_total: number | null;
  cash_down: number | null;
  amount_financed: number | null;
  customer_total: number | null;
  financing_scenarios: DealRoomFinanceScenario[];
  selected_finance_scenario: string | null;
  ai_recommendation: DealRoomRecommendation | null;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
}

export interface DealRoomBranch {
  name?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  doc_footer_text?: string | null;
}

export interface DealRoomPayload {
  quote: DealRoomQuote;
  branch: DealRoomBranch | null;
}

export interface DealRoomCompatibleAttachment {
  id: string | null;
  name: string | null;
  category: string | null;
  attachment_type: string | null;
  price: number | null;
  universal: boolean;
}

export interface DealRoomAttachmentsPayload {
  attachments: DealRoomCompatibleAttachment[];
}

export interface TradeEstimateRequest {
  make: string;
  model: string;
  year?: number | null;
  hours?: number | null;
}

export type TradeEstimatePayload =
  | {
      status: "ok";
      range: { low: number; mid: number; high: number };
      suggestedCredit: number;
      comps: number;
      hoursAdjustment: number;
    }
  | {
      status: "no_data";
      message: string;
    };

export interface ConciergeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PublicAcceptRequest {
  signerName: string;
  signerEmail?: string | null;
  signatureDataUrl: string;
  customerConfiguration: Record<string, unknown>;
}

export interface PublicAcceptResponse {
  signature_id: string | null;
  signed_at: string | null;
  status: string;
  document_hash: string;
}

export async function acceptPublicQuote(
  token: string,
  input: PublicAcceptRequest,
): Promise<PublicAcceptResponse> {
  const res = await fetch(`${QUOTE_FN_URL}/public-accept?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({
      signer_name: input.signerName,
      signer_email: input.signerEmail ?? null,
      signature_data_url: input.signatureDataUrl,
      customer_configuration: input.customerConfiguration,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}

export async function sendConciergeChat(
  token: string,
  message: string,
  history: ConciergeMessage[],
): Promise<{ reply: string }> {
  const res = await fetch(`${QUOTE_FN_URL}/public-chat?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}

export async function fetchPublicTradeEstimate(
  token: string,
  input: TradeEstimateRequest,
): Promise<TradeEstimatePayload> {
  const res = await fetch(`${QUOTE_FN_URL}/public-trade-estimate?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({
      make: input.make,
      model: input.model,
      year: input.year ?? null,
      hours: input.hours ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}

export async function fetchPublicDealRoomAttachments(token: string): Promise<DealRoomAttachmentsPayload> {
  const res = await fetch(`${QUOTE_FN_URL}/public-attachments?token=${encodeURIComponent(token)}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}

// Public deal-room read. No user auth — the opaque token IS the
// authorization. The anon key is still required as the function
// gateway's API key, but it does not identify a user.
export async function fetchPublicDealRoom(token: string): Promise<DealRoomPayload> {
  const res = await fetch(`${QUOTE_FN_URL}/public?token=${encodeURIComponent(token)}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}

// Rep-authenticated share-token issuance. Server verifies the caller has
// RLS-level write access to the quote before rotating the token.
export async function issueShareToken(quotePackageId: string): Promise<{ token: string }> {
  const session = (await supabase.auth.getSession()).data.session;
  const authHeader = session?.access_token ? `Bearer ${session.access_token}` : `Bearer ${ANON_KEY}`;
  const res = await fetch(`${QUOTE_FN_URL}/share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: authHeader,
    },
    body: JSON.stringify({ quote_package_id: quotePackageId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}
