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
  createContract: (data: {
    qrm_company_id: string;
    qrm_contact_id?: string | null;
    contract_type?: "reservation" | "rental" | "demo" | "loaner";
    equipment_id?: string | null;
    branch_id?: string | null;
    start_date: string;
    end_date: string;
    daily_rate?: number | null;
    weekly_rate?: number | null;
    monthly_rate?: number | null;
    delivery_mode?: "pickup" | "delivery";
    dealer_notes?: string | null;
  }) =>
    rentalOpsFetch({
      action: "create_contract",
      ...data,
    }).then((payload) => ({ contract: requireRentalOpsObjectPayload(payload, "contract") })),
  exchangeLine: (data: {
    contract_id: string;
    line_id: string;
    new_equipment_id: string;
    rate_continuous: boolean;
    return_meter_hours?: number | null;
    outbound_meter_hours?: number | null;
    substitution_reason?: string | null;
  }) =>
    rentalOpsFetch({
      action: "exchange_line",
      ...data,
    }).then((payload) => ({ newLine: requireRentalOpsObjectPayload(payload, "new_line") })),
  codeLineReturn: (data: {
    line_id: string;
    return_code: "returned" | "off_rent" | "hold";
    return_meter_hours?: number | null;
  }) =>
    rentalOpsFetch({
      action: "code_line_return",
      ...data,
    }).then((payload) => ({ line: requireRentalOpsObjectPayload(payload, "line") })),
  releaseHold: (data: { line_id: string }) =>
    rentalOpsFetch({
      action: "release_hold",
      ...data,
    }).then((payload) => ({ line: requireRentalOpsObjectPayload(payload, "line") })),
  disposeDamage: (data: {
    return_id: string;
    disposition: "customer_billable" | "warranty" | "internal_wear" | "dispute";
    notes?: string | null;
    /** Dollars from the yard wizard — converted to cents server-side when cents omitted. */
    damage_charge_cents?: number | null;
    fuel_charge_cents?: number | null;
    cleaning_charge_cents?: number | null;
    environmental_fee_cents?: number | null;
  }) => rentalOpsFetch({ action: "dispose_damage", ...data }),
  /** L9.5: issue the customer-facing rental quote (share link + optional email). */
  issueRentalQuote: (data: {
    contract_id: string;
    override_rate_floor?: boolean;
    customer_email?: string | null;
  }) =>
    rentalOpsFetch({ action: "issue_rental_quote", ...data }) as Promise<{
      contract_id: string;
      lifecycle_state: string;
      share_url: string;
      email_status: string;
    }>,
  /** Close a returned contract after the final invoice posts (or hard-close). */
  closeContract: (data: {
    contract_id: string;
    hard_close?: boolean;
    hard_close_reason?: string | null;
  }) =>
    rentalOpsFetch({ action: "close_contract", ...data }).then((payload) => ({
      contract: requireRentalOpsObjectPayload(payload, "contract"),
    })),
  /** L9.3: RPO conversion — creates (or returns) the deal for this contract. */
  convertRpoToDeal: (data: { contract_id: string }) =>
    rentalOpsFetch({ action: "convert_rpo_to_deal", ...data }) as Promise<{
      deal_id: string;
      created: boolean;
      warning?: string;
    }>,
  startCheckoutInspection: (data: { contract_id: string }) =>
    rentalOpsFetch({ action: "start_checkout_inspection", ...data })
      .then((payload) => ({ run: requireRentalOpsObjectPayload(payload, "run") })),
  completeCheckoutInspection: (data: {
    run_id: string;
    machine_hours?: number | null;
    damage_found?: boolean;
    damage_description?: string | null;
  }) =>
    rentalOpsFetch({ action: "complete_checkout_inspection", ...data })
      .then((payload) => ({ run: requireRentalOpsObjectPayload(payload, "run") })),
  checkOutContract: (data: { contract_id: string; equipment_id?: string | null; override_rate_floor?: boolean; override_credit_hold?: boolean; override_credit_hold_reason?: string | null }) =>
    rentalOpsFetch({ action: "check_out_contract", ...data })
      .then((payload) => ({ contract: requireRentalOpsObjectPayload(payload, "contract") })),
  approveBooking: (data: {
    contract_id: string;
    equipment_id: string;
    branch_id?: string | null;
    dealer_response?: string | null;
    deposit_amount?: number;
    override_rate_floor?: boolean;
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
