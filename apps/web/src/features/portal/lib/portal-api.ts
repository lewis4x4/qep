import { supabase } from "@/lib/supabase";

const PORTAL_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal-api`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- portal-api returns heterogeneous JSON payloads
async function portalFetch(route: string, options?: RequestInit): Promise<any> {
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
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error("Invalid response from portal API");
  }
}

export const portalApi = {
  getFleet: () => portalFetch("fleet"),
  getServiceRequests: () => portalFetch("service-requests"),
  /** P1-D: customer-safe timeline for the internal job linked to this portal request. */
  getServiceRequestTimeline: (serviceRequestId: string) =>
    portalFetch(`service-requests/${serviceRequestId}/timeline`),
  createServiceRequest: (data: Record<string, unknown>) =>
    portalFetch("service-requests", { method: "POST", body: JSON.stringify(data) }),
  getPartsOrders: () => portalFetch("parts"),
  createPartsOrder: (data: Record<string, unknown>) =>
    portalFetch("parts", { method: "POST", body: JSON.stringify(data) }),
  /** Grounded PM kit from job_codes.parts_template + optional LLM narrative (portal-api). */
  suggestPmKit: (fleetId: string) =>
    portalFetch("parts/suggest-pm-kit", {
      method: "POST",
      body: JSON.stringify({ fleet_id: fleetId }),
    }),
  /** draft → submitted for parts counter (portal-api + service role). */
  submitPartsOrder: (orderId: string) =>
    portalFetch("parts/submit", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    }),
  getInvoices: () => portalFetch("invoices"),
  recordInvoicePayment: (data: Record<string, unknown>) =>
    portalFetch("invoices/pay", { method: "POST", body: JSON.stringify(data) }),
  getQuotes: () => portalFetch("quotes"),
  updateQuote: (data: Record<string, unknown>) =>
    portalFetch("quotes", { method: "PUT", body: JSON.stringify(data) }),
  getSubscriptions: () => portalFetch("subscriptions"),
};
