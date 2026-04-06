import { supabase } from "@/lib/supabase";

const PORTAL_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal-api`;

export type PortalFleetResponse = { fleet?: Record<string, unknown>[] };
export type PortalServiceRequestsResponse = { requests?: Record<string, unknown>[] };
export type PortalPartsOrdersResponse = { orders?: Record<string, unknown>[] };
export type PortalInvoicesResponse = { invoices?: Record<string, unknown>[] };
export type PortalQuotesResponse = { quotes?: Record<string, unknown>[] };
export type PortalSubscriptionsResponse = Record<string, unknown>;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
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
  getSubscriptions: (): Promise<PortalSubscriptionsResponse> =>
    portalFetch<PortalSubscriptionsResponse>("subscriptions"),
};
