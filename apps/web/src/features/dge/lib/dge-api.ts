import { supabase } from "@/lib/supabase";
import type {
  CustomerProfileResponse,
  MarketValuationRequest,
  MarketValuationResult,
} from "../types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface EdgeErrorResponse {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

function extractErrorMessage(payload: EdgeErrorResponse, fallback: string): string {
  if (payload.error?.message && payload.error.message.trim().length > 0) {
    return payload.error.message;
  }
  return fallback;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in is required before loading DGE insights.");
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
}

export async function fetchMarketValuation(
  request: MarketValuationRequest,
): Promise<MarketValuationResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/market-valuation`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(request),
  });

  const payload = await response.json() as MarketValuationResult & EdgeErrorResponse;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, "Market valuation request failed."));
  }

  if (payload.error) {
    throw new Error(extractErrorMessage(payload, "Market valuation request failed."));
  }

  return payload;
}

export async function fetchCustomerProfile(params: {
  customerProfileId?: string;
  email?: string;
  hubspotContactId?: string;
  intellidealerCustomerId?: string;
  includeFleet?: boolean;
}): Promise<CustomerProfileResponse | null> {
  const query = new URLSearchParams();
  if (params.customerProfileId) query.set("customer_profiles_extended_id", params.customerProfileId);
  if (params.email) query.set("email", params.email);
  if (params.hubspotContactId) query.set("hubspot_contact_id", params.hubspotContactId);
  if (params.intellidealerCustomerId) {
    query.set("intellidealer_customer_id", params.intellidealerCustomerId);
  }
  if (params.includeFleet) query.set("include_fleet", "true");

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/customer-profile?${query.toString()}`,
    {
      method: "GET",
      headers: await getAuthHeaders(),
    }
  );

  if (response.status === 404) {
    return null;
  }

  const payload = await response.json() as CustomerProfileResponse & EdgeErrorResponse;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, "Customer profile request failed."));
  }

  return payload;
}
