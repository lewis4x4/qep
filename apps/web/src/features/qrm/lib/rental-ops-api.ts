import { supabase } from "@/lib/supabase";

const RENTAL_OPS_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rental-ops`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const sessionResult = await supabase.auth.getSession();
  let session = sessionResult.data.session;
  if (!session?.access_token) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session ?? null;
  }
  if (!session?.access_token) {
    throw new Error("Rental ops session unavailable. Sign in again to continue.");
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

async function rentalOpsFetch<T extends Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(RENTAL_OPS_API_URL, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (typeof parsed.error === "string" && parsed.error.trim()) message = parsed.error.trim();
    } catch {
      const fallback = text.trim().slice(0, 240);
      if (fallback) message = fallback;
    }
    throw new Error(message);
  }
  return text.trim() ? JSON.parse(text) as T : {} as T;
}

export const rentalOpsApi = {
  approveBooking: (data: {
    contract_id: string;
    equipment_id: string;
    branch_id?: string | null;
    dealer_response?: string | null;
    deposit_amount?: number;
  }) =>
    rentalOpsFetch<{ contract: Record<string, unknown> }>({
      action: "approve_booking",
      ...data,
    }),
  declineBooking: (data: { contract_id: string; dealer_response?: string | null }) =>
    rentalOpsFetch<{ contract: Record<string, unknown> }>({
      action: "decline_booking",
      ...data,
    }),
  approveExtension: (data: {
    extension_id: string;
    dealer_response?: string | null;
    additional_charge?: number;
  }) =>
    rentalOpsFetch<{ extension: Record<string, unknown> }>({
      action: "approve_extension",
      ...data,
    }),
  declineExtension: (data: { extension_id: string; dealer_response?: string | null }) =>
    rentalOpsFetch<{ extension: Record<string, unknown> }>({
      action: "decline_extension",
      ...data,
    }),
};
