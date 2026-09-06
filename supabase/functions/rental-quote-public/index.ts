/**
 * L9.5 — public rental-quote endpoint (RF-025).
 *
 * The share_token on rental_contracts (m809) is the SOLE authorization,
 * mirroring the equipment deal-room model (quote_packages.share_token,
 * /q/:token): RLS stays intact and this function serves a customer-safe
 * subset via the admin client.
 *
 *   POST { action: "read", token }
 *     → quote terms (rates, dates, unit, dealer notes) + signature state.
 *   POST { action: "sign", token, signer_name, signature_data_url }
 *     → writes rental_contract_signatures (signed_via 'share_link'),
 *       stamps native_signature_id, freezes agreed_* from estimate_*, and
 *       drives lifecycle quoted → reserved (the m769 guard enforces the
 *       customer anchor; the m809 trigger emits rental.quote.won).
 *
 * Deployed with verify_jwt=false — the token is the credential. Rate
 * governance happens at ISSUE time (rental-ops issue_rental_quote runs
 * the M4.1 floor); a customer signing the quoted price is never blocked
 * by the floor.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableJson(v)]),
    );
  }
  return value;
}

async function canonicalizeAndHash(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(stableJson(value)));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || null;
}

interface QuoteContractRow {
  id: string;
  workspace_id: string;
  contract_number: string | null;
  lifecycle_state: string;
  status: string | null;
  qrm_company_id: string | null;
  portal_customer_id: string | null;
  equipment_id: string | null;
  requested_start_date: string | null;
  requested_end_date: string | null;
  estimate_daily_rate: number | null;
  estimate_weekly_rate: number | null;
  estimate_monthly_rate: number | null;
  agreed_daily_rate: number | null;
  agreed_weekly_rate: number | null;
  agreed_monthly_rate: number | null;
  deposit_required: boolean | null;
  deposit_amount: number | null;
  delivery_mode: string | null;
  dealer_notes: string | null;
  requested_category: string | null;
  requested_make: string | null;
  requested_model: string | null;
  native_signature_id: string | null;
  native_signed_at: string | null;
  native_signer_name: string | null;
  rpo_eligible: boolean | null;
  rpo_purchase_price_cents: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS });
  }
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body: { action?: string; token?: string; signer_name?: string; signature_data_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length < 16) {
    return json(400, { error: "token required" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false },
  });

  const { data: contract, error: contractError } = await admin
    .from("rental_contracts")
    .select(
      "id, workspace_id, contract_number, lifecycle_state, status, qrm_company_id, portal_customer_id, equipment_id, requested_start_date, requested_end_date, estimate_daily_rate, estimate_weekly_rate, estimate_monthly_rate, agreed_daily_rate, agreed_weekly_rate, agreed_monthly_rate, deposit_required, deposit_amount, delivery_mode, dealer_notes, requested_category, requested_make, requested_model, native_signature_id, native_signed_at, native_signer_name, rpo_eligible, rpo_purchase_price_cents",
    )
    .eq("share_token", token)
    .is("deleted_at", null)
    .maybeSingle();
  if (contractError) return json(500, { error: "lookup failed" });
  if (!contract) return json(404, { error: "quote not found" });
  const row = contract as unknown as QuoteContractRow;

  interface EquipmentRow {
    make: string | null;
    model: string | null;
    year: number | null;
    name: string | null;
  }
  let equipment: EquipmentRow | null = null;
  if (row.equipment_id) {
    const { data: unit } = await admin
      .from("qrm_equipment")
      .select("make, model, year, name")
      .eq("id", row.equipment_id)
      .maybeSingle();
    equipment = (unit as EquipmentRow | null) ?? null;
  }

  let companyName: string | null = null;
  if (row.qrm_company_id) {
    const { data: company } = await admin
      .from("qrm_companies")
      .select("name")
      .eq("id", row.qrm_company_id)
      .maybeSingle();
    companyName = (company?.name as string | undefined) ?? null;
  }

  const quotePayload = {
    contract_number: row.contract_number,
    lifecycle_state: row.lifecycle_state,
    company_name: companyName,
    equipment: equipment
      ? { label: [equipment.year, equipment.make, equipment.model].filter(Boolean).join(" ") || equipment.name,
      }
      : { label: [row.requested_make, row.requested_model].filter(Boolean).join(" ") || row.requested_category,
      },
    start_date: row.requested_start_date,
    end_date: row.requested_end_date,
    daily_rate: row.agreed_daily_rate ?? row.estimate_daily_rate,
    weekly_rate: row.agreed_weekly_rate ?? row.estimate_weekly_rate,
    monthly_rate: row.agreed_monthly_rate ?? row.estimate_monthly_rate,
    deposit_required: row.deposit_required === true,
    deposit_amount: row.deposit_amount,
    delivery_mode: row.delivery_mode,
    dealer_notes: row.dealer_notes,
    rpo_eligible: row.rpo_eligible === true,
    rpo_purchase_price: row.rpo_purchase_price_cents != null ? row.rpo_purchase_price_cents / 100 : null,
    signature: row.native_signature_id
      ? { signer_name: row.native_signer_name, signed_at: row.native_signed_at }
      : null,
  };

  if (body.action === "read" || !body.action) {
    return json(200, { ok: true, quote: quotePayload });
  }

  if (body.action !== "sign") {
    return json(400, { error: "action must be read or sign" });
  }

  // ── Sign ────────────────────────────────────────────────────────────
  const signerName = typeof body.signer_name === "string" ? body.signer_name.trim() : "";
  const dataUrl = typeof body.signature_data_url === "string" ? body.signature_data_url : "";
  if (!signerName) return json(400, { error: "signer_name required" });
  if (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length < 100) {
    return json(400, { error: "signature_data_url must be a PNG data URL" });
  }

  // The atomic command verifies signature linkage and the reservation postcondition.
  if (row.native_signature_id && row.lifecycle_state !== "quoted") {
    const { data: resumed, error } = await admin.rpc(
      "rental_sign_quote_atomic",
      { p_contract_id: row.id, p_token: token, p_signature: {} },
    );
    if (error || !resumed) {
      return json(409, {
        error: error?.message ?? "Signature reservation requires review",
      });
    }
    return json(200, {
      ok: true,
      already_signed: true,
      lifecycle_state: resumed.lifecycle_state,
    });
  }

  if (row.lifecycle_state !== "quoted") {
    return json(409, { error: `quote is not open for signing (state: ${row.lifecycle_state})`,
    });
  }
  if (!row.qrm_company_id && !row.portal_customer_id) {
    return json(409, {
      error: "quote has no customer anchor — contact the dealership",
    });
  }

  // rental_contract_signatures.portal_customer_id is NOT NULL (m607 was
  // portal-only). Share-link signers resolve to the company's portal
  // identity via the same find-or-create the N4.1 fleet writer uses.
  let portalCustomerId = row.portal_customer_id;
  if (!portalCustomerId && row.qrm_company_id) {
    const { data: resolved } = await admin.rpc(
      "qep_find_or_create_portal_identity",
      {
        p_workspace_id: row.workspace_id,
        p_crm_company_id: row.qrm_company_id,
      },
    );
    portalCustomerId = (resolved as string | null) ?? null;
  }
  if (!portalCustomerId) {
    return json(409, {
      error:
        "no portal identity resolvable for this quote — contact the dealership",
    });
  }

  const signedAt = new Date().toISOString();
  const signedSnapshot = {
    rental_contract: {
      id: row.id,
      equipment_id: row.equipment_id,
      rpo_eligible: row.rpo_eligible,
      rpo_purchase_price_cents: row.rpo_purchase_price_cents,
      contract_number: row.contract_number,
      lifecycle_state: row.lifecycle_state,
      requested_start_date: row.requested_start_date,
      requested_end_date: row.requested_end_date,
      daily_rate: quotePayload.daily_rate,
      weekly_rate: quotePayload.weekly_rate,
      monthly_rate: quotePayload.monthly_rate,
      deposit_required: row.deposit_required,
      deposit_amount: row.deposit_amount,
      delivery_mode: row.delivery_mode,
    },
    equipment: quotePayload.equipment,
    signer: { name: signerName },
    signed_via: "share_link",
    signed_at_server: signedAt,
  };
  const documentHash = await canonicalizeAndHash({
    rental_contract_id: row.id,
    signed_snapshot: signedSnapshot,
    signer_name: signerName,
  });

  const { data: reserved, error: reserveError } = await admin.rpc(
    "rental_sign_quote_atomic",
    {
      p_contract_id: row.id,
      p_token: token,
      p_signature: {
        workspace_id: row.workspace_id,
        rental_contract_id: row.id,
        portal_customer_id: portalCustomerId,
        signer_name: signerName,
        signer_ip: clientIp(req),
        signer_user_agent: req.headers.get("user-agent"),
        signature_image_url: dataUrl,
        signed_snapshot: signedSnapshot,
        signed_via: "share_link",
        document_hash: documentHash,
        is_valid: true,
        signed_at: signedAt,
      },
    },
  );
  if (reserveError || !reserved) {
    return json(409, {
      error: reserveError?.message ??
        "Signature and reservation were not saved; retry is safe",
    });
  }

  return json(201, {
    ok: true,
    signed: true,
    contract_number: reserved.contract_number,
    lifecycle_state: reserved.lifecycle_state,
  });
});
