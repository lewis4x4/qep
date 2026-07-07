import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

type BookingApprovalPayload = {
  action: "approve_booking";
  contract_id?: string;
  equipment_id?: string | null;
  branch_id?: string | null;
  dealer_response?: string | null;
  deposit_amount?: number | string | null;
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

type RentalOpsPayload =
  | BookingApprovalPayload
  | BookingDeclinePayload
  | ExtensionApprovalPayload
  | ExtensionDeclinePayload
  | CounterContractPayload
  | ExchangeLinePayload;

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

      const dailyRate = toCurrencyAmount(body.daily_rate);
      const weeklyRate = toCurrencyAmount(body.weekly_rate);
      const monthlyRate = toCurrencyAmount(body.monthly_rate);
      const deliveryMode = body.delivery_mode === "delivery" ? "delivery" : "pickup";

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

      return safeJsonOk({ contract }, origin);
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

      let depositInvoiceId: string | null = null;
      let status = "active";
      let depositStatus: string | null = "not_required";

      if (depositAmount > 0) {
        const invoice = await createRentalInvoice(
          admin,
          customer as PortalCustomerRow,
          "Rental deposit",
          `RENT-${Date.now()}`,
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
        .select("id, workspace_id, portal_customer_id, status")
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
        const invoice = await createRentalInvoice(
          admin,
          customer as PortalCustomerRow,
          "Rental extension charge",
          `EXT-${Date.now()}`,
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
