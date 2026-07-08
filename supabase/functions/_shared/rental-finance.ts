/**
 * rental-finance.ts — shared financial plumbing for the rental stream
 * (Stream M / M4.1, blueprint §2 §4 §5 §9).
 *
 * Used by rental-billing-runner (nightly AR mirror + tax + numbering) and
 * rental-ops (deposit/extension invoices, rate-floor gate). Same canon as the
 * equipment/parts writers: next_invoice_number for branch-prefixed numbers,
 * qep_resolve_fl_tax_jurisdiction + tax-calculator math for county tax,
 * quickbooks_gl_sync_jobs enqueue, zero-blocking degrades.
 */

import { computeQuoteTax } from "../tax-calculator/tax-logic.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type NumberingBranch = {
  id: string;
  slug: string | null;
  legacy_code: string | null;
  state_province: string | null;
};

export async function resolveNumberingBranch(
  admin: AdminClient,
  workspaceId: string,
  branchId: string | null | undefined,
): Promise<NumberingBranch | null> {
  if (branchId) {
    const { data: branchRow } = await admin
      .from("branches")
      .select("id, slug, legacy_code, state_province")
      .eq("id", branchId)
      .maybeSingle();
    if (branchRow) return branchRow as NumberingBranch;
  }
  const { data: fallbackBranch } = await admin
    .from("branches")
    .select("id, slug, legacy_code, state_province")
    .eq("workspace_id", workspaceId)
    .not("legacy_code", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (fallbackBranch as NumberingBranch | null) ?? null;
}

export async function mintRentalInvoiceNumber(
  admin: AdminClient,
  workspaceId: string,
  branch: NumberingBranch | null,
): Promise<string> {
  const { data: number, error } = await admin.rpc("next_invoice_number", {
    p_workspace_id: workspaceId,
    p_branch_legacy_code: branch?.legacy_code ?? "00",
    p_invoice_type: "rental",
  });
  if (error || typeof number !== "string") {
    throw new Error(`rental invoice numbering failed: ${error?.message ?? "no number returned"}`);
  }
  return number;
}

export type RentalTaxContractSnapshot = {
  tax_sourcing_method?: string | null;
  ship_to_address_id?: string | null;
  qrm_company_id?: string | null;
  portal_customer_id?: string | null;
};

export type RentalTaxResult = {
  taxCents: number;
  jurisdictionId: string | null;
  county: string | null;
  breakdown: Record<string, unknown>;
  taxCode1: string | null;
  taxCode2: string | null;
  shipToAddressId: string | null;
  warning: string | null;
};

export async function resolveRentalTax(
  admin: AdminClient,
  workspaceId: string,
  contract: RentalTaxContractSnapshot,
  subtotalCents: number,
  branch: NumberingBranch | null,
  periodLabel: string,
): Promise<RentalTaxResult> {
  const sourcing = contract.tax_sourcing_method ?? "destination_ship_to";
  const subtotal = Math.round(subtotalCents) / 100;

  const base: RentalTaxResult = {
    taxCents: 0,
    jurisdictionId: null,
    county: null,
    breakdown: {
      source_label: "rental-billing",
      tax_sourcing_method: sourcing,
      taxable_basis: subtotal,
      total_tax: 0,
      state_tax: 0,
      county_tax: 0,
      tax_lines: [],
    },
    taxCode1: null,
    taxCode2: null,
    shipToAddressId: contract.ship_to_address_id ?? null,
    warning: null,
  };

  if (sourcing === "manual_override") {
    base.breakdown.manual_override = true;
    return base;
  }
  if (subtotalCents <= 0) return base;

  let shipTo: { id: string; county_name: string | null; state: string | null } | null = null;
  if (sourcing === "destination_ship_to") {
    if (contract.ship_to_address_id) {
      const { data: shipToRow } = await admin
        .from("qrm_company_ship_to_addresses")
        .select("id, county_name, state")
        .eq("id", contract.ship_to_address_id)
        .maybeSingle();
      shipTo = shipToRow ?? null;
    }
    if (!shipTo) {
      let companyId = contract.qrm_company_id ?? null;
      if (!companyId && contract.portal_customer_id) {
        const { data: portal } = await admin
          .from("portal_customers")
          .select("crm_company_id")
          .eq("id", contract.portal_customer_id)
          .maybeSingle();
        companyId = (portal?.crm_company_id as string | null) ?? null;
      }
      if (companyId) {
        const { data: defaultShipTo } = await admin
          .from("qrm_company_ship_to_addresses")
          .select("id, county_name, state")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle();
        shipTo = defaultShipTo ?? null;
      }
    }
  }

  const county = shipTo?.county_name ?? null;
  const stateCode = shipTo?.state ?? branch?.state_province ?? "FL";
  base.shipToAddressId = shipTo?.id ?? base.shipToAddressId;

  let jurisdiction: Record<string, unknown> | null = null;
  if (shipTo || county) {
    const { data: jurisdictionRow, error: jurisdictionError } = await admin.rpc(
      "qep_resolve_fl_tax_jurisdiction",
      {
        p_workspace_id: workspaceId,
        p_ship_to_address_id: shipTo?.id ?? null,
        p_county_name: county,
        p_effective_date: new Date().toISOString().slice(0, 10),
      },
    );
    if (jurisdictionError) {
      base.warning = `jurisdiction_lookup_failed: ${jurisdictionError.message}`;
    } else {
      const row = Array.isArray(jurisdictionRow) ? jurisdictionRow[0] : jurisdictionRow;
      if (row && (row as { id?: string }).id) jurisdiction = row as Record<string, unknown>;
    }
  }

  try {
    const salesTax = computeQuoteTax({
      subtotal,
      discountTotal: 0,
      tradeAllowance: 0,
      taxProfile: "standard",
      stateCode,
      shipToCounty: county,
      jurisdiction: jurisdiction as never,
      lineItems: [{ description: `Rental charges ${periodLabel}`, taxable_amount: subtotal, taxable: true }],
    });
    base.taxCents = Math.round(salesTax.total_tax * 100);
    base.jurisdictionId = (jurisdiction?.id as string | null) ?? null;
    base.county = county;
    base.taxCode1 = (jurisdiction?.state_code as string | null) ?? (stateCode?.toUpperCase() === "FL" ? "FL" : null);
    base.taxCode2 = county;
    base.breakdown = {
      source_label: "rental-billing",
      tax_sourcing_method: sourcing,
      county_name: county,
      state_rate: jurisdiction?.state_rate != null ? Number(jurisdiction.state_rate) : 0.06,
      county_surtax_rate: jurisdiction?.county_surtax_rate != null ? Number(jurisdiction.county_surtax_rate) : null,
      surtax_cap_amount: jurisdiction?.surtax_cap_amount != null ? Number(jurisdiction.surtax_cap_amount) : null,
      state_tax: salesTax.state_tax,
      county_tax: salesTax.county_tax,
      total_tax: salesTax.total_tax,
      taxable_basis: salesTax.taxable_basis,
      tax_lines: salesTax.tax_lines,
      manual_override_applied: salesTax.manual_override_applied,
    };
    if (stateCode?.toUpperCase() === "FL" && !county) {
      base.warning = base.warning ?? "state_only_tax_no_county";
    }
  } catch (err) {
    base.warning = `tax_computation_failed: ${err instanceof Error ? err.message : String(err)}`;
    base.breakdown.tax_failed = true;
    base.breakdown.tax_failure_reason = base.warning;
  }

  return base;
}

export type RentalMirrorInput = {
  workspaceId: string;
  rentalInvoiceId: string | null;
  invoiceNumber: string;
  description: string;
  portalCustomerId: string | null;
  crmCompanyId: string | null;
  amountDollars: number;
  taxDollars: number;
  amountPaidDollars: number;
  dueDate: string;
  branchSlug: string | null;
  tax: RentalTaxResult | null;
  enqueueGl: boolean;
};

export type RentalMirrorResult = {
  invoiceId: string;
  warnings: string[];
};

export async function mirrorRentalInvoiceToAR(
  admin: AdminClient,
  input: RentalMirrorInput,
): Promise<RentalMirrorResult> {
  const warnings: string[] = [];
  const total = Math.round((input.amountDollars + input.taxDollars) * 100) / 100;
  const amountPaid = Math.min(Math.max(input.amountPaidDollars, 0), Math.max(total, 0));
  const status = total > 0 && amountPaid >= total ? "paid" : amountPaid > 0 ? "partial" : "pending";

  const { data: inserted, error: insertError } = await admin
    .from("customer_invoices")
    .insert({
      workspace_id: input.workspaceId,
      portal_customer_id: input.portalCustomerId,
      crm_company_id: input.crmCompanyId,
      invoice_number: input.invoiceNumber,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: input.dueDate,
      description: input.description,
      amount: input.amountDollars,
      tax: input.taxDollars,
      total,
      amount_paid: amountPaid,
      status,
      invoice_type: "rental",
      invoice_source_code: "RENTAL",
      branch_id: input.branchSlug,
      ship_to_address_id: input.tax?.shipToAddressId ?? null,
      tax_breakdown: input.tax?.breakdown ?? null,
      tax_code_1: input.tax?.taxCode1 ?? null,
      tax_code_2: input.tax?.taxCode2 ?? null,
      dr15_county_name: input.tax?.county ?? null,
      tax_jurisdiction_id: input.tax?.jurisdictionId ?? null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new Error(`rental AR mirror insert failed: ${insertError?.message ?? "no row returned"}`);
  }
  const invoiceId = inserted.id as string;

  const { error: lineError } = await admin
    .from("customer_invoice_line_items")
    .insert({
      workspace_id: input.workspaceId,
      invoice_id: invoiceId,
      line_number: 1,
      description: input.description,
      quantity: 1,
      unit_price: input.amountDollars,
    });
  if (lineError) warnings.push(`line_items_insert_failed: ${lineError.message}`);

  if (input.rentalInvoiceId) {
    const { error: backlinkError } = await admin
      .from("rental_invoices")
      .update({ customer_invoice_id: invoiceId })
      .eq("id", input.rentalInvoiceId);
    if (backlinkError) warnings.push(`backlink_update_failed: ${backlinkError.message}`);
  }

  if (input.enqueueGl) {
    const { error: glError } = await admin
      .from("quickbooks_gl_sync_jobs")
      .upsert({
        workspace_id: input.workspaceId,
        invoice_id: invoiceId,
        source_type: "customer_invoice",
        posting_mode: "journal_entry",
        status: "queued",
      }, { onConflict: "invoice_id" });
    if (glError) {
      warnings.push(`gl_enqueue_failed: ${glError.message}`);
    } else {
      await admin
        .from("customer_invoices")
        .update({ quickbooks_gl_status: "queued", quickbooks_gl_last_error: null })
        .eq("id", invoiceId);
    }
  }

  return { invoiceId, warnings };
}

export type RateFloorEvaluation = {
  belowFloor: boolean;
  discountPct: number | null;
  thresholdPct: number;
  bookSource: string | null;
  comparison: Array<{ cadence: string; agreed_cents: number; book_cents: number; discount_pct: number }>;
};

/**
 * Compares agreed contract rates (dollars) to the rental_resolve_rates book
 * (cents). Enforcement is skipped when the book is unresolved — there is no
 * floor truth to hold the rate against (RF-010 closes only where a book
 * exists).
 */
export async function evaluateRentalRateFloor(
  admin: AdminClient,
  input: {
    workspaceId: string;
    agreedDaily: number | null;
    agreedWeekly: number | null;
    agreedMonthly: number | null;
    equipmentId: string | null;
    companyId: string | null;
    branchId: string | null;
  },
): Promise<RateFloorEvaluation> {
  let thresholdPct = 10;
  const { data: settings } = await admin
    .from("workspace_settings")
    .select("rental_discount_approval_threshold_pct")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (settings?.rental_discount_approval_threshold_pct != null) {
    const parsed = Number(settings.rental_discount_approval_threshold_pct);
    if (Number.isFinite(parsed) && parsed >= 0) thresholdPct = parsed;
  }

  const { data: bookData, error: bookError } = await admin.rpc("rental_resolve_rates", {
    p_workspace_id: input.workspaceId,
    p_equipment_id: input.equipmentId,
    p_company_id: input.companyId,
    p_branch_id: input.branchId,
  });
  if (bookError || !bookData) {
    return { belowFloor: false, discountPct: null, thresholdPct, bookSource: null, comparison: [] };
  }
  const book = bookData as Record<string, unknown>;
  const bookSource = (book.source as string | null) ?? null;
  if (!bookSource || bookSource === "unresolved") {
    return { belowFloor: false, discountPct: null, thresholdPct, bookSource, comparison: [] };
  }

  const comparison: RateFloorEvaluation["comparison"] = [];
  const pairs: Array<[string, number | null, unknown]> = [
    ["daily", input.agreedDaily, book.day],
    ["weekly", input.agreedWeekly, book.week],
    ["monthly", input.agreedMonthly, book.month],
  ];
  for (const [cadence, agreedDollars, bookCentsRaw] of pairs) {
    const bookCents = Number(bookCentsRaw ?? 0);
    if (agreedDollars == null || !Number.isFinite(bookCents) || bookCents <= 0) continue;
    const agreedCents = Math.round(Number(agreedDollars) * 100);
    const discountPct = ((bookCents - agreedCents) / bookCents) * 100;
    comparison.push({
      cadence,
      agreed_cents: agreedCents,
      book_cents: bookCents,
      discount_pct: Math.round(discountPct * 100) / 100,
    });
  }

  const worst = comparison.reduce<number | null>(
    (max, entry) => (max == null || entry.discount_pct > max ? entry.discount_pct : max),
    null,
  );
  return {
    belowFloor: worst != null && worst > thresholdPct,
    discountPct: worst,
    thresholdPct,
    bookSource,
    comparison,
  };
}
