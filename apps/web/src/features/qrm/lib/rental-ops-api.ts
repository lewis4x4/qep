import { supabase } from "@/lib/supabase";

const RENTAL_OPS_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rental-ops`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRentalOpsJson(text: string): unknown {
  return JSON.parse(text);
}

export function normalizeRentalOpsErrorMessage(text: string, status: number): string {
  let message = `Request failed (${status})`;
  try {
    const parsed = parseRentalOpsJson(text);
    if (isRecord(parsed) && typeof parsed.error === "string" && parsed.error.trim()) {
      message = parsed.error.trim();
    }
  } catch {
    const fallback = text.trim().slice(0, 240);
    if (fallback) message = fallback;
  }
  return message;
}

export function normalizeRentalOpsSuccessPayload(text: string): Record<string, unknown> {
  if (!text.trim()) return {};

  let parsed: unknown;
  try {
    parsed = parseRentalOpsJson(text);
  } catch {
    throw new Error("Rental ops returned malformed JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Rental ops returned an invalid JSON payload.");
  }
  return parsed;
}

export function requireRentalOpsObjectPayload(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (!isRecord(value)) {
    throw new Error(`Rental ops response is missing a valid '${key}' object.`);
  }
  return value;
}

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

async function rentalOpsFetch(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(RENTAL_OPS_API_URL, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(normalizeRentalOpsErrorMessage(text, res.status));
  }
  return normalizeRentalOpsSuccessPayload(text);
}

export const rentalOpsApi = {
  approveBooking: (data: {
    contract_id: string;
    equipment_id: string;
    branch_id?: string | null;
    dealer_response?: string | null;
    deposit_amount?: number;
  }) =>
    rentalOpsFetch({
      action: "approve_booking",
      ...data,
    }).then((payload) => ({ contract: requireRentalOpsObjectPayload(payload, "contract") })),
  declineBooking: (data: { contract_id: string; dealer_response?: string | null }) =>
    rentalOpsFetch({
      action: "decline_booking",
      ...data,
    }).then((payload) => ({ contract: requireRentalOpsObjectPayload(payload, "contract") })),
  approveExtension: (data: {
    extension_id: string;
    dealer_response?: string | null;
    additional_charge?: number;
  }) =>
    rentalOpsFetch({
      action: "approve_extension",
      ...data,
    }).then((payload) => ({ extension: requireRentalOpsObjectPayload(payload, "extension") })),
  declineExtension: (data: { extension_id: string; dealer_response?: string | null }) =>
    rentalOpsFetch({
      action: "decline_extension",
      ...data,
    }).then((payload) => ({ extension: requireRentalOpsObjectPayload(payload, "extension") })),
};
