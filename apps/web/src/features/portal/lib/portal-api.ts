import { supabase } from "@/lib/supabase";
import type {
  CustomerMachineView,
  PortalRentalReturnWorkspaceView,
  PortalSubscriptionWorkspaceView,
} from "../../../../../../shared/qep-moonshot-contracts";

const PORTAL_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal-api`;

export interface PortalCanonicalStatus {
  label: string;
  source: "quote_review" | "deal_progress" | "service_job" | "portal_request" | "default";
  source_label: string;
  eta: string | null;
  last_updated_at: string | null;
  next_action?: string | null;
}

export interface PortalPartsOrderSummary {
  id: string;
  status: string;
  created_at: string | null;
  ai_suggested_pm_kit?: boolean;
  ai_suggestion_reason?: string | null;
  line_items?: unknown;
  portal_status: PortalCanonicalStatus;
}

export interface PortalActiveDeal {
  deal_id: string;
  deal_name: string;
  amount: number | null;
  expected_close_on: string | null;
  next_follow_up_at: string | null;
  quote_review_id: string | null;
  quote_review_status: string | null;
  portal_status: PortalCanonicalStatus;
}

export interface PortalQuoteSummary {
  id: string;
  deal_id: string | null;
  deal_name: string | null;
  amount: number | null;
  status: string;
  counter_notes?: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  signer_name: string | null;
  expires_at: string | null;
  quote_pdf_url?: string | null;
  quote_data?: Record<string, unknown> | null;
  portal_status: PortalCanonicalStatus;
  current_revision?: PortalQuoteRevisionDetail | null;
  revision_history?: PortalQuoteRevisionSummary[];
  compare_to_previous?: PortalQuoteRevisionCompare | null;
}

export interface PortalQuoteRevisionSummary {
  id: string;
  version_number: number;
  published_at: string;
  is_current: boolean;
  dealer_message: string | null;
  revision_summary: string | null;
  customer_request_snapshot: string | null;
}

export interface PortalQuoteRevisionDetail extends PortalQuoteRevisionSummary {
  quote_pdf_url: string | null;
  quote_data: Record<string, unknown> | null;
}

export interface PortalQuoteRevisionCompare {
  has_changes: boolean;
  price_changes: string[];
  equipment_changes: string[];
  financing_changes: string[];
  terms_changes: string[];
  dealer_message_change: string | null;
}

export type PortalInvoiceTimelineItem = {
  label: string;
  detail: string;
  at: string | null;
  tone: "blue" | "amber" | "emerald" | "red";
};

export type PortalBillingSummary = {
  open_balance: number;
  overdue_balance: number;
  subscription_invoices: number;
  payments_in_flight: number;
};

export type PortalSubscriptionBillingDetail = {
  subscription_id: string;
  plan_name: string;
  billing_period_start: string;
  billing_period_end: string;
  included_hours: number | null;
  used_hours: number | null;
  overage_hours: number | null;
  overage_charge: number | null;
  maintenance_included: boolean;
};

export type PortalServiceTimelineSummary = {
  branch_label: string | null;
  next_step: string | null;
  customer_summary: string | null;
};

export type PortalServiceRequestCard = Record<string, unknown> & {
  portal_status?: PortalCanonicalStatus | null;
  workspace_timeline?: PortalServiceTimelineSummary | null;
  photo_count?: number;
};

export type PortalFleetAssetView = CustomerMachineView;
export type PortalFleetResponse = { fleet?: PortalFleetAssetView[] };
export type PortalServiceRequestsResponse = {
  requests?: PortalServiceRequestCard[];
  open_requests?: PortalServiceRequestCard[];
  completed_requests?: PortalServiceRequestCard[];
  blocked_requests?: PortalServiceRequestCard[];
  workspace_summary?: {
    open_count: number;
    completed_count: number;
    blocked_count: number;
  };
};
export type PortalPartsOrdersResponse = { orders?: PortalPartsOrderSummary[] };
export type PortalInvoicesResponse = {
  invoices?: Array<Record<string, unknown> & {
    portal_invoice_timeline?: PortalInvoiceTimelineItem[];
    portal_subscription_billing?: PortalSubscriptionBillingDetail | null;
  }>;
  billing_summary?: PortalBillingSummary;
};
export type PortalQuotesResponse = { quotes?: PortalQuoteSummary[] };
export type PortalActiveDealsResponse = { deals?: PortalActiveDeal[] };
export type PortalSubscriptionsResponse = { subscriptions?: PortalSubscriptionWorkspaceView[] };
export type PortalRentalsResponse = { rentals?: PortalRentalReturnWorkspaceView[] };
export type PortalSettingsResponse = {
  customer?: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    notification_preferences: {
      email: boolean;
      sms: boolean;
    };
  };
  notifications?: Array<{
    id: string;
    category: "service" | "parts" | "quotes" | "fleet";
    label: string;
    detail: string;
    channel: "portal" | "email" | "sms";
    occurred_at: string;
  }>;
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  const sessionResult = await supabase.auth.getSession();
  let session = sessionResult.data.session;
  if (!session?.access_token) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session ?? null;
  }
  if (!session?.access_token) {
    throw new Error("Portal session unavailable. Sign in again to continue.");
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

async function portalFetch<T extends Record<string, unknown> = Record<string, unknown>>(
  route: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${PORTAL_API_URL}/${route}`, {
    ...options,
    headers: { ...(await getAuthHeaders()), ...options?.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (typeof parsed?.error === "string" && parsed.error.trim()) {
        message = parsed.error.trim();
      }
    } catch {
      const t = text.trim().slice(0, 240);
      if (t) message = t;
    }
    throw new Error(message);
  }
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Invalid response from portal API");
  }
}

