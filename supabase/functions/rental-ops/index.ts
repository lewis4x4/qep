import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { createRentalConversionDeal } from "../_shared/rental-conversion-deal.ts";
import {
  evaluateRentalRateFloor,
  mintRentalInvoiceNumber,
  resolveNumberingBranch,
  type RateFloorEvaluation,
} from "../_shared/rental-finance.ts";

type BookingApprovalPayload = {
  action: "approve_booking";
  contract_id?: string;
  equipment_id?: string | null;
  branch_id?: string | null;
  dealer_response?: string | null;
  deposit_amount?: number | string | null;
  /** Below-book rates beyond the workspace discount threshold require an
   * explicit manager override — recorded to the exception queue (M4.1). */
  override_rate_floor?: boolean;
};

type BookingDeclinePayload = {
  action: "decline_booking";
  contract_id?: string;
  dealer_response?: string | null;
};

type ExtensionApprovalPayload = {
  action: "approve_extension";
  extension_id?: string;
  dealer_response?: string | null;
  additional_charge?: number | string | null;
};

type ExtensionDeclinePayload = {
  action: "decline_extension";
  extension_id?: string;
  dealer_response?: string | null;
};

type CounterContractPayload = {
  action: "create_contract";
  override_overbook?: boolean;
  qrm_company_id?: string;
  qrm_contact_id?: string | null;
  contract_type?: string | null;
  equipment_id?: string | null;
  branch_id?: string | null;
  start_date?: string;
  end_date?: string;
  daily_rate?: number | string | null;
  weekly_rate?: number | string | null;
  monthly_rate?: number | string | null;
  delivery_mode?: string | null;
  dealer_notes?: string | null;
};

type ExchangeLinePayload = {
  action: "exchange_line";
  contract_id?: string;
  line_id?: string;
  new_equipment_id?: string;
  /** L2 pin: rate continuity is DECLARED at exchange creation, never derived
   * at billing time. true = same rate class (continuous clock+optimization);
   * false = class change (L5 segments at this timestamp). */
  rate_continuous?: boolean;
  return_meter_hours?: number | string | null;
  outbound_meter_hours?: number | string | null;
  substitution_reason?: string | null;
};

type CodeLineReturnPayload = {
  action: "code_line_return";
  line_id?: string;
  /** IntelliDealer R/O/E semantics; exchanges go through exchange_line. */
  return_code?: "returned" | "off_rent" | "hold";
  return_meter_hours?: number | string | null;
};

type ReleaseHoldPayload = {
  action: "release_hold";
  line_id?: string;
};

type DisposeDamagePayload = {
  action: "dispose_damage";
  return_id?: string;
  /** Who pays is a decision (L2 pin, mig 772). 'dispute' escalates to the
   * exception queue instead of choosing. */
  disposition?: "customer_billable" | "warranty" | "internal_wear" | "dispute";
  notes?: string | null;
  /** L9.2: assessed amounts in CENTS. When damage_charge_cents is omitted,
   * the legacy wizard dollars in rental_returns.charge_amount are converted
   * (×100) so the L5 billing runner finally sees what was assessed. */
  damage_charge_cents?: number | string | null;
  fuel_charge_cents?: number | string | null;
  cleaning_charge_cents?: number | string | null;
  environmental_fee_cents?: number | string | null;
};

type ConvertRpoToDealPayload = {
  action: "convert_rpo_to_deal";
  contract_id?: string;
};

type IssueRentalQuotePayload = {
  action: "issue_rental_quote";
  contract_id?: string;
  override_rate_floor?: boolean;
  customer_email?: string | null;
};

type CloseContractPayload = {
  action: "close_contract";
  contract_id?: string;
  hard_close?: boolean;
  hard_close_reason?: string | null;
};

type StartCheckoutInspectionPayload = {
  action: "start_checkout_inspection";
  contract_id?: string;
};

type CompleteCheckoutInspectionPayload = {
  action: "complete_checkout_inspection";
  run_id?: string;
  machine_hours?: number | string | null;
  damage_found?: boolean;
  damage_description?: string | null;
};

type CompleteCheckinInspectionPayload = {
  action: "complete_checkin_inspection";
  run_id?: string;
  machine_hours?: number | string | null;
  damage_found?: boolean;
  damage_description?: string | null;
};

type CheckOutContractPayload = {
  action: "check_out_contract";
  contract_id?: string;
  equipment_id?: string | null;
  /** Overbooking is allowed only via explicit manager override — recorded to
   * the exception queue (blueprint L3 policy). */
  override_overbook?: boolean;
  /** Below-book rates beyond the workspace discount threshold require an
   * explicit manager override — recorded to the exception queue (M4.1). */
  override_rate_floor?: boolean;
  /** Credit-held customers block at checkout (m770/773 gate). A manager may
   * record a security override — stamps checkout_security_override_* and an
   * exception audit (M5.1). */
  override_credit_hold?: boolean;
  override_credit_hold_reason?: string | null;
};

async function consultAvailability(
  // deno-lint-ignore no-explicit-any -- matches this module's untyped admin client convention
  admin: any,
  workspaceId: string,
  equipmentId: string,
  start: string,
  end: string,
): Promise<{ available: boolean; detail: unknown }> {
  const { data, error } = await admin.rpc("rental_check_availability", {
    p_workspace_id: workspaceId,
    p_start: start,
    p_end: end,
    p_equipment_id: equipmentId,
  });
  if (error) return { available: true, detail: { skipped: error.message } }; // fail-open: never block the counter on the checker itself
  const record = (data ?? {}) as Record<string, unknown>;
  return { available: record.available !== false, detail: record };
}

/**
 * M4.1 rate floor (blueprint §9): agreed rates more than the workspace
 * threshold below the rental_resolve_rates book either block (409) or pass
 * with an explicit manager override recorded to the exception queue — the
 * same shape as the overbook override. Returns a Response to short-circuit
 * with, or null to proceed.
 */
async function enforceRateFloor(
  // deno-lint-ignore no-explicit-any -- matches this module's untyped admin client convention
  admin: any,
  workspaceId: string,
  contractId: string,
  actorId: string,
  actorRole: string,
  evaluation: RateFloorEvaluation,
  overrideRequested: boolean,
  origin: string | null,
): Promise<Response | null> {
  if (!evaluation.belowFloor) return null;
  if (!overrideRequested) {
    return safeJsonError(
      `Agreed rate is ${evaluation.discountPct?.toFixed(1)}% below the book rate (${evaluation.bookSource}); the workspace threshold is ${evaluation.thresholdPct}%. A manager may override with override_rate_floor.`,
      409,
      origin,
    );
  }
  if (!["admin", "manager", "owner"].includes(actorRole)) {
    return safeJsonError("Below-book rate override requires a manager or owner", 403, origin);
  }
  await admin.rpc("enqueue_exception", {
    p_source: "rental_rate_floor_override",
    p_title: "Below-book rental rate approved by manager override",
    p_severity: "warn",
    p_detail:
      `Contract ${contractId}: agreed rate ${evaluation.discountPct?.toFixed(1)}% below book (threshold ${evaluation.thresholdPct}%), overridden by ${actorId}.`,
    p_payload: {
      contract_id: contractId,
      actor_id: actorId,
      discount_pct: evaluation.discountPct,
      threshold_pct: evaluation.thresholdPct,
      book_source: evaluation.bookSource,
      comparison: evaluation.comparison,
      workspace_id: workspaceId,
    },
    p_entity_table: "rental_contracts",
    p_entity_id: contractId,
  });
  return null;
}

async function recordOverbookOverride(
  // deno-lint-ignore no-explicit-any -- matches this module's untyped admin client convention
  admin: any,
  workspaceId: string,
  contractId: string,
  actorId: string,
  detail: unknown,
) {
  await admin.rpc("enqueue_exception", {
    p_source: "rental_overbook_override",
    p_title: "Rental overbooking approved by manager override",
    p_severity: "warn",
    p_detail: `Contract ${contractId}: availability conflicts overridden by ${actorId}.`,
    p_payload: { contract_id: contractId, actor_id: actorId, availability: detail, workspace_id: workspaceId },
    p_entity_table: "rental_contracts",
    p_entity_id: contractId,
  });
}

