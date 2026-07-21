/**
 * equipment-invoice.ts — I/O wrapper that turns a delivered/won equipment deal
 * into a customer_invoices row (Stream M / M1.1, blueprint §2).
 *
 * The money math is the PURE planner in shared/equipment-invoice-core.ts;
 * sales tax is the same canon the tax-calculator edge fn uses
 * (tax-calculator/tax-logic.ts). This module only loads rows, calls both,
 * and writes the results.
 *
 * Zero-blocking contract: tax/GL/deposit/equipment-state failures degrade to
 * exception_queue entries and warnings — the invoice row itself only fails to
 * post if the deal/package/numbering/insert layer fails, and the caller
 * (equipment-invoice-runner) dead-letters that deal without aborting its run.
 *
 * Writing in_out_state='sold' + availability='sold' + delivery_date here is
 * what makes the m536/540/659/667 reversal foundation operable: the reversal
 * RPCs hard-require in_out_state='sold' and locate the invoice through
 * customer_invoices.qrm_equipment_id + invoice_type='equipment'.
 */

import {
  type DepositSnapshot,
  equipmentEntriesFromQuote,
  type EquipmentQuotePackageSnapshot,
  planEquipmentInvoice,
  type TaxJurisdictionSnapshot,
} from "../../../shared/equipment-invoice-core.ts";
import {
  computeQuoteTax,
  type QuoteTaxProfile,
} from "../tax-calculator/tax-logic.ts";
import { publishFlowEvent } from "./flow-bus/publish.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type EquipmentInvoiceResult =
  | {
    status: "skipped";
    reason: "deal_not_found" | "already_invoiced" | "no_accepted_quote";
    invoiceId?: string;
  }
  | {
    status: "created";
    invoiceId: string;
    invoiceNumber: string;
    total: number;
    taxCounty: string | null;
    equipmentIds: string[];
    warnings: string[];
  };

const QUOTE_ACCEPTED_STATUSES = ["accepted", "converted_to_deal"];

const VALID_TAX_PROFILES = new Set<QuoteTaxProfile>([
  "standard",
  "agriculture_exempt",
  "fire_mitigation_exempt",
  "government_exempt",
  "resale_exempt",
]);

function asTaxProfile(value: string | null): QuoteTaxProfile {
  return value && VALID_TAX_PROFILES.has(value as QuoteTaxProfile)
    ? (value as QuoteTaxProfile)
    : "standard";
}

async function enqueueException(
  admin: AdminClient,
  input: {
    source: string;
    title: string;
    severity: "info" | "warn" | "error" | "critical";
    detail: string;
    payload: Record<string, unknown>;
    entityTable: string | null;
    entityId: string | null;
  },
): Promise<void> {
  const { error } = await admin.rpc("enqueue_exception", {
    p_source: input.source,
    p_title: input.title.slice(0, 200),
    p_severity: input.severity,
    p_detail: input.detail.slice(0, 1000),
    p_payload: input.payload,
    p_entity_table: input.entityTable,
    p_entity_id: input.entityId,
  });
  if (error) console.error("enqueue_exception failed:", error.message ?? error);
}

