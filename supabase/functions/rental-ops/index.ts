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

type RentalOpsPayload =
  | BookingApprovalPayload
  | BookingDeclinePayload
  | ExtensionApprovalPayload
  | ExtensionDeclinePayload;

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