type RentalOpsPayload =
  | BookingApprovalPayload
  | BookingDeclinePayload
  | ExtensionApprovalPayload
  | ExtensionDeclinePayload
  | CounterContractPayload
  | ExchangeLinePayload
  | CodeLineReturnPayload
  | ReleaseHoldPayload
  | DisposeDamagePayload
  | StartCheckoutInspectionPayload
  | CompleteCheckoutInspectionPayload
  | CompleteCheckinInspectionPayload
  | ConvertRpoToDealPayload
  | IssueRentalQuotePayload
  | CloseContractPayload
  | CheckOutContractPayload;

const RENTAL_CHECKOUT_TEMPLATE = {
  applies_to: "rental_checkout",
  template_name: "Rental check-out condition inspection",
  questions: [
    { id: "exterior", label: "Exterior condition documented (photos)", type: "boolean" },
    { id: "tires_tracks", label: "Tires / tracks / undercarriage condition", type: "boolean" },
    { id: "attachments", label: "Attachments present and secured", type: "boolean" },
    { id: "fluids", label: "Fluids topped and no visible leaks", type: "boolean" },
    { id: "safety", label: "Safety equipment (fire ext., beacon, seat belt) present", type: "boolean" },
    { id: "hour_meter", label: "Hour meter photographed and recorded", type: "boolean" },
  ],
};

// L9.1: check-in mirror of the checkout template. Opened automatically when
// a line is coded returned; completing it moves the rental_returns row to
// clean_return or damage_assessment.
const RENTAL_CHECKIN_TEMPLATE = {
  applies_to: "rental_checkin",
  template_name: "Rental check-in condition inspection",
  questions: [
    { id: "exterior", label: "Exterior condition documented (photos)", type: "boolean" },
    { id: "tires_tracks", label: "Tires / tracks / undercarriage condition", type: "boolean" },
    { id: "attachments", label: "Attachments returned and undamaged", type: "boolean" },
    { id: "fluids", label: "Fluid levels checked and no new leaks", type: "boolean" },
    { id: "fuel", label: "Fuel level recorded", type: "boolean" },
    { id: "hour_meter", label: "Hour meter photographed and recorded", type: "boolean" },
  ],
};

function toMeter(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type RentalContractRow = {
  id: string;
  workspace_id: string;
  portal_customer_id: string;
  equipment_id: string | null;
  branch_id: string | null;
  requested_start_date: string;
  requested_end_date: string;
  estimate_daily_rate: number | null;
  estimate_weekly_rate: number | null;
  estimate_monthly_rate: number | null;
  deposit_required: boolean | null;
  deposit_amount: number | null;
  deposit_invoice_id: string | null;
  status: string;
  assignment_status: "pending_assignment" | "assigned" | null;
  dealer_response: string | null;
};

type RentalExtensionRow = {
  id: string;
  workspace_id: string;
  rental_contract_id: string;
  requested_end_date: string;
  approved_end_date: string | null;
  status: string;
  dealer_response: string | null;
  additional_charge: number | null;
  payment_invoice_id: string | null;
  payment_status: string | null;
};

type PortalCustomerRow = {
  id: string;
  workspace_id: string | null;
  crm_company_id: string | null;
};

function toCurrencyAmount(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function requireServiceRoleEnv(origin: string | null) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false as const, response: safeJsonError("Server misconfiguration", 500, origin) };
  }
  return {
    ok: true as const,
    admin: createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }),
  };
}

async function getOperatorWorkspace(
  userSupabase: any,
  userId: string,
) {
  const result = await (userSupabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", userId)
    .maybeSingle() as Promise<{
      data: { active_workspace_id?: string | null } | null;
      error: { message?: string } | null;
    }>);
  const { data, error } = result;
  if (error || !data?.active_workspace_id) return null;
  return data.active_workspace_id;
}

async function createInvoiceLineItems(
  admin: any,
  invoiceId: string,
  description: string,
  amount: number,
) {
  const { error } = await admin
    .from("customer_invoice_line_items")
    .insert({
      invoice_id: invoiceId,
      description,
      quantity: 1,
      unit_price: amount,
    }) as { error: { message?: string } | null };
  if (error) throw new Error(error.message ?? "Failed to create invoice line items.");
}