export async function generateInvoiceForEquipmentDeal(
  admin: AdminClient,
  dealId: string,
): Promise<EquipmentInvoiceResult> {
  const { data: deal, error: dealError } = await admin
    .from("crm_deals")
    .select("id, workspace_id, company_id, assigned_rep_id")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (dealError) throw new Error(`deal load failed: ${dealError.message}`);
  if (!deal) return { status: "skipped", reason: "deal_not_found" };

  const workspaceId = (deal.workspace_id as string) ?? "default";

  const { data: existing } = await admin
    .from("customer_invoices")
    .select("id")
    .eq("deal_id", dealId)
    .eq("invoice_type", "equipment")
    .is("reversal_of_invoice_id", null)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      status: "skipped",
      reason: "already_invoiced",
      invoiceId: existing.id as string,
    };
  }

  const { data: quote, error: quoteError } = await admin
    .from("quote_packages")
    .select(
      "id, subtotal, equipment_total, attachment_total, trade_allowance, trade_credit, tax_profile, tax_override_amount, tax_override_reason, fet_total, fet_rate, fet_taxable_amount, fet_exemption_certificate_id, equipment",
    )
    .eq("deal_id", dealId)
    .in("status", QUOTE_ACCEPTED_STATUSES)
    .order("accepted_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (quoteError) {
    throw new Error(`quote package load failed: ${quoteError.message}`);
  }
  if (!quote) return { status: "skipped", reason: "no_accepted_quote" };

  const warnings: string[] = [];

  const { data: junction } = await admin
    .from("crm_deal_equipment")
    .select("equipment_id")
    .eq("deal_id", dealId)
    .eq("role", "subject");
  const subjectIds = (junction ?? []).map((row: { equipment_id: string }) =>
    row.equipment_id
  );

  let subjectEquipment: Array<
    { id: string; stock_number: string | null; home_branch_id: string | null }
  > = [];
  if (subjectIds.length > 0) {
    const { data: units } = await admin
      .from("qrm_equipment")
      .select("id, stock_number, home_branch_id")
      .in("id", subjectIds)
      .is("deleted_at", null);
    subjectEquipment = units ?? [];
  }

  const { data: deposits } = await admin
    .from("deposits")
    .select("id, status, required_amount")
    .eq("workspace_id", workspaceId)
    .eq("deal_id", dealId)
    .in("status", ["verified", "received"]);

  let portalCustomerId: string | null = null;
  if (deal.company_id) {
    const { data: portal } = await admin
      .from("portal_customers")
      .select("id")
      .eq("crm_company_id", deal.company_id as string)
      .limit(1)
      .maybeSingle();
    portalCustomerId = (portal?.id as string | undefined) ?? null;
  }

  let shipTo:
    | { id: string; county_name: string | null; state: string | null }
    | null = null;
  if (deal.company_id) {
    const { data: shipToRow } = await admin
      .from("qrm_company_ship_to_addresses")
      .select("id, county_name, state")
      .eq("company_id", deal.company_id as string)
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    shipTo = shipToRow ?? null;
  }

  let branch: {
    id: string;
    slug: string | null;
    legacy_code: string | null;
    state_province: string | null;
  } | null = null;
  const homeBranchId =
    subjectEquipment.find((unit) => unit.home_branch_id)?.home_branch_id ??
      null;
  if (homeBranchId) {
    const { data: branchRow } = await admin
      .from("branches")
      .select("id, slug, legacy_code, state_province")
      .eq("id", homeBranchId)
      .maybeSingle();
    branch = branchRow ?? null;
  }
  if (!branch) {
    const { data: fallbackBranch } = await admin
      .from("branches")
      .select("id, slug, legacy_code, state_province")
      .eq("workspace_id", workspaceId)
      .not("legacy_code", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    branch = fallbackBranch ?? null;
  }

  const shipToCounty = shipTo?.county_name ?? null;
  const stateCode = shipTo?.state ?? branch?.state_province ?? "FL";

  let jurisdiction: TaxJurisdictionSnapshot | null = null;
  if (shipTo || shipToCounty) {
    const { data: jurisdictionRow, error: jurisdictionError } = await admin.rpc(
      "qep_resolve_fl_tax_jurisdiction",
      {
        p_workspace_id: workspaceId,
        p_ship_to_address_id: shipTo?.id ?? null,
        p_county_name: shipToCounty,
        p_effective_date: new Date().toISOString().slice(0, 10),
      },
    );
    if (jurisdictionError) {
      warnings.push(`jurisdiction_lookup_failed: ${jurisdictionError.message}`);
    } else {
      const row = Array.isArray(jurisdictionRow)
        ? jurisdictionRow[0]
        : jurisdictionRow;
      if (row && (row as { id?: string }).id) {
        jurisdiction = row as TaxJurisdictionSnapshot;
      }
    }
  }

  const quoteSnapshot = quote as unknown as EquipmentQuotePackageSnapshot & {
    tax_override_amount: number | string | null;
    tax_override_reason: string | null;
  };
  const entries = equipmentEntriesFromQuote(quoteSnapshot.equipment);
  const tradeAllowanceNumber = Number(quoteSnapshot.trade_allowance ?? 0);
  const tradeCreditNumber = Number(quoteSnapshot.trade_credit ?? 0);
  const tradeForTax = tradeAllowanceNumber > 0
    ? tradeAllowanceNumber
    : tradeCreditNumber;
  const subtotalForTax = Number(quoteSnapshot.subtotal ?? 0) ||
    Number(quoteSnapshot.equipment_total ?? 0) +
      Number(quoteSnapshot.attachment_total ?? 0);

  let salesTax = null;
  let taxFailureReason: string | null = null;
  try {
    salesTax = computeQuoteTax({
      subtotal: subtotalForTax,
      discountTotal: 0,
      tradeAllowance: tradeForTax,
      taxProfile: asTaxProfile(quoteSnapshot.tax_profile),
      stateCode,
      shipToCounty,
      jurisdiction,
      lineItems: entries.map((entry) => ({
        description: entry.description,
        taxable_amount: entry.quantity * entry.unitPrice,
        taxable: true,
      })),
      taxOverrideAmount: quoteSnapshot.tax_override_amount == null
        ? null
        : Number(quoteSnapshot.tax_override_amount),
      taxOverrideReason: quoteSnapshot.tax_override_reason,
    });
  } catch (err) {
    taxFailureReason = err instanceof Error ? err.message : String(err);
  }

  const invoiceDate = new Date().toISOString().slice(0, 10);
  const plan = planEquipmentInvoice({
    quotePackage: quoteSnapshot,
    deposits: (deposits ?? []) as DepositSnapshot[],
    salesTax,
    taxFailureReason,
    jurisdiction,
    invoiceDate,
  });

  const { data: invoiceNumber, error: numberError } = await admin.rpc(
    "next_invoice_number",
    {
      p_workspace_id: workspaceId,
      p_branch_legacy_code: branch?.legacy_code ?? "00",
      p_invoice_type: "equipment",
    },
  );
  if (numberError || typeof invoiceNumber !== "string") {
    throw new Error(
      `invoice numbering failed: ${
        numberError?.message ?? "no number returned"
      }`,
    );
  }

  const primaryEquipmentId = subjectEquipment[0]?.id ?? null;

  const { data: inserted, error: insertError } = await admin
    .from("customer_invoices")
    .insert({
      workspace_id: workspaceId,
      portal_customer_id: portalCustomerId,
      crm_company_id: (deal.company_id as string | null) ?? null,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: plan.dueDate,
      description: `Equipment sale — quote ${
        String(quoteSnapshot.id).slice(0, 8)
      }`,
      amount: plan.amount,
      tax: plan.tax,
      total: plan.total,
      // Deposit cash is applied only by the atomic liability-ledger RPC below.
      // Starting at zero keeps a posted invoice honest if that RPC rejects its
      // evidence or otherwise fails after the AR header has been created.
      amount_paid: 0,
      status: "pending",
      deal_id: dealId,
      invoice_type: "equipment",
      invoice_source_code: "EQUIPMENT",
      qrm_equipment_id: primaryEquipmentId,
      branch_id: branch?.slug ?? null,
      salesperson_id: (deal.assigned_rep_id as string | null) ?? null,
      ship_to_address_id: shipTo?.id ?? null,
      tax_breakdown: plan.taxBreakdown,
      tax_code_1: plan.taxCode1,
      tax_code_2: plan.taxCode2,
      dr15_county_name: shipToCounty,
      fet_amount: plan.fetAmount,
      fet_rate: quoteSnapshot.fet_rate == null
        ? null
        : Number(quoteSnapshot.fet_rate),
      fet_taxable_amount: quoteSnapshot.fet_taxable_amount == null
        ? null
        : Number(quoteSnapshot.fet_taxable_amount),
      fet_exemption_certificate_id: quoteSnapshot.fet_exemption_certificate_id,
      fet_liability_status: plan.fetLiabilityStatus,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new Error(
      `invoice insert failed: ${insertError?.message ?? "no row returned"}`,
    );
  }
  const invoiceId = inserted.id as string;

  const { error: linesError } = await admin
    .from("customer_invoice_line_items")
    .insert(plan.lines.map((line, index) => ({
      workspace_id: workspaceId,
      invoice_id: invoiceId,
      line_number: index + 1,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      finance_department: "equipment",
      finance_segment: "customer",
      finance_category: "equipment",
      finance_classification_source: "accepted_equipment_quote",
      finance_classified_at: new Date().toISOString(),
    })));
  if (linesError) {
    warnings.push(`line_items_insert_failed: ${linesError.message}`);
    await enqueueException(admin, {
      source: "equipment_billing_failed",
      title: `Equipment invoice ${invoiceNumber} posted without line items`,
      severity: "error",
      detail: linesError.message,
      payload: { invoice_id: invoiceId, deal_id: dealId },
      entityTable: "customer_invoices",
      entityId: invoiceId,
    });
  }

  if (
    plan.taxFailed ||
    (!plan.taxFailed && stateCode?.toUpperCase() === "FL" && !shipToCounty)
  ) {
    await enqueueException(admin, {
      source: "tax_failed",
      title: plan.taxFailed
        ? `Equipment invoice ${invoiceNumber} posted without tax`
        : `Equipment invoice ${invoiceNumber} taxed state-only (no ship-to county)`,
      severity: "warn",
      detail: plan.taxFailed
        ? (taxFailureReason ?? "tax computation failed")
        : "No ship-to county on file for the customer; FL county surtax was not applied. Fix the ship-to address and re-issue or adjust.",
      payload: {
        invoice_id: invoiceId,
        deal_id: dealId,
        state_code: stateCode,
        ship_to_county: shipToCounty,
      },
      entityTable: "customer_invoices",
      entityId: invoiceId,
    });
    if (!plan.taxFailed) warnings.push("state_only_tax_no_county");
  }

  let appliedDepositCents = 0;
  let appliedInvoiceStatus: "pending" | "partial" | "paid" = "pending";
  if (plan.appliedDepositIds.length > 0) {
    const { data: depositResult, error: depositError } = await admin.rpc(
      "apply_sale_deposits_to_invoice",
      {
        p_workspace_id: workspaceId,
        p_customer_invoice_id: invoiceId,
        p_deposit_ids: plan.appliedDepositIds,
      },
    );
    if (depositError) {
      warnings.push(`deposit_application_failed: ${depositError.message}`);
      await enqueueException(admin, {
        source: "equipment_billing_failed",
        title: `Deposit application failed for invoice ${invoiceNumber}`,
        severity: "warn",
        detail: depositError.message,
        payload: {
          invoice_id: invoiceId,
          deal_id: dealId,
          deposit_ids: plan.appliedDepositIds,
        },
        entityTable: "customer_invoices",
        entityId: invoiceId,
      });
    } else {
      const result = Array.isArray(depositResult)
        ? depositResult[0]
        : depositResult;
      const paidCents = Number(
        (result as { invoice_amount_paid_cents?: unknown } | null)
          ?.invoice_amount_paid_cents ?? 0,
      );
      const status = (result as { invoice_status?: unknown } | null)
        ?.invoice_status;
      appliedDepositCents = Number.isFinite(paidCents)
        ? Math.max(0, paidCents)
        : 0;
      if (status === "partial" || status === "paid") {
        appliedInvoiceStatus = status;
      }
    }
  }

  if (subjectEquipment.length > 0) {
    const { error: equipmentError } = await admin
      .from("qrm_equipment")
      .update({
        in_out_state: "sold",
        availability: "sold",
        delivery_date: invoiceDate,
      })
      .in("id", subjectEquipment.map((unit) => unit.id));
    if (equipmentError) {
      warnings.push(`equipment_sold_state_failed: ${equipmentError.message}`);
      await enqueueException(admin, {
        source: "equipment_billing_failed",
        title: `Sold-state write failed for invoice ${invoiceNumber}`,
        severity: "error",
        detail:
          `${equipmentError.message} — reversal foundation requires in_out_state='sold'`,
        payload: {
          invoice_id: invoiceId,
          deal_id: dealId,
          equipment_ids: subjectEquipment.map((u) => u.id),
        },
        entityTable: "customer_invoices",
        entityId: invoiceId,
      });
    }
  } else {
    warnings.push("no_subject_equipment_linked");
    await enqueueException(admin, {
      source: "data_quality",
      title: `Equipment invoice ${invoiceNumber} has no subject equipment link`,
      severity: "warn",
      detail:
        "Deal has no crm_deal_equipment role='subject' row; invoice posted without qrm_equipment_id, so the sale reversal path cannot find it by stock number.",
      payload: { invoice_id: invoiceId, deal_id: dealId },
      entityTable: "customer_invoices",
      entityId: invoiceId,
    });
  }

  try {
    const { error: glError } = await admin
      .from("quickbooks_gl_sync_jobs")
      .upsert({
        workspace_id: workspaceId,
        invoice_id: invoiceId,
        source_type: "customer_invoice",
        posting_mode: "journal_entry",
        status: "queued",
      }, { onConflict: "invoice_id" });
    if (glError) throw new Error(glError.message);
    await admin
      .from("customer_invoices")
      .update({
        quickbooks_gl_status: "queued",
        quickbooks_gl_last_error: null,
      })
      .eq("id", invoiceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`gl_enqueue_failed: ${message}`);
    await enqueueException(admin, {
      source: "equipment_billing_failed",
      title: `GL enqueue failed for invoice ${invoiceNumber}`,
      severity: "warn",
      detail: message,
      payload: { invoice_id: invoiceId, deal_id: dealId },
      entityTable: "customer_invoices",
      entityId: invoiceId,
    });
  }

  try {
    await publishFlowEvent(admin, {
      workspaceId,
      eventType: "deal.invoiced",
      sourceModule: "equipment-invoice-runner",
      dealId,
      companyId: (deal.company_id as string | null) ?? undefined,
      equipmentId: primaryEquipmentId ?? undefined,
      payload: {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        total: plan.total,
        tax: plan.tax,
        amount_paid: appliedDepositCents / 100,
        invoice_status: appliedInvoiceStatus,
        invoice_type: "equipment",
      },
      idempotencyKey: `deal.invoiced:${dealId}`,
    });
  } catch (err) {
    warnings.push(
      `flow_event_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    status: "created",
    invoiceId,
    invoiceNumber,
    total: plan.total,
    taxCounty: shipToCounty,
    equipmentIds: subjectEquipment.map((unit) => unit.id),
    warnings,
  };
}