export const portalApi = {
  getFleet: (): Promise<PortalFleetResponse> => portalFetch<PortalFleetResponse>("fleet"),
  getActiveDeals: (): Promise<PortalActiveDealsResponse> =>
    portalFetch<PortalActiveDealsResponse>("deals/active"),
  /** Wave 5D: fleet with LIVE service job state joined per equipment. */
  getFleetWithStatus: (): Promise<PortalFleetResponse> =>
    portalFetch<PortalFleetResponse>("fleet-with-status"),
  /** Wave 5D: parts purchase history grouped by machine (one-click reorder source). */
  getPartsHistory: (): Promise<{ history?: Record<string, unknown>[] }> =>
    portalFetch<{ history?: Record<string, unknown>[] }>("parts-history"),
  /** Wave 5D: document library filtered by fleet. */
  getDocuments: (fleetId?: string): Promise<{ documents?: Record<string, unknown>[] }> => {
    const qs = fleetId ? `?fleet_id=${encodeURIComponent(fleetId)}` : "";
    return portalFetch<{ documents?: Record<string, unknown>[] }>(`documents${qs}`);
  },
  getServiceRequests: (): Promise<PortalServiceRequestsResponse> =>
    portalFetch<PortalServiceRequestsResponse>("service-requests"),
  /** P1-D: customer-safe timeline for the internal job linked to this portal request. */
  getServiceRequestTimeline: (serviceRequestId: string) =>
    portalFetch<Record<string, unknown>>(`service-requests/${serviceRequestId}/timeline`),
  createServiceRequest: (data: Record<string, unknown>): Promise<Record<string, unknown>> =>
    portalFetch<Record<string, unknown>>("service-requests", { method: "POST", body: JSON.stringify(data) }),
  getPartsOrders: (): Promise<PortalPartsOrdersResponse> => portalFetch<PortalPartsOrdersResponse>("parts"),
  createPartsOrder: (data: Record<string, unknown>): Promise<Record<string, unknown>> =>
    portalFetch<Record<string, unknown>>("parts", { method: "POST", body: JSON.stringify(data) }),
  /** Grounded PM kit from job_codes.parts_template + optional LLM narrative (portal-api). */
  suggestPmKit: (fleetId: string): Promise<Record<string, unknown>> =>
    portalFetch<Record<string, unknown>>("parts/suggest-pm-kit", {
      method: "POST",
      body: JSON.stringify({ fleet_id: fleetId }),
    }),
  /** draft → submitted for parts counter (portal-api + service role). */
  submitPartsOrder: (orderId: string): Promise<Record<string, unknown>> =>
    portalFetch<Record<string, unknown>>("parts/submit", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    }),
  getInvoices: (): Promise<PortalInvoicesResponse> => portalFetch<PortalInvoicesResponse>("invoices"),
  recordInvoicePayment: (data: Record<string, unknown>): Promise<Record<string, unknown>> =>
    portalFetch<Record<string, unknown>>("invoices/pay", { method: "POST", body: JSON.stringify(data) }),
  getQuotes: (): Promise<PortalQuotesResponse> => portalFetch<PortalQuotesResponse>("quotes"),
  updateQuote: (data: Record<string, unknown>): Promise<Record<string, unknown>> =>
    portalFetch<Record<string, unknown>>("quotes", { method: "PUT", body: JSON.stringify(data) }),
  getSettings: (): Promise<PortalSettingsResponse> => portalFetch<PortalSettingsResponse>("settings"),
  updateSettings: (data: Record<string, unknown>): Promise<Record<string, unknown>> =>
    portalFetch<Record<string, unknown>>("settings", { method: "PUT", body: JSON.stringify(data) }),
  getSubscriptions: (): Promise<PortalSubscriptionsResponse> =>
    portalFetch<PortalSubscriptionsResponse>("subscriptions"),
  getRentals: (): Promise<PortalRentalsResponse> =>
    portalFetch<PortalRentalsResponse>("rentals"),
};
