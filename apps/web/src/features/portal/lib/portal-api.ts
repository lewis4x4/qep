import { supabase } from "@/lib/supabase";

const PORTAL_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal-api`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

async function portalFetch(route: string, options?: RequestInit) {
  const res = await fetch(`${PORTAL_API_URL}/${route}`, {
    ...options,
    headers: { ...(await getAuthHeaders()), ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const portalApi = {
  getFleet: () => portalFetch("fleet"),
  getServiceRequests: () => portalFetch("service-requests"),
  createServiceRequest: (data: Record<string, unknown>) =>
    portalFetch("service-requests", { method: "POST", body: JSON.stringify(data) }),
  getPartsOrders: () => portalFetch("parts"),
  createPartsOrder: (data: Record<string, unknown>) =>
    portalFetch("parts", { method: "POST", body: JSON.stringify(data) }),
  getInvoices: () => portalFetch("invoices"),
  getQuotes: () => portalFetch("quotes"),
  updateQuote: (data: Record<string, unknown>) =>
    portalFetch("quotes", { method: "PUT", body: JSON.stringify(data) }),
  getSubscriptions: () => portalFetch("subscriptions"),
};
