/**
 * parts-invoice.ts — turns a delivered parts order into a customer_invoices
 * row + line detail (Stream M / M2.1, blueprint §2, §6).
 *
 * Mirrors _shared/equipment-invoice.ts: same numbering (next_invoice_number
 * 'parts' → P prefix), same county-tax canon (tax-calculator/tax-logic.ts +
 * qep_resolve_fl_tax_jurisdiction), same GL enqueue, same zero-blocking
 * degrade to exception_queue. Two line tables are written:
 *   - customer_invoice_line_items — the generic detail the QuickBooks
 *     journal builder reads
 *   - parts_invoice_lines — the m468 parts audit contract (cents-based),
 *     which had zero insert paths repo-wide before this writer
 *
 * Counter tender (payment_status='paid' + tender_type/tender_amount from
 * m789) settles the invoice at generation: amount_paid = min(tender, total),
 * so cash counter sales post as 'paid' and never age, while charge-account
 * tickets post 'pending' and flow into AR aging / dunning / credit holds.
 */

import { computeQuoteTax } from "../tax-calculator/tax-logic.ts";
import { publishFlowEvent } from "./flow-bus/publish.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type PartsInvoiceResult =
  | { status: "skipped"; reason: "order_not_found" | "already_invoiced" | "no_lines"; invoiceId?: string }
  | {
    status: "created";
    invoiceId: string;
    invoiceNumber: string;
    total: number;
    tax: number;
    amountPaid: number;
    taxCounty: string | null;
    warnings: string[];
  };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toCents(value: number): number {
  return Math.max(0, Math.round(value * 100));
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

export async function generateInvoiceForPartsOrder(
  admin: AdminClient,
  orderId: string,
): Promise<PartsInvoiceResult> {
  const { data: order, error: orderError } = await admin
    .from("parts_orders")
    .select(
      "id, workspace_id, status, portal_customer_id, crm_company_id, subtotal, tax, shipping, total, payment_classification, payment_status, payment_received_at, payment_reference, tender_type, tender_amount, receipt_number, branch_id, order_source",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw new Error(`parts order load failed: ${orderError.message}`);
  if (!order) return { status: "skipped", reason: "order_not_found" };

  const workspaceId = (order.workspace_id as string) ?? "default";

  const { data: existing } = await admin
    .from("customer_invoices")
    .select("id")
    .eq("parts_order_id", orderId)
    .eq("invoice_type", "parts")
    .is("reversal_of_invoice_id", null)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { status: "skipped", reason: "already_invoiced", invoiceId: existing.id as string };
  }

  const { data: lines } = await admin
    .from("parts_order_lines")
    .select("id, catalog_item_id, part_number, description, quantity, unit_price, line_total, applied_discount_pct, sort_order")
    .eq("parts_order_id", orderId)
    .order("sort_order", { ascending: true });
  if (!lines || lines.length === 0) return { status: "skipped", reason: "no_lines" };

  const warnings: string[] = [];

  let crmCompanyId = (order.crm_company_id as string | null) ?? null;
  const portalCustomerId = (order.portal_customer_id as string | null) ?? null;
  if (!crmCompanyId && portalCustomerId) {
    const { data: portal } = await admin
      .from("portal_customers")
      .select("crm_company_id")
      .eq("id", portalCustomerId)
      .maybeSingle();
    crmCompanyId = (portal?.crm_company_id as string | null) ?? null;
  }

  let shipTo: { id: string; county_name: string | null; state: string | null } | null = null;
  if (crmCompanyId) {
    const { data: shipToRow } = await admin
      .from("qrm_company_ship_to_addresses")
      .select("id, county_name, state")
      .eq("company_id", crmCompanyId)
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    shipTo = shipToRow ?? null;
  }

  let branch: { id: string; slug: string | null; legacy_code: string | null; state_province: string | null } | null =
    null;
  if (order.branch_id) {
    const { data: branchRow } = await admin
      .from("branches")
      .select("id, slug, legacy_code, state_province")
      .eq("id", order.branch_id as string)
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

  let jurisdiction: Record<string, unknown> | null = null;
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
      const row = Array.isArray(jurisdictionRow) ? jurisdictionRow[0] : jurisdictionRow;
      if (row && (row as { id?: string }).id) jurisdiction = row as Record<string, unknown>;
    }
  }

  const lineAmounts = (lines as Array<Record<string, unknown>>).map((line) => ({
    description: `${line.part_number}${line.description ? ` — ${line.description}` : ""}`,
    quantity: Number(line.quantity ?? 1),
    unitPrice: round2(Number(line.unit_price ?? 0)),
    lineTotal: round2(Number(line.line_total ?? Number(line.quantity ?? 1) * Number(line.unit_price ?? 0))),
    catalogItemId: (line.catalog_item_id as string | null) ?? null,
    partNumber: String(line.part_number ?? ""),
    partDescription: (line.description as string | null) ?? null,
    discountPct: line.applied_discount_pct == null ? null : Number(line.applied_discount_pct),
  }));

  const subtotal = round2(
    Number(order.subtotal ?? 0) || lineAmounts.reduce((sum, line) => sum + line.lineTotal, 0),
  );
  const shipping = round2(Number(order.shipping ?? 0));

  let salesTax = null;
  let taxFailureReason: string | null = null;
  try {
    salesTax = computeQuoteTax({
      subtotal,
      discountTotal: 0,
      tradeAllowance: 0,
      taxProfile: "standard",
      stateCode,
      shipToCounty,
      jurisdiction: jurisdiction as never,
      lineItems: lineAmounts.map((line) => ({
        description: line.description,
        taxable_amount: line.lineTotal,
        taxable: true,
      })),
    });
  } catch (err) {
    taxFailureReason = err instanceof Error ? err.message : String(err);
  }

  const tax = salesTax ? round2(salesTax.total_tax) : 0;
  const amount = round2(subtotal + shipping);
  const total = round2(amount + tax);

  const paid = order.payment_status === "paid";
  const tenderAmount = order.tender_amount == null ? null : round2(Number(order.tender_amount));
  const amountPaid = paid ? round2(Math.min(tenderAmount ?? total, total)) : 0;
  const invoiceStatus = total > 0 && amountPaid >= total ? "paid" : amountPaid > 0 ? "partial" : "pending";

  const invoiceDate = new Date().toISOString().slice(0, 10);
  const due = new Date();
  due.setDate(due.getDate() + 30);

  const { data: invoiceNumber, error: numberError } = await admin.rpc("next_invoice_number", {
    p_workspace_id: workspaceId,
    p_branch_legacy_code: branch?.legacy_code ?? "00",
    p_invoice_type: "parts",
  });
  if (numberError || typeof invoiceNumber !== "string") {
    throw new Error(`invoice numbering failed: ${numberError?.message ?? "no number returned"}`);
  }

  const taxBreakdown: Record<string, unknown> = {
    source_label: "parts-invoice",
    tax_profile: "standard",
    county_name: (jurisdiction?.county_name as string | null) ?? null,
    state_rate: jurisdiction?.state_rate != null ? Number(jurisdiction.state_rate) : (salesTax ? 0.06 : null),
    county_surtax_rate: jurisdiction?.county_surtax_rate != null ? Number(jurisdiction.county_surtax_rate) : null,
    surtax_cap_amount: jurisdiction?.surtax_cap_amount != null ? Number(jurisdiction.surtax_cap_amount) : null,
    state_tax: salesTax?.state_tax ?? 0,
    county_tax: salesTax?.county_tax ?? 0,
    total_tax: tax,
    taxable_basis: salesTax?.taxable_basis ?? subtotal,
    tax_lines: salesTax?.tax_lines ?? [],
    manual_override_applied: salesTax?.manual_override_applied ?? false,
    freight_untaxed: shipping > 0 ? shipping : undefined,
    tax_failed: salesTax == null,
    tax_failure_reason: salesTax == null ? (taxFailureReason ?? "tax_resolution_failed") : null,
  };

  const { data: inserted, error: insertError } = await admin
    .from("customer_invoices")
    .insert({
      workspace_id: workspaceId,
      portal_customer_id: portalCustomerId,
      crm_company_id: crmCompanyId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: due.toISOString().slice(0, 10),
      description: `Parts order ${order.receipt_number ?? String(orderId).slice(0, 8)}`,
      amount,
      tax,
      total,
      amount_paid: amountPaid,
      status: invoiceStatus,
      parts_order_id: orderId,
      invoice_type: "parts",
      invoice_source_code: "PARTS",
      branch_id: branch?.slug ?? null,
      ship_to_address_id: shipTo?.id ?? null,
      tax_breakdown: taxBreakdown,
      tax_code_1: (jurisdiction?.state_code as string | null) ?? null,
      tax_code_2: (jurisdiction?.county_name as string | null) ?? null,
      dr15_county_name: shipToCounty,
      payment_method: paid ? ((order.tender_type as string | null) ?? "cash") : null,
      payment_reference: (order.payment_reference as string | null) ?? null,
      paid_at: invoiceStatus === "paid" ? ((order.payment_received_at as string | null) ?? new Date().toISOString()) : null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new Error(`invoice insert failed: ${insertError?.message ?? "no row returned"}`);
  }
  const invoiceId = inserted.id as string;

  const genericLines = lineAmounts.map((line, index) => ({
    workspace_id: workspaceId,
    invoice_id: invoiceId,
    line_number: index + 1,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    finance_department: "parts",
    finance_segment: "customer",
    finance_category: "part",
    finance_classification_source: "parts_order_line",
    finance_classified_at: new Date().toISOString(),
  }));
  if (shipping > 0) {
    genericLines.push({
      workspace_id: workspaceId,
      invoice_id: invoiceId,
      line_number: genericLines.length + 1,
      description: "Freight",
      quantity: 1,
      unit_price: shipping,
      finance_department: "parts",
      finance_segment: "customer",
      finance_category: "freight",
      finance_classification_source: "parts_order_shipping",
      finance_classified_at: new Date().toISOString(),
    });
  }
  const { error: genericLinesError } = await admin
    .from("customer_invoice_line_items")
    .insert(genericLines);
  if (genericLinesError) {
    warnings.push(`line_items_insert_failed: ${genericLinesError.message}`);
  }

  const { error: partsLinesError } = await admin
    .from("parts_invoice_lines")
    .insert(lineAmounts.map((line, index) => ({
      workspace_id: workspaceId,
      customer_invoice_id: invoiceId,
      sort_order: index + 1,
      part_catalog_id: line.catalogItemId,
      part_number: line.partNumber,
      description: line.partDescription,
      qty_ordered: Math.max(0, Math.round(line.quantity)),
      qty_issued: Math.max(0, Math.round(line.quantity)),
      qty_shipped: Math.max(0, Math.round(line.quantity)),
      qty_invoiced: Math.max(0, Math.round(line.quantity)),
      unit_price_cents: toCents(line.unitPrice),
      discount_pct: line.discountPct,
      tax_applies: true,
      extended_price_cents: toCents(line.lineTotal),
      finance_department: "parts",
      finance_segment: "customer",
      finance_category: "part",
      finance_classification_source: "parts_order_line",
    })));
  if (partsLinesError) {
    warnings.push(`parts_invoice_lines_insert_failed: ${partsLinesError.message}`);
    await enqueueException(admin, {
      source: "parts_billing_failed",
      title: `Parts invoice ${invoiceNumber} posted without parts_invoice_lines detail`,
      severity: "error",
      detail: partsLinesError.message,
      payload: { invoice_id: invoiceId, parts_order_id: orderId },
      entityTable: "customer_invoices",
      entityId: invoiceId,
    });
  }

  if (salesTax == null || (stateCode?.toUpperCase() === "FL" && !shipToCounty)) {
    await enqueueException(admin, {
      source: "tax_failed",
      title: salesTax == null
        ? `Parts invoice ${invoiceNumber} posted without tax`
        : `Parts invoice ${invoiceNumber} taxed state-only (no ship-to county)`,
      severity: "warn",
      detail: salesTax == null
        ? (taxFailureReason ?? "tax computation failed")
        : "No ship-to county on file for the customer; FL county surtax was not applied.",
      payload: { invoice_id: invoiceId, parts_order_id: orderId, state_code: stateCode, ship_to_county: shipToCounty },
      entityTable: "customer_invoices",
      entityId: invoiceId,
    });
    if (salesTax != null) warnings.push("state_only_tax_no_county");
  }

  const { error: orderPatchError } = await admin
    .from("parts_orders")
    .update({ tax, total })
    .eq("id", orderId);
  if (orderPatchError) {
    warnings.push(`order_totals_update_failed: ${orderPatchError.message}`);
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
      .update({ quickbooks_gl_status: "queued", quickbooks_gl_last_error: null })
      .eq("id", invoiceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`gl_enqueue_failed: ${message}`);
    await enqueueException(admin, {
      source: "parts_billing_failed",
      title: `GL enqueue failed for parts invoice ${invoiceNumber}`,
      severity: "warn",
      detail: message,
      payload: { invoice_id: invoiceId, parts_order_id: orderId },
      entityTable: "customer_invoices",
      entityId: invoiceId,
    });
  }

  try {
    await publishFlowEvent(admin, {
      workspaceId,
      eventType: "parts_order.invoiced",
      sourceModule: "parts-order-manager",
      sourceRecordId: orderId,
      companyId: crmCompanyId ?? undefined,
      payload: {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        total,
        tax,
        amount_paid: amountPaid,
        invoice_type: "parts",
        parts_order_id: orderId,
      },
      idempotencyKey: `parts_order.invoiced:${orderId}`,
    });
  } catch (err) {
    warnings.push(`flow_event_failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    status: "created",
    invoiceId,
    invoiceNumber,
    total,
    tax,
    amountPaid,
    taxCounty: shipToCounty,
    warnings,
  };
}
