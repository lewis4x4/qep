/**
 * equipment-invoice-core.ts — PURE planner for equipment-sale invoices
 * (Stream M / M1.1, blueprint §2).
 *
 * Mirrors the rental-billing-core pattern: all money math lives here as the
 * single canon, unit-tested under bun; the edge function
 * (_shared/equipment-invoice.ts) is a thin I/O wrapper around it.
 *
 * Invoice shape contract (customer_invoices):
 *   amount = quote subtotal − trade value + FET   (equals Σ line items)
 *   tax    = sales tax (state + county surtax) computed at posting time
 *   total  = amount + tax                          (balance_due is generated)
 *   amount_paid = verified/received deposits applied at generation, capped
 *
 * Zero-blocking: a null salesTax input means tax resolution failed upstream —
 * the plan still posts (tax 0 or state-only handled by caller) and carries
 * tax_failed in the persisted breakdown so the exception path stays loud.
 */

export interface EquipmentQuotePackageSnapshot {
  id: string;
  subtotal: number | string | null;
  equipment_total: number | string | null;
  attachment_total: number | string | null;
  trade_allowance: number | string | null;
  trade_credit: number | string | null;
  tax_profile: string | null;
  fet_total: number | string | null;
  fet_rate: number | string | null;
  fet_taxable_amount: number | string | null;
  fet_exemption_certificate_id: string | null;
  equipment: unknown;
}

export interface DepositSnapshot {
  id: string;
  status: string;
  required_amount: number | string | null;
}

export interface SalesTaxSnapshot {
  total_tax: number;
  state_tax: number;
  county_tax: number;
  taxable_basis: number;
  tax_lines: unknown[];
  manual_override_applied: boolean;
}

export interface TaxJurisdictionSnapshot {
  id?: string | null;
  state_code?: string | null;
  county_name?: string | null;
  state_rate?: number | string | null;
  county_surtax_rate?: number | string | null;
  surtax_cap_amount?: number | string | null;
}

export interface EquipmentInvoicePlanInput {
  quotePackage: EquipmentQuotePackageSnapshot;
  deposits: DepositSnapshot[];
  salesTax: SalesTaxSnapshot | null;
  taxFailureReason?: string | null;
  jurisdiction?: TaxJurisdictionSnapshot | null;
  invoiceDate: string; // yyyy-mm-dd
  netDays?: number;
}