async function createRentalInvoice(
  admin: any,
  customer: PortalCustomerRow,
  description: string,
  invoiceNumber: string,
  amount: number,
) {
  const result = await (admin
    .from("customer_invoices")
    .insert({
      workspace_id: customer.workspace_id ?? undefined,
      portal_customer_id: customer.id,
      crm_company_id: customer.crm_company_id,
      invoice_number: invoiceNumber,
      due_date: new Date().toISOString().slice(0, 10),
      description,
      amount,
      total: amount,
      status: "pending",
      invoice_type: "rental",
      invoice_source_code: "RENTAL",
    })
    .select("id, status")
    .single() as Promise<{
      data: { id?: string | null; status?: string | null } | null;
      error: { message?: string } | null;
    }>);
  const { data: invoice, error: invoiceError } = result;
  if (invoiceError || !invoice?.id) {
    throw new Error(invoiceError?.message ?? "Failed to create rental invoice.");
  }
  await createInvoiceLineItems(admin, invoice.id, description, amount);
  return { id: invoice.id, status: String(invoice.status ?? "pending") };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const env = requireServiceRoleEnv(origin);
    if (!env.ok) return env.response;
    const admin = env.admin;

    const workspaceId = await getOperatorWorkspace(auth.supabase, auth.userId);
    if (!workspaceId) return safeJsonError("Operator workspace is not configured", 403, origin);

    const body = await req.json() as RentalOpsPayload;

    if (body.action === "create_contract") {
      // Counter origination (Stream L / L0): a rep opens a draft contract for
      // a QRM company — no portal account involved. The DB trigger assigns the
      // RC-YYYY-NNNNN number; the lifecycle guard governs every later move.
      if (!body.qrm_company_id) return safeJsonError("qrm_company_id required", 400, origin);
      if (!body.start_date || !body.end_date) {
        return safeJsonError("start_date and end_date required", 400, origin);
      }
      if (body.end_date < body.start_date) {
        return safeJsonError("end_date must not precede start_date", 400, origin);
      }

      const contractType = typeof body.contract_type === "string" && body.contract_type.trim()
        ? body.contract_type.trim()
        : "rental";
      if (!["reservation", "rental", "demo", "loaner"].includes(contractType)) {
        // rpo and rerent need their term/line blocks — they open via dedicated flows later in Stream L.
        return safeJsonError("contract_type must be reservation, rental, demo, or loaner", 400, origin);
      }

      const { data: company, error: companyError } = await admin
        .from("qrm_companies")
        .select("id, workspace_id")
        .eq("id", body.qrm_company_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (companyError || !company) return safeJsonError("Company not found in this workspace", 404, origin);

      const equipmentId = typeof body.equipment_id === "string" && body.equipment_id.trim()
        ? body.equipment_id.trim()
        : null;
      if (equipmentId) {
        const { data: unit, error: unitError } = await admin
          .from("crm_equipment")
          .select("id, availability")
          .eq("workspace_id", workspaceId)
          .eq("id", equipmentId)
          .eq("ownership", "rental_fleet")
          .maybeSingle();
        if (unitError || !unit) return safeJsonError("Rental unit not found in the rental fleet", 404, origin);
        if (unit.availability !== "available") {
          return safeJsonError("Rental unit is not available for the requested dates", 400, origin);
        }
      }

      let dailyRate = toCurrencyAmount(body.daily_rate);
      let weeklyRate = toCurrencyAmount(body.weekly_rate);
      let monthlyRate = toCurrencyAmount(body.monthly_rate);
      const deliveryMode = body.delivery_mode === "delivery" ? "delivery" : "pickup";

      let overbookedDetail: unknown = null;
      let rateBookSource: string | null = null;
      if (equipmentId) {
        const availability = await consultAvailability(admin, workspaceId, equipmentId, body.start_date, body.end_date);
        if (!availability.available) {
          if (body.override_overbook !== true) {
            return safeJsonError(
              "Unit is not available for the requested window (holds or on-rent lines conflict). A manager may override with override_overbook.",
              409,
              origin,
            );
          }
          overbookedDetail = availability.detail;
        }

        // Fill blank counter rates from the governed L1 book so the desk
        // never invents a day-only sticker when a full book exists.
        if (dailyRate <= 0 || weeklyRate <= 0 || monthlyRate <= 0) {
          const { data: book } = await admin.rpc("rental_resolve_rates", {
            p_workspace_id: workspaceId,
            p_equipment_id: equipmentId,
            p_company_id: company.id,
            p_on_date: body.start_date,
          });
          if (book && typeof book === "object") {
            const b = book as Record<string, unknown>;
            rateBookSource = typeof b.source === "string" ? b.source : "resolved";
            if (dailyRate <= 0 && typeof b.day === "number" && b.day > 0) {
              dailyRate = b.day / 100;
            }
            if (weeklyRate <= 0 && typeof b.week === "number" && b.week > 0) {
              weeklyRate = b.week / 100;
            }
            if (monthlyRate <= 0 && typeof b.month === "number" && b.month > 0) {
              monthlyRate = b.month / 100;
            }
          }
        }
      }

      const { data: contract, error: insertError } = await admin
        .from("rental_contracts")
        .insert({
          workspace_id: workspaceId,
          qrm_company_id: company.id,
          qrm_contact_id: typeof body.qrm_contact_id === "string" && body.qrm_contact_id.trim()
            ? body.qrm_contact_id.trim()
            : null,
          origination_channel: "counter",
          originated_by: auth.userId,
          contract_type: contractType,
          status: "draft",
          lifecycle_state: "draft",
          request_type: "booking",
          delivery_mode: deliveryMode,
          requested_start_date: body.start_date,
          requested_end_date: body.end_date,
          equipment_id: equipmentId,
          assignment_status: equipmentId ? "assigned" : "pending_assignment",
          branch_id: typeof body.branch_id === "string" && body.branch_id.trim() ? body.branch_id.trim() : null,
          estimate_daily_rate: dailyRate > 0 ? dailyRate : null,
          estimate_weekly_rate: weeklyRate > 0 ? weeklyRate : null,
          estimate_monthly_rate: monthlyRate > 0 ? monthlyRate : null,
          dealer_notes: typeof body.dealer_notes === "string" ? body.dealer_notes : null,
          // L2 closeout: counter contracts require the check-out condition
          // inspection by default now that the flow exists (owner pin, mig 773).
          checkout_inspection_required: true,
          deposit_required: false,
          tax_exempt: false,
          coi_required: false,
          po_required: false,
          rpo_eligible: false,
          delivery_required: deliveryMode === "delivery",
          pickup_required: false,
          delivery_address: {},
          pickup_address: {},
          tax_sourcing_method: "branch_origin",
        })
        .select("id, contract_number, lifecycle_state, contract_type, status")
        .single();
      if (insertError || !contract) {
        return safeJsonError(insertError?.message ?? "Failed to create rental contract", 500, origin);
      }

      if (overbookedDetail != null) {
        await recordOverbookOverride(admin, workspaceId, contract.id as string, auth.userId, overbookedDetail);
      }

      if (equipmentId) {
        const { error: lineError } = await admin
          .from("rental_contract_lines")
          .insert({
            workspace_id: workspaceId,
            rental_contract_id: contract.id,
            line_number: 1,
            quantity: 1,
            equipment_id: equipmentId,
            rental_start_at: body.start_date,
            rental_end_at: body.end_date,
            daily_rate_cents: dailyRate > 0 ? Math.round(dailyRate * 100) : null,
            weekly_rate_cents: weeklyRate > 0 ? Math.round(weeklyRate * 100) : null,
            monthly_rate_cents: monthlyRate > 0 ? Math.round(monthlyRate * 100) : null,
            status: "quoted",
          });
        if (lineError) {
          return safeJsonError(lineError.message ?? "Contract created but line insert failed", 500, origin);
        }
      }

      return safeJsonOk({
        contract,
        rate_book_source: rateBookSource,
        estimate_daily_rate: dailyRate > 0 ? dailyRate : null,
        estimate_weekly_rate: weeklyRate > 0 ? weeklyRate : null,
        estimate_monthly_rate: monthlyRate > 0 ? monthlyRate : null,
      }, origin);
    }

    if (body.action === "exchange_line") {
      // L2: swap a unit mid-rental. The old line closes with return_code
      // 'exchange'; the new line chains via exchange_parent_line_id and
      // snapshots rate continuity (CHECK-required by migration 772).
      if (!body.contract_id || !body.line_id) return safeJsonError("contract_id and line_id required", 400, origin);
      if (!body.new_equipment_id) return safeJsonError("new_equipment_id required", 400, origin);
      if (typeof body.rate_continuous !== "boolean") {
        return safeJsonError("rate_continuous must be declared (true = same rate class, false = class change)", 400, origin);
      }

      const { data: contract, error: contractError } = await admin
        .from("rental_contracts")
        .select("id, workspace_id, equipment_id, lifecycle_state, qrm_company_id, branch_id, equipment_class, equipment_subclass")
        .eq("id", body.contract_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (contractError || !contract) return safeJsonError("Rental contract not found", 404, origin);
      if (contract.lifecycle_state !== "on_rent") {
        return safeJsonError("Only on-rent contracts can exchange units", 400, origin);
      }

      const { data: oldLine, error: lineError } = await admin
        .from("rental_contract_lines")
        .select("id, rental_contract_id, line_number, quantity, equipment_id, status, rental_end_at, daily_rate_cents, weekly_rate_cents, monthly_rate_cents, hourly_rate_cents, included_hours, overage_hourly_rate_cents, rpo_eligible, damage_waiver_accepted, damage_waiver_rate_pct")
        .eq("id", body.line_id)
        .eq("rental_contract_id", contract.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (lineError || !oldLine) return safeJsonError("Contract line not found", 404, origin);
      if (!["active", "held"].includes(String(oldLine.status))) {
        return safeJsonError("Only active or held lines can be exchanged", 400, origin);
      }

      const { data: newUnit, error: unitError } = await admin
        .from("crm_equipment")
        .select("id, availability")
        .eq("workspace_id", workspaceId)
        .eq("id", body.new_equipment_id)
        .eq("ownership", "rental_fleet")
        .maybeSingle();
      if (unitError || !newUnit) return safeJsonError("Replacement unit not found in the rental fleet", 404, origin);
      if (newUnit.availability !== "available") {
        return safeJsonError("Replacement unit is not available", 400, origin);
      }

      // Rates: continuous exchanges carry the old line's book verbatim; class
      // changes resolve a fresh book (resolver falls back to sticker rates).
      let rates = {
        daily_rate_cents: oldLine.daily_rate_cents,
        weekly_rate_cents: oldLine.weekly_rate_cents,
        monthly_rate_cents: oldLine.monthly_rate_cents,
        hourly_rate_cents: oldLine.hourly_rate_cents,
      };
      if (!body.rate_continuous) {
        const { data: book } = await admin.rpc("rental_resolve_rates", {
          p_workspace_id: workspaceId,
          p_equipment_id: body.new_equipment_id,
          p_company_id: contract.qrm_company_id,
          p_equipment_class: contract.equipment_class,
          p_equipment_subclass: contract.equipment_subclass,
          p_branch_id: contract.branch_id,
        });
        if (book && typeof book === "object") {
          const b = book as Record<string, unknown>;
          rates = {
            daily_rate_cents: typeof b.day === "number" ? b.day : null,
            weekly_rate_cents: typeof b.week === "number" ? b.week : null,
            monthly_rate_cents: typeof b.month === "number" ? b.month : null,
            hourly_rate_cents: typeof b.hourly === "number" ? b.hourly : null,
          };
        }
      }

      const nowIso = new Date().toISOString();

      // Insert the replacement BEFORE closing the old line: the L2 rollup
      // trigger (mig 773) derives the trunk from line states, and closing a
      // single-line contract's only active line first would roll it up to
      // 'returned' mid-exchange.
      const { data: maxLine } = await admin
        .from("rental_contract_lines")
        .select("line_number")
        .eq("rental_contract_id", contract.id)
        .order("line_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: newLine, error: newLineError } = await admin
        .from("rental_contract_lines")
        .insert({
          workspace_id: workspaceId,
          rental_contract_id: contract.id,
          line_number: (maxLine?.line_number ?? 0) + 1,
          quantity: oldLine.quantity,
          equipment_id: body.new_equipment_id,
          rental_start_at: nowIso,
          rental_end_at: oldLine.rental_end_at,
          outbound_meter_hours: toMeter(body.outbound_meter_hours),
          ...rates,
          included_hours: oldLine.included_hours,
          overage_hourly_rate_cents: oldLine.overage_hourly_rate_cents,
          rpo_eligible: oldLine.rpo_eligible,
          damage_waiver_accepted: oldLine.damage_waiver_accepted,
          damage_waiver_rate_pct: oldLine.damage_waiver_rate_pct,
          exchange_parent_line_id: oldLine.id,
          exchange_rate_continuous: body.rate_continuous,
          substitution_reason: typeof body.substitution_reason === "string" ? body.substitution_reason : null,
          status: "active",
        })
        .select("id, line_number, exchange_parent_line_id, exchange_rate_continuous, status")
        .single();
      if (newLineError || !newLine) {
        return safeJsonError(newLineError?.message ?? "Replacement line insert failed; exchange not performed", 500, origin);
      }

      const { error: closeError } = await admin
        .from("rental_contract_lines")
        .update({
          status: "exchanged",
          return_code: "exchange",
          actual_returned_at: nowIso,
          return_meter_hours: toMeter(body.return_meter_hours),
        })
        .eq("id", oldLine.id)
        .eq("workspace_id", workspaceId);
      if (closeError) {
        // Replacement exists but the old line stayed active — surface loudly;
        // retrying the close (not the whole exchange) is the operator fix.
        return safeJsonError(
          `Replacement line ${newLine.line_number} created but closing line ${oldLine.line_number} failed: ${closeError.message ?? "unknown error"}`,
          500,
          origin,
        );
      }

      if (contract.equipment_id === oldLine.equipment_id) {
        await admin
          .from("rental_contracts")
          .update({ equipment_id: body.new_equipment_id })
          .eq("id", contract.id)
          .eq("workspace_id", workspaceId);
      }

      return safeJsonOk({ exchanged_line_id: oldLine.id, new_line: newLine }, origin);
    }

    if (body.action === "issue_rental_quote") {
      // L9.5: make the quote a real customer-facing document. Runs the
      // M4.1 rate floor on the estimate rates (quoted rates are governed
      // the same way they are billed), transitions draft → quoted, mints
      // the share token, and (best-effort) emails the link.
      if (!body.contract_id) return safeJsonError("contract_id required", 400, origin);

      const { data: contract, error: contractError } = await admin
        .from("rental_contracts")
        .select(
          "id, contract_number, lifecycle_state, share_token, equipment_id, qrm_company_id, portal_customer_id, branch_id, estimate_daily_rate, estimate_weekly_rate, estimate_monthly_rate",
        )
        .eq("id", body.contract_id)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .maybeSingle();
      if (contractError || !contract) return safeJsonError("Rental contract not found", 404, origin);
      if (!["draft", "quoted"].includes(String(contract.lifecycle_state))) {
        return safeJsonError(
          `Quotes issue from draft/quoted contracts (state: ${contract.lifecycle_state})`,
          400,
          origin,
        );
      }
      if (!contract.qrm_company_id && !contract.portal_customer_id) {
        return safeJsonError("Link a customer (company or portal identity) before issuing the quote", 400, origin);
      }

      const rateFloor = await evaluateRentalRateFloor(admin, {
        workspaceId,
        agreedDaily: contract.estimate_daily_rate == null ? null : Number(contract.estimate_daily_rate),
        agreedWeekly: contract.estimate_weekly_rate == null ? null : Number(contract.estimate_weekly_rate),
        agreedMonthly: contract.estimate_monthly_rate == null ? null : Number(contract.estimate_monthly_rate),
        equipmentId: (contract.equipment_id as string | null) ?? null,
        companyId: (contract.qrm_company_id as string | null) ?? null,
        branchId: (contract.branch_id as string | null) ?? null,
      });
      const rateFloorBlock = await enforceRateFloor(
        admin,
        workspaceId,
        contract.id,
        auth.userId,
        auth.role,
        rateFloor,
        body.override_rate_floor === true,
        origin,
      );
      if (rateFloorBlock) return rateFloorBlock;

      const shareToken = (contract.share_token as string | null) ??
        crypto.randomUUID().replaceAll("-", "");

      const { data: issued, error: issueError } = await admin
        .from("rental_contracts")
        .update({
          lifecycle_state: "quoted",
          share_token: shareToken,
          ...(contract.share_token ? {} : { share_token_created_at: new Date().toISOString() }),
        })
        .eq("id", contract.id)
        .eq("workspace_id", workspaceId)
        .select("id, contract_number, lifecycle_state, share_token")
        .single();
      if (issueError || !issued) {
        return safeJsonError(issueError?.message ?? "Failed to issue the quote", 500, origin);
      }

      const appBase = Deno.env.get("QEP_APP_BASE_URL") ?? "https://qep.blackrockai.co";
      const shareUrl = `${appBase}/rq/${issued.share_token}`;

      // Best-effort email delivery — zero-blocking.
      let emailStatus = "skipped";
      const resendKey = Deno.env.get("RESEND_API_KEY");
      let recipient = typeof body.customer_email === "string" && body.customer_email.includes("@")
        ? body.customer_email.trim()
        : null;
      if (!recipient && contract.portal_customer_id) {
        const { data: pc } = await admin
          .from("portal_customers")
          .select("email")
          .eq("id", contract.portal_customer_id)
          .maybeSingle();
        recipient = (pc?.email as string | null) ?? null;
      }
      if (resendKey && recipient) {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: Deno.env.get("RESEND_FROM") ?? "QEP Rentals <onboarding@resend.dev>",
              to: [recipient],
              subject: `Your rental quote ${issued.contract_number ?? ""}`.trim(),
              text: `Your rental quote is ready. Review and sign here: ${shareUrl}`,
            }),
          });
          emailStatus = res.ok ? "sent" : `failed_${res.status}`;
        } catch {
          emailStatus = "failed";
        }
      }

      return safeJsonOk(
        {
          contract_id: issued.id,
          lifecycle_state: issued.lifecycle_state,
          share_url: shareUrl,
          email_status: emailStatus,
          ...(rateFloor.belowFloor ? { rate_floor_overridden: true } : {}),
        },
        origin,
      );
    }

    if (body.action === "close_contract") {
      if (!body.contract_id) return safeJsonError("contract_id required", 400, origin);
      const hardClose = body.hard_close === true;
      if (hardClose && !["manager", "admin", "owner"].includes(auth.role)) {
        return safeJsonError("Hard close requires manager or above", 403, origin);
      }
      const { data: closed, error: closeError } = await admin.rpc("rental_close_contract", {
        p_workspace_id: workspaceId,
        p_contract_id: body.contract_id,
        p_actor_id: auth.userId,
        p_hard_close: hardClose,
        p_hard_close_reason: hardClose
          ? (typeof body.hard_close_reason === "string" ? body.hard_close_reason : null)
          : null,
      });
      if (closeError || !closed) {
        return safeJsonError(closeError?.message ?? "Failed to close contract", 400, origin);
      }
      return safeJsonOk({ contract: closed }, origin);
    }

    if (body.action === "convert_rpo_to_deal") {
      // L9.3 operator path: same shared helper as the
      // rental.rpo.threshold_reached flow action — idempotent per contract
      // via the m807 unique provenance index.
      if (!body.contract_id) return safeJsonError("contract_id required", 400, origin);
      const result = await createRentalConversionDeal(admin, workspaceId, body.contract_id);
      if (!result.dealId) {
        return safeJsonError(result.error ?? "Conversion deal not created", 400, origin);
      }
      return safeJsonOk(
        { deal_id: result.dealId, created: result.created, ...(result.error ? { warning: result.error } : {}) },
        origin,
      );
    }

    if (body.action === "start_checkout_inspection") {
      // L2 closeout: check-out condition inspection (blueprint §4). Finds the
      // workspace's rental_checkout template or creates the default one —
      // zero-blocking: a fresh workspace can still check out.
      if (!body.contract_id) return safeJsonError("contract_id required", 400, origin);

      const { data: contract, error: contractError } = await admin
        .from("rental_contracts")
        .select("id, contract_number, lifecycle_state, equipment_id")
        .eq("id", body.contract_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (contractError || !contract) return safeJsonError("Rental contract not found", 404, origin);
      if (!["reserved", "quoted", "draft"].includes(String(contract.lifecycle_state))) {
        return safeJsonError("Check-out inspections start before the contract goes on rent", 400, origin);
      }

      let templateId: string | null = null;
      const { data: template } = await admin
        .from("inspection_templates")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("applies_to", RENTAL_CHECKOUT_TEMPLATE.applies_to)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      templateId = template?.id ?? null;
      if (!templateId) {
        const { data: created, error: templateError } = await admin
          .from("inspection_templates")
          .insert({
            workspace_id: workspaceId,
            template_name: RENTAL_CHECKOUT_TEMPLATE.template_name,
            applies_to: RENTAL_CHECKOUT_TEMPLATE.applies_to,
            questions: RENTAL_CHECKOUT_TEMPLATE.questions,
          })
          .select("id")
          .single();
        if (templateError || !created) {
          return safeJsonError(templateError?.message ?? "Failed to create the check-out template", 500, origin);
        }
        templateId = created.id as string;
      }

      const inspectionNumber = `RCI-${contract.contract_number ?? String(contract.id).slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
      const { data: run, error: runError } = await admin
        .from("inspection_runs")
        .insert({
          workspace_id: workspaceId,
          template_id: templateId,
          inspection_number: inspectionNumber,
          rental_contract_id: contract.id,
          equipment_id: contract.equipment_id,
          inspector_id: auth.userId,
          started_at: new Date().toISOString(),
        })
        .select("id, inspection_number, started_at, completed_at")
        .single();
      if (runError || !run) return safeJsonError(runError?.message ?? "Failed to start the inspection", 500, origin);
      return safeJsonOk({ run }, origin);
    }

    if (body.action === "complete_checkout_inspection") {
      if (!body.run_id) return safeJsonError("run_id required", 400, origin);
      const { data: run, error } = await admin
        .from("inspection_runs")
        .update({
          completed_at: new Date().toISOString(),
          machine_hours: toMeter(body.machine_hours),
          damage_found: body.damage_found === true,
          damage_description: typeof body.damage_description === "string" ? body.damage_description : null,
        })
        .eq("id", body.run_id)
        .eq("workspace_id", workspaceId)
        .not("rental_contract_id", "is", null)
        .is("completed_at", null)
        .select("id, rental_contract_id, completed_at, machine_hours")
        .maybeSingle();
      if (error) return safeJsonError(error.message ?? "Failed to complete the inspection", 500, origin);
      if (!run) return safeJsonError("Inspection run not found (or already completed)", 400, origin);
      return safeJsonOk({ run }, origin);
    }

    if (body.action === "check_out_contract") {
      // The guarded check-out: the 769/770/773 gate stack enforces unit
      // assignment, security (deposit/credit/override), COI, signature, and —
      // when required — a completed inspection. This action just assembles the
      // row; the database decides.
      if (!body.contract_id) return safeJsonError("contract_id required", 400, origin);

      const { data: contract, error: contractError } = await admin
        .from("rental_contracts")
        .select("id, lifecycle_state, equipment_id, assignment_status, requested_start_date, approved_start_date, requested_end_date, approved_end_date, estimate_daily_rate, estimate_weekly_rate, estimate_monthly_rate, agreed_daily_rate, agreed_weekly_rate, agreed_monthly_rate, workspace_id, qrm_company_id, portal_customer_id, branch_id")
        .eq("id", body.contract_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (contractError || !contract) return safeJsonError("Rental contract not found", 404, origin);
      if (contract.lifecycle_state !== "reserved") {
        return safeJsonError("Only reserved contracts can check out (reserve it first)", 400, origin);
      }

      const equipmentId = typeof body.equipment_id === "string" && body.equipment_id.trim()
        ? body.equipment_id.trim()
        : (contract.equipment_id as string | null);
      if (equipmentId && equipmentId !== contract.equipment_id) {
        const { data: unit, error: unitError } = await admin
          .from("crm_equipment")
          .select("id, availability")
          .eq("workspace_id", workspaceId)
          .eq("id", equipmentId)
          .eq("ownership", "rental_fleet")
          .maybeSingle();
        if (unitError || !unit) return safeJsonError("Rental unit not found in the rental fleet", 404, origin);
        if (unit.availability !== "available") return safeJsonError("Rental unit is not available", 400, origin);
      }

      // Availability is the deterministic RPC's call, not this action's.
      if (equipmentId) {
        const availability = await consultAvailability(
          admin, workspaceId, equipmentId,
          (contract.approved_start_date ?? contract.requested_start_date) as string,
          (contract.approved_end_date ?? contract.requested_end_date) as string,
        );
        // Conflicts from THIS contract's own converted-or-active hold are
        // expected at check-out; only foreign conflicts block.
        const foreignConflicts = Array.isArray((availability.detail as Record<string, unknown>)?.conflicts)
          ? ((availability.detail as Record<string, unknown>).conflicts as Array<Record<string, unknown>>)
              .filter((conflict) => conflict.contract_id !== contract.id)
          : [];
        if (!availability.available && foreignConflicts.length > 0) {
          if (body.override_overbook === true) {
            await recordOverbookOverride(admin, workspaceId, contract.id as string, auth.userId, foreignConflicts);
          } else {
            return safeJsonError(
              `Unit is not available for the contract window (${foreignConflicts.length} conflict(s)). A manager may override with override_overbook.`,
              409,
              origin,
            );
          }
        }
      }

      // M4.1 rate floor: check-out locks in agreed_* (falling back to the
      // estimates), so the book comparison happens here for counter flow.
      let checkoutCompanyId = (contract.qrm_company_id as string | null) ?? null;
      if (!checkoutCompanyId && contract.portal_customer_id) {
        const { data: portalCustomer } = await admin
          .from("portal_customers")
          .select("crm_company_id")
          .eq("id", contract.portal_customer_id)
          .maybeSingle();
        checkoutCompanyId = (portalCustomer?.crm_company_id as string | null) ?? null;
      }
      const checkoutRateFloor = await evaluateRentalRateFloor(admin, {
        workspaceId,
        agreedDaily: (contract.agreed_daily_rate ?? contract.estimate_daily_rate) == null
          ? null
          : Number(contract.agreed_daily_rate ?? contract.estimate_daily_rate),
        agreedWeekly: (contract.agreed_weekly_rate ?? contract.estimate_weekly_rate) == null
          ? null
          : Number(contract.agreed_weekly_rate ?? contract.estimate_weekly_rate),
        agreedMonthly: (contract.agreed_monthly_rate ?? contract.estimate_monthly_rate) == null
          ? null
          : Number(contract.agreed_monthly_rate ?? contract.estimate_monthly_rate),
        equipmentId,
        companyId: checkoutCompanyId,
        branchId: (contract.branch_id as string | null) ?? null,
      });
      const checkoutRateFloorBlock = await enforceRateFloor(
        admin,
        workspaceId,
        contract.id as string,
        auth.userId,
        auth.role,
        checkoutRateFloor,
        body.override_rate_floor === true,
        origin,
      );
      if (checkoutRateFloorBlock) return checkoutRateFloorBlock;

      // Latest completed check-out inspection feeds the outbound meters.
      const { data: inspection } = await admin
        .from("inspection_runs")
        .select("machine_hours")
        .eq("rental_contract_id", contract.id)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // M5.1: a manager may record a checkout security override — the m770/773
      // gate short-circuits on checkout_security_override_by. Recorded loudly
      // as the rental_credit_hold exception (whitelisted m772, first producer).
      const checkoutPatch: Record<string, unknown> = {
        equipment_id: equipmentId,
        assignment_status: equipmentId ? "assigned" : contract.assignment_status,
        approved_start_date: contract.approved_start_date ?? contract.requested_start_date,
        approved_end_date: contract.approved_end_date ?? contract.requested_end_date,
        agreed_daily_rate: contract.agreed_daily_rate ?? contract.estimate_daily_rate,
        agreed_weekly_rate: contract.agreed_weekly_rate ?? contract.estimate_weekly_rate,
        agreed_monthly_rate: contract.agreed_monthly_rate ?? contract.estimate_monthly_rate,
        lifecycle_state: "on_rent",
      };
      if (body.override_credit_hold === true) {
        if (!["admin", "manager", "owner"].includes(auth.role)) {
          return safeJsonError("Checkout security override requires a manager or owner", 403, origin);
        }
        checkoutPatch.checkout_security_override_by = auth.userId;
        checkoutPatch.checkout_security_override_at = new Date().toISOString();
        checkoutPatch.checkout_security_override_reason =
          (typeof body.override_credit_hold_reason === "string" && body.override_credit_hold_reason.trim())
            ? body.override_credit_hold_reason.trim().slice(0, 500)
            : "Credit hold overridden at checkout";
        await admin.rpc("enqueue_exception", {
          p_source: "rental_credit_hold",
          p_title: "Rental checkout security override recorded over credit hold",
          p_severity: "warn",
          p_detail: `Contract ${contract.id}: checkout security override by ${auth.userId}.`,
          p_payload: { contract_id: contract.id, actor_id: auth.userId, company_id: checkoutCompanyId },
          p_entity_table: "rental_contracts",
          p_entity_id: contract.id,
        });
      }

      const { data: updated, error: updateError } = await admin
        .from("rental_contracts")
        .update(checkoutPatch)
        .eq("id", contract.id)
        .eq("workspace_id", workspaceId)
        .select("id, contract_number, lifecycle_state, on_rent_at, equipment_id")
        .single();
      if (updateError || !updated) {
        const message = updateError?.message ?? "Check-out was refused by the lifecycle guard";
        if (message.includes("credit-held")) {
          await admin.rpc("enqueue_exception", {
            p_source: "rental_credit_hold",
            p_title: "Rental checkout blocked by credit hold",
            p_severity: "warn",
            p_detail: `Contract ${contract.id}: ${message}`,
            p_payload: { contract_id: contract.id, company_id: checkoutCompanyId },
            p_entity_table: "rental_contracts",
            p_entity_id: contract.id,
          });
          return safeJsonError(
            `${message} A manager may proceed with override_credit_hold.`,
            409,
            origin,
          );
        }
        return safeJsonError(message, 400, origin);
      }

      // Activate lines (or create line 1 for a single-unit counter contract).
      const { data: existingLines } = await admin
        .from("rental_contract_lines")
        .select("id, status")
        .eq("rental_contract_id", contract.id)
        .is("deleted_at", null);
      if ((existingLines ?? []).length === 0 && updated.equipment_id) {
        await admin.from("rental_contract_lines").insert({
          workspace_id: workspaceId,
          rental_contract_id: contract.id,
          line_number: 1,
          quantity: 1,
          equipment_id: updated.equipment_id,
          rental_start_at: new Date().toISOString(),
          rental_end_at: contract.approved_end_date ?? contract.requested_end_date,
          outbound_meter_hours: inspection?.machine_hours ?? null,
          status: "active",
        });
      } else {
        for (const line of existingLines ?? []) {
          if (["quoted", "reserved"].includes(String(line.status))) {
            await admin
              .from("rental_contract_lines")
              .update({ status: "active", outbound_meter_hours: inspection?.machine_hours ?? null })
              .eq("id", line.id)
              .eq("workspace_id", workspaceId);
          }
        }
      }

      return safeJsonOk({ contract: updated }, origin);
    }

    if (body.action === "code_line_return") {
      // L2: IntelliDealer R/O/H coding on a contract line. The mig 773 rollup
      // trigger derives the trunk (downstream only); the clock stamps ride the
      // guard. Exchanges have their own action.
      //
      // L9.1: coding a line 'returned' also opens the check-in half of the
      // loop — a rental_returns row (stamped with contract + equipment, so
      // the L5 billing join can match) and a rental_checkin inspection run.
      // The return row is created BEFORE the line update on purpose: the
      // fleet-state recompute fires on the line-status write, and the m805
      // gate needs the open return visible to park the unit at in_service
      // instead of releasing it straight back to available.
      if (!body.line_id) return safeJsonError("line_id required", 400, origin);
      if (!body.return_code || !["returned", "off_rent", "hold"].includes(body.return_code)) {
        return safeJsonError("return_code must be returned, off_rent, or hold", 400, origin);
      }

      const { data: line, error: lineError } = await admin
        .from("rental_contract_lines")
        .select("id, status, equipment_id, rental_contract_id")
        .eq("id", body.line_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (lineError || !line) return safeJsonError("Contract line not found", 404, origin);

      const from = String(line.status);
      const legal =
        (["active", "held"].includes(from) && ["returned", "off_rent", "hold"].includes(body.return_code)) ||
        (from === "off_rent" && body.return_code === "returned");
      if (!legal) {
        return safeJsonError(`Line in status '${from}' cannot be coded '${body.return_code}'`, 400, origin);
      }

      let returnId: string | null = null;
      let checkinRunId: string | null = null;
      const warnings: string[] = [];

      if (body.return_code === "returned" && line.equipment_id) {
        const { data: existingReturn } = await admin
          .from("rental_returns")
          .select("id, status")
          .eq("workspace_id", workspaceId)
          .eq("equipment_id", line.equipment_id)
          .eq("rental_contract_id", line.rental_contract_id)
          .neq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingReturn) {
          returnId = existingReturn.id as string;
        } else {
          const { data: createdReturn, error: returnError } = await admin
            .from("rental_returns")
            .insert({
              workspace_id: workspaceId,
              rental_contract_id: line.rental_contract_id,
              equipment_id: line.equipment_id,
              status: "inspection_pending",
              inspection_started_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (returnError || !createdReturn) {
            return safeJsonError(
              returnError?.message ?? "Failed to open the return record",
              500,
              origin,
            );
          }
          returnId = createdReturn.id as string;
        }
      }

      const patch: Record<string, unknown> = {
        return_code: body.return_code,
        status: body.return_code === "hold" ? "held" : body.return_code,
      };
      const meters = toMeter(body.return_meter_hours);
      if (meters != null) patch.return_meter_hours = meters;
      if (body.return_code === "returned") patch.actual_returned_at = new Date().toISOString();

      const { data: updated, error } = await admin
        .from("rental_contract_lines")
        .update(patch)
        .eq("id", body.line_id)
        .eq("workspace_id", workspaceId)
        .select("id, status, return_code, return_meter_hours, actual_returned_at")
        .single();
      if (error || !updated) return safeJsonError(error?.message ?? "Failed to code the line", 500, origin);

      // Open the check-in inspection run. Zero-blocking: a template or run
      // failure degrades to a warning — the return coding itself stands.
      if (body.return_code === "returned" && line.equipment_id && returnId) {
        try {
          let templateId: string | null = null;
          const { data: template } = await admin
            .from("inspection_templates")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("applies_to", RENTAL_CHECKIN_TEMPLATE.applies_to)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();
          templateId = template?.id ?? null;
          if (!templateId) {
            const { data: createdTemplate, error: templateError } = await admin
              .from("inspection_templates")
              .insert({
                workspace_id: workspaceId,
                template_name: RENTAL_CHECKIN_TEMPLATE.template_name,
                applies_to: RENTAL_CHECKIN_TEMPLATE.applies_to,
                questions: RENTAL_CHECKIN_TEMPLATE.questions,
              })
              .select("id")
              .single();
            if (templateError || !createdTemplate) {
              throw new Error(templateError?.message ?? "check-in template create failed");
            }
            templateId = createdTemplate.id as string;
          }

          const { data: openRun } = await admin
            .from("inspection_runs")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("rental_contract_id", line.rental_contract_id)
            .eq("equipment_id", line.equipment_id)
            .eq("template_id", templateId)
            .is("completed_at", null)
            .limit(1)
            .maybeSingle();
          if (openRun) {
            checkinRunId = openRun.id as string;
          } else {
            const inspectionNumber = `RCN-${String(line.rental_contract_id).slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
            const { data: run, error: runError } = await admin
              .from("inspection_runs")
              .insert({
                workspace_id: workspaceId,
                template_id: templateId,
                inspection_number: inspectionNumber,
                rental_contract_id: line.rental_contract_id,
                equipment_id: line.equipment_id,
                inspector_id: auth.userId,
                started_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (runError || !run) throw new Error(runError?.message ?? "check-in run create failed");
            checkinRunId = run.id as string;
          }
        } catch (err) {
          warnings.push(
            `checkin_inspection_failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return safeJsonOk(
        {
          line: updated,
          return_id: returnId,
          checkin_run_id: checkinRunId,
          ...(warnings.length ? { warnings } : {}),
        },
        origin,
      );
    }

    if (body.action === "complete_checkin_inspection") {
      // L9.1: completing the check-in inspection routes the return —
      // damage found → damage_assessment (disposition decision pending),
      // clean → clean_return. The m805 fleet gate releases availability
      // when the return leaves the pending set.
      if (!body.run_id) return safeJsonError("run_id required", 400, origin);
      const { data: run, error } = await admin
        .from("inspection_runs")
        .update({
          completed_at: new Date().toISOString(),
          machine_hours: toMeter(body.machine_hours),
          damage_found: body.damage_found === true,
          damage_description: typeof body.damage_description === "string" ? body.damage_description : null,
        })
        .eq("id", body.run_id)
        .eq("workspace_id", workspaceId)
        .not("rental_contract_id", "is", null)
        .is("completed_at", null)
        .select("id, rental_contract_id, equipment_id, completed_at, machine_hours, damage_found")
        .maybeSingle();
      if (error) return safeJsonError(error.message ?? "Failed to complete the inspection", 500, origin);
      if (!run) return safeJsonError("Inspection run not found (or already completed)", 400, origin);

      const damageFound = body.damage_found === true;
      const { data: updatedReturn, error: returnError } = await admin
        .from("rental_returns")
        .update({
          status: damageFound ? "damage_assessment" : "clean_return",
          has_charges: damageFound ? true : false,
          inspection_date: new Date().toISOString().slice(0, 10),
          inspector_id: auth.userId,
          ...(damageFound && typeof body.damage_description === "string"
            ? { damage_description: body.damage_description }
            : {}),
        })
        .eq("workspace_id", workspaceId)
        .eq("rental_contract_id", run.rental_contract_id)
        .eq("equipment_id", run.equipment_id)
        .in("status", ["inspection_pending", "decision_pending"])
        .select("id, status, has_charges")
        .maybeSingle();
      if (returnError) {
        return safeJsonError(returnError.message ?? "Failed to route the return", 500, origin);
      }

      return safeJsonOk({ run, return: updatedReturn ?? null }, origin);
    }

    if (body.action === "release_hold") {
      // Held lines (hour-usage holds) resume without trunk movement — a held
      // line already counts as on-rent in the rollup. Off-rent reactivation is
      // deliberately NOT this action: that is a new rental event.
      if (!body.line_id) return safeJsonError("line_id required", 400, origin);
      const { data: updated, error } = await admin
        .from("rental_contract_lines")
        .update({ status: "active", return_code: null })
        .eq("id", body.line_id)
        .eq("workspace_id", workspaceId)
        .eq("status", "held")
        .select("id, status, return_code")
        .maybeSingle();
      if (error) return safeJsonError(error.message ?? "Failed to release hold", 500, origin);
      if (!updated) return safeJsonError("Line is not held (or not found)", 400, origin);
      return safeJsonOk({ line: updated }, origin);
    }

    if (body.action === "dispose_damage") {
      // L2 pin (mig 772): who pays is a decision. customer_billable opens a
      // renter-fault H10 job (bills the customer); warranty/internal_wear open
      // a non-billable internal job posting to the rental unit; dispute
      // escalates to the exception queue and stays pending.
      if (!body.return_id) return safeJsonError("return_id required", 400, origin);
      if (!body.disposition || !["customer_billable", "warranty", "internal_wear", "dispute"].includes(body.disposition)) {
        return safeJsonError("disposition must be customer_billable, warranty, internal_wear, or dispute", 400, origin);
      }

      const { data: ret, error: retError } = await admin
        .from("rental_returns")
        .select("id, equipment_id, rental_contract_id, damage_disposition, damage_description, damage_charge_cents, charge_amount")
        .eq("id", body.return_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (retError || !ret) return safeJsonError("Rental return not found", 404, origin);
      if (ret.damage_disposition !== "pending") {
        return safeJsonError(`Damage already disposed as '${ret.damage_disposition}'`, 400, origin);
      }

      if (body.disposition === "dispute") {
        const { error: excError } = await admin.rpc("enqueue_exception", {
          p_source: "rental_damage_dispute",
          p_title: "Rental damage disposition disputed",
          p_severity: "warn",
          p_detail: `Return ${ret.id} damage disposition escalated: ${body.notes ?? ret.damage_description ?? "no detail provided"}`,
          p_payload: { return_id: ret.id, rental_contract_id: ret.rental_contract_id },
          p_entity_table: "rental_returns",
          p_entity_id: ret.id,
        });
        if (excError) return safeJsonError(excError.message ?? "Failed to escalate dispute", 500, origin);
        return safeJsonOk({ return_id: ret.id, disposition: "pending", escalated: true }, origin);
      }

      const renterFault = body.disposition === "customer_billable";

      // L9.2: renter-fault work orders carry the paying customer + the
      // return backlink so the close loop can advance the return. The
      // damage itself bills on the FINAL RENTAL INVOICE only —
      // generateInvoiceForServiceJob refuses rental_fleet_maintenance jobs.
      let customerId: string | null = null;
      if (ret.rental_contract_id) {
        const { data: contract } = await admin
          .from("rental_contracts")
          .select("qrm_company_id")
          .eq("id", ret.rental_contract_id)
          .maybeSingle();
        customerId = (contract?.qrm_company_id as string | null) ?? null;
      }

      let serviceJobId: string | null = null;
      if (ret.equipment_id) {
        const { data: job, error: jobError } = await admin
          .from("service_jobs")
          .insert({
            workspace_id: workspaceId,
            machine_id: ret.equipment_id,
            customer_id: customerId,
            rental_return_id: ret.id,
            request_type: "internal",
            customer_problem_summary:
              `Rental return damage (${body.disposition}): ` +
              (ret.damage_description ?? body.notes ?? "see return inspection"),
            service_internal_work_class: "rental_fleet_maintenance",
            service_internal_cost_destination: renterFault ? null : "rental_unit",
            renter_fault_billable: renterFault,
            internal_cost_posting_status: renterFault ? "not_applicable" : "pending",
          })
          .select("id")
          .single();
        if (jobError || !job) {
          return safeJsonError(jobError?.message ?? "Disposition not applied: work order insert failed", 500, origin);
        }
        serviceJobId = job.id as string;
      }

      // L9.2: persist assessed amounts as true cents — the billing
      // assembler treats raw values as cents, so the wizard's legacy
      // dollar charge_amount converts ×100 when explicit cents are absent.
      const damageCents = toMeter(body.damage_charge_cents) ??
        (typeof ret.charge_amount === "number" && ret.charge_amount > 0
          ? Math.round(ret.charge_amount * 100)
          : null);
      const fuelCents = toMeter(body.fuel_charge_cents);
      const cleaningCents = toMeter(body.cleaning_charge_cents);
      const environmentalCents = toMeter(body.environmental_fee_cents);

      const { data: updated, error: updError } = await admin
        .from("rental_returns")
        .update({
          damage_disposition: body.disposition,
          work_order_number: serviceJobId ?? undefined,
          status: serviceJobId ? "work_order_open" : "damage_assessment",
          ...(damageCents != null ? { damage_charge_cents: Math.round(damageCents) } : {}),
          ...(fuelCents != null ? { fuel_charge_cents: Math.round(fuelCents) } : {}),
          ...(cleaningCents != null ? { cleaning_charge_cents: Math.round(cleaningCents) } : {}),
          ...(environmentalCents != null ? { environmental_fee_cents: Math.round(environmentalCents) } : {}),
        })
        .eq("id", ret.id)
        .eq("workspace_id", workspaceId)
        .select("id, damage_disposition, work_order_number, status, damage_charge_cents")
        .single();
      if (updError || !updated) {
        return safeJsonError(updError?.message ?? "Work order opened but return update failed", 500, origin);
      }
      return safeJsonOk({ return: updated, service_job_id: serviceJobId }, origin);
    }

    if (body.action === "approve_booking") {
      if (!body.contract_id) return safeJsonError("contract_id required", 400, origin);
      const depositAmount = toCurrencyAmount(body.deposit_amount);
      const equipmentId = typeof body.equipment_id === "string" && body.equipment_id.trim() ? body.equipment_id.trim() : null;
      if (!equipmentId) return safeJsonError("equipment_id required", 400, origin);

      const { data: contract, error: contractError } = await admin
        .from("rental_contracts")
        .select("id, workspace_id, portal_customer_id, equipment_id, branch_id, requested_start_date, requested_end_date, estimate_daily_rate, estimate_weekly_rate, estimate_monthly_rate, deposit_required, deposit_amount, deposit_invoice_id, status, assignment_status, dealer_response")
        .eq("id", body.contract_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (contractError || !contract) return safeJsonError("Rental contract not found", 404, origin);

      const currentContract = contract as RentalContractRow;
      if (!["submitted", "reviewing", "quoted", "approved", "awaiting_payment"].includes(currentContract.status)) {
        return safeJsonError("This rental contract can no longer be approved from the queue", 400, origin);
      }

      const { data: equipment, error: equipmentError } = await admin
        .from("crm_equipment")
        .select("id, availability")
        .eq("workspace_id", workspaceId)
        .eq("id", equipmentId)
        .eq("ownership", "rental_fleet")
        .maybeSingle();
      if (equipmentError || !equipment) return safeJsonError("Assigned rental unit not found", 404, origin);
      if (equipment.availability !== "available") return safeJsonError("Assigned rental unit is not available", 400, origin);

      const { data: customer, error: customerError } = await admin
        .from("portal_customers")
        .select("id, workspace_id, crm_company_id")
        .eq("id", currentContract.portal_customer_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (customerError || !customer) return safeJsonError("Portal customer not found for this rental request", 404, origin);

      // M4.1 rate floor: approval is where estimate_* becomes agreed_*.
      const bookingBranchId = typeof body.branch_id === "string" && body.branch_id.trim() ? body.branch_id.trim() : null;
      const rateFloor = await evaluateRentalRateFloor(admin, {
        workspaceId,
        agreedDaily: currentContract.estimate_daily_rate == null ? null : Number(currentContract.estimate_daily_rate),
        agreedWeekly: currentContract.estimate_weekly_rate == null ? null : Number(currentContract.estimate_weekly_rate),
        agreedMonthly: currentContract.estimate_monthly_rate == null ? null : Number(currentContract.estimate_monthly_rate),
        equipmentId,
        companyId: (customer.crm_company_id as string | null) ?? null,
        branchId: bookingBranchId,
      });
      const rateFloorBlock = await enforceRateFloor(
        admin,
        workspaceId,
        currentContract.id,
        auth.userId,
        auth.role,
        rateFloor,
        body.override_rate_floor === true,
        origin,
      );
      if (rateFloorBlock) return rateFloorBlock;

      let depositInvoiceId: string | null = null;
      let status = "active";
      let depositStatus: string | null = "not_required";

      if (depositAmount > 0) {
        const numberingBranch = await resolveNumberingBranch(admin, workspaceId, bookingBranchId);
        const depositNumber = await mintRentalInvoiceNumber(admin, workspaceId, numberingBranch);
        const invoice = await createRentalInvoice(
          admin,
          customer as PortalCustomerRow,
          "Rental deposit",
          depositNumber,
          depositAmount,
        );
        depositInvoiceId = invoice.id;
        status = "awaiting_payment";
        depositStatus = "pending";
      }

      const { data: updated, error } = await admin
        .from("rental_contracts")
        .update({
          equipment_id: equipmentId,
          assignment_status: "assigned",
          branch_id: typeof body.branch_id === "string" && body.branch_id.trim() ? body.branch_id.trim() : null,
          approved_start_date: currentContract.requested_start_date,
          approved_end_date: currentContract.requested_end_date,
          agreed_daily_rate: currentContract.estimate_daily_rate,
          agreed_weekly_rate: currentContract.estimate_weekly_rate,
          agreed_monthly_rate: currentContract.estimate_monthly_rate,
          deposit_required: depositAmount > 0,
          deposit_amount: depositAmount > 0 ? depositAmount : null,
          deposit_invoice_id: depositInvoiceId,
          deposit_status: depositStatus,
          dealer_response: typeof body.dealer_response === "string" ? body.dealer_response : null,
          status,
        })
        .eq("id", currentContract.id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();
      if (error) return safeJsonError(error.message ?? "Failed to approve rental booking", 500, origin);
      return safeJsonOk({ contract: updated }, origin);
    }

    if (body.action === "decline_booking") {
      if (!body.contract_id) return safeJsonError("contract_id required", 400, origin);
      const { data: updated, error } = await admin
        .from("rental_contracts")
        .update({
          status: "declined",
          dealer_response: typeof body.dealer_response === "string" ? body.dealer_response : "Rental request declined by dealership.",
        })
        .eq("id", body.contract_id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();
      if (error || !updated) return safeJsonError("Failed to decline rental booking", 500, origin);
      return safeJsonOk({ contract: updated }, origin);
    }

    if (body.action === "approve_extension") {
      if (!body.extension_id) return safeJsonError("extension_id required", 400, origin);
      const additionalCharge = toCurrencyAmount(body.additional_charge);

      const { data: extension, error: extensionError } = await admin
        .from("rental_contract_extensions")
        .select("id, workspace_id, rental_contract_id, requested_end_date, approved_end_date, status, dealer_response, additional_charge, payment_invoice_id, payment_status")
        .eq("id", body.extension_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (extensionError || !extension) return safeJsonError("Rental extension request not found", 404, origin);

      const currentExtension = extension as RentalExtensionRow;
      if (!["submitted", "reviewing", "approved"].includes(currentExtension.status)) {
        return safeJsonError("This rental extension can no longer be approved from the queue", 400, origin);
      }

      const { data: contract, error: contractError } = await admin
        .from("rental_contracts")
        .select("id, workspace_id, portal_customer_id, status, branch_id")
        .eq("id", currentExtension.rental_contract_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (contractError || !contract) return safeJsonError("Rental contract not found for extension approval", 404, origin);

      const { data: customer, error: customerError } = await admin
        .from("portal_customers")
        .select("id, workspace_id, crm_company_id")
        .eq("id", contract.portal_customer_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (customerError || !customer) return safeJsonError("Portal customer not found for extension approval", 404, origin);

      let paymentInvoiceId: string | null = null;
      let paymentStatus: string | null = "not_required";

      if (additionalCharge > 0) {
        const extensionBranch = await resolveNumberingBranch(
          admin,
          workspaceId,
          (contract.branch_id as string | null) ?? null,
        );
        const extensionNumber = await mintRentalInvoiceNumber(admin, workspaceId, extensionBranch);
        const invoice = await createRentalInvoice(
          admin,
          customer as PortalCustomerRow,
          "Rental extension charge",
          extensionNumber,
          additionalCharge,
        );
        paymentInvoiceId = invoice.id;
        paymentStatus = "pending";
      } else {
        const { error: contractUpdateError } = await admin
          .from("rental_contracts")
          .update({
            approved_end_date: currentExtension.requested_end_date,
            requested_end_date: currentExtension.requested_end_date,
          })
          .eq("id", currentExtension.rental_contract_id)
          .eq("workspace_id", workspaceId);
        if (contractUpdateError) {
          return safeJsonError(contractUpdateError.message ?? "Failed to extend rental contract", 500, origin);
        }
      }

      const { data: updated, error } = await admin
        .from("rental_contract_extensions")
        .update({
          status: "approved",
          approved_end_date: currentExtension.requested_end_date,
          dealer_response: typeof body.dealer_response === "string" ? body.dealer_response : null,
          additional_charge: additionalCharge > 0 ? additionalCharge : null,
          payment_invoice_id: paymentInvoiceId,
          payment_status: paymentStatus,
        })
        .eq("id", currentExtension.id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();
      if (error) return safeJsonError(error.message ?? "Failed to approve rental extension", 500, origin);
      return safeJsonOk({ extension: updated }, origin);
    }

    if (body.action === "decline_extension") {
      if (!body.extension_id) return safeJsonError("extension_id required", 400, origin);
      const { data: updated, error } = await admin
        .from("rental_contract_extensions")
        .update({
          status: "declined",
          dealer_response: typeof body.dealer_response === "string" ? body.dealer_response : "Extension request declined by dealership.",
        })
        .eq("id", body.extension_id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();
      if (error || !updated) return safeJsonError("Failed to decline rental extension", 500, origin);
      return safeJsonOk({ extension: updated }, origin);
    }

    return safeJsonError("Unknown rental ops action", 400, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "rental-ops", req });
    console.error("rental-ops:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