export interface EquipmentInvoiceLine {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface EquipmentInvoicePlan {
  amount: number;
  tax: number;
  total: number;
  amountPaid: number;
  status: "pending" | "partial" | "paid";
  dueDate: string;
  lines: EquipmentInvoiceLine[];
  appliedDepositIds: string[];
  tradeValue: number;
  fetAmount: number;
  fetLiabilityStatus: "not_applicable" | "estimated" | "exempt";
  taxFailed: boolean;
  taxBreakdown: Record<string, unknown>;
  taxCode1: string | null;
  taxCode2: string | null;
}

const DEPOSIT_APPLICABLE_STATUSES = new Set(["verified", "received"]);

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type EquipmentJsonEntry = Record<string, unknown>;

function entryDescription(entry: EquipmentJsonEntry, index: number): string {
  const parts = [entry.year, entry.make, entry.model]
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter((part) => part.length > 0);
  if (parts.length > 0) return parts.join(" ");
  const fallback = [entry.description, entry.name, entry.title]
    .map((part) => (part == null ? "" : String(part).trim()))
    .find((part) => part.length > 0);
  return fallback ?? `Equipment line ${index + 1}`;
}

function entryPrice(entry: EquipmentJsonEntry): number {
  return num(entry.price ?? entry.unit_price ?? entry.list_price ?? entry.quoted_list_price);
}

/**
 * Parse the quote_packages.equipment jsonb array into billable line inputs.
 * Exported so the caller can feed the same per-item amounts to the FL
 * per-item surtax cap in computeQuoteTax.
 */
export function equipmentEntriesFromQuote(
  equipment: unknown,
): Array<{ description: string; quantity: number; unitPrice: number }> {
  if (!Array.isArray(equipment)) return [];
  return equipment
    .filter((entry): entry is EquipmentJsonEntry => entry != null && typeof entry === "object")
    .map((entry, index) => ({
      description: entryDescription(entry, index),
      quantity: Math.max(1, Math.trunc(num(entry.quantity ?? 1)) || 1),
      unitPrice: round2(entryPrice(entry)),
    }));
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number(part));
  const utc = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function planEquipmentInvoice(input: EquipmentInvoicePlanInput): EquipmentInvoicePlan {
  const qp = input.quotePackage;

  const entries = equipmentEntriesFromQuote(qp.equipment);
  const entriesSum = round2(entries.reduce((sum, entry) => sum + entry.quantity * entry.unitPrice, 0));

  let subtotal = round2(num(qp.subtotal));
  if (subtotal === 0) subtotal = round2(num(qp.equipment_total) + num(qp.attachment_total));
  if (subtotal === 0) subtotal = entriesSum;

  const tradeAllowance = round2(num(qp.trade_allowance));
  const tradeValue = tradeAllowance > 0 ? tradeAllowance : round2(num(qp.trade_credit));

  const fetAmount = round2(num(qp.fet_total));
  const fetLiabilityStatus: EquipmentInvoicePlan["fetLiabilityStatus"] = fetAmount > 0
    ? "estimated"
    : qp.fet_exemption_certificate_id
    ? "exempt"
    : "not_applicable";

  const lines: EquipmentInvoiceLine[] = entries.map((entry) => ({
    description: entry.description,
    quantity: entry.quantity,
    unit_price: entry.unitPrice,
  }));
  if (lines.length === 0) {
    lines.push({ description: "Equipment sale", quantity: 1, unit_price: subtotal });
  } else {
    const adjustment = round2(subtotal - entriesSum);
    if (Math.abs(adjustment) >= 0.01) {
      lines.push({ description: "Attachments, fees & adjustments", quantity: 1, unit_price: adjustment });
    }
  }
  if (tradeValue > 0) {
    lines.push({ description: "Trade-in allowance", quantity: 1, unit_price: round2(-tradeValue) });
  }
  if (fetAmount > 0) {
    lines.push({ description: "Federal excise tax", quantity: 1, unit_price: fetAmount });
  }

  const taxFailed = input.salesTax == null;
  const tax = input.salesTax ? round2(input.salesTax.total_tax) : 0;
  const amount = round2(subtotal - tradeValue + fetAmount);
  const total = round2(amount + tax);

  const appliedDeposits = input.deposits.filter((deposit) =>
    DEPOSIT_APPLICABLE_STATUSES.has(deposit.status)
  );
  const depositSum = round2(
    appliedDeposits.reduce((sum, deposit) => sum + num(deposit.required_amount), 0),
  );
  const amountPaid = round2(Math.min(Math.max(depositSum, 0), Math.max(total, 0)));

  const status: EquipmentInvoicePlan["status"] = total > 0 && amountPaid >= total
    ? "paid"
    : amountPaid > 0
    ? "partial"
    : "pending";

  const jurisdiction = input.jurisdiction ?? null;
  const taxBreakdown: Record<string, unknown> = {
    source_label: "equipment-invoice",
    tax_profile: qp.tax_profile ?? "standard",
    county_name: jurisdiction?.county_name ?? null,
    state_rate: jurisdiction?.state_rate != null ? num(jurisdiction.state_rate) : (input.salesTax ? 0.06 : null),
    county_surtax_rate: jurisdiction?.county_surtax_rate != null ? num(jurisdiction.county_surtax_rate) : null,
    surtax_cap_amount: jurisdiction?.surtax_cap_amount != null ? num(jurisdiction.surtax_cap_amount) : null,
    state_tax: input.salesTax?.state_tax ?? 0,
    county_tax: input.salesTax?.county_tax ?? 0,
    total_tax: tax,
    taxable_basis: input.salesTax?.taxable_basis ?? round2(subtotal - tradeValue),
    tax_lines: input.salesTax?.tax_lines ?? [],
    manual_override_applied: input.salesTax?.manual_override_applied ?? false,
    tax_failed: taxFailed,
    tax_failure_reason: taxFailed ? (input.taxFailureReason ?? "tax_resolution_failed") : null,
  };

  return {
    amount,
    tax,
    total,
    amountPaid,
    status,
    dueDate: addDays(input.invoiceDate, input.netDays ?? 30),
    lines,
    appliedDepositIds: appliedDeposits.map((deposit) => deposit.id),
    tradeValue,
    fetAmount,
    fetLiabilityStatus,
    taxFailed,
    taxBreakdown,
    taxCode1: jurisdiction?.state_code ?? null,
    taxCode2: jurisdiction?.county_name ?? null,
  };
}
