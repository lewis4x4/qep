/**
 * Feature-local API adapter for the QEP finance-enforcement surfaces.
 *
 * Wraps the role-gated Postgres RPCs and the tax-calculator edge function
 * shipped in migrations 655-661 (branch-prefixed invoice numbering, county
 * tax + Ship-To sourcing, Net 30 / 60-day credit holds, margin matrix,
 * equipment-sale reversal approver, Form 8300 + FET, AP 3-way match /
 * approval routing / double-pay guard).
 *
 * The shared supabase client is intentionally broad (SupabaseClient, not
 * SupabaseClient<Database>) so RPC names are not checked against the generated
 * schema. Every surface therefore carries its own explicit Arg/Return types
 * here — this file is the typed contract for the web slice until the generated
 * database.types.ts is regenerated (blocked locally by the pg_cron/pg_net
 * migration 212; runs in CI/prod).
 */
import { supabase } from "@/lib/supabase";

/** Narrow a PostgrestError-shaped value to a message. */
function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Branch-prefixed invoice numbering (mig 655)
// ─────────────────────────────────────────────────────────────────────────────
export type InvoiceDeptType = "equipment" | "parts" | "service" | "rental" | "general";

export interface InvoiceSequenceRow {
  id: string;
  workspace_id: string;
  branch_legacy_code: string;
  dept_prefix: string;
  next_value: number;
}

/** Read the per-(branch, dept) invoice-number counters for the workspace. */
export async function listInvoiceSequences(workspaceId: string): Promise<InvoiceSequenceRow[]> {
  const { data, error } = await supabase
    .from("invoice_number_sequences")
    .select("id, workspace_id, branch_legacy_code, dept_prefix, next_value")
    .eq("workspace_id", workspaceId)
    .order("branch_legacy_code", { ascending: true });
  if (error) fail("listInvoiceSequences", error);
  return (data ?? []) as InvoiceSequenceRow[];
}

/**
 * Generate (and consume) the next company-wide-unique invoice number in the
 * locked `01-E1000` format. This mutates the sequence — call it only when an
 * invoice is actually being created, not for idle preview.
 */
export async function generateInvoiceNumber(params: {
  workspaceId: string;
  branchLegacyCode: string;
  invoiceType: InvoiceDeptType;
}): Promise<string> {
  const { data, error } = await supabase.rpc("next_invoice_number", {
    p_workspace_id: params.workspaceId,
    p_branch_legacy_code: params.branchLegacyCode,
    p_invoice_type: params.invoiceType,
  });
  if (error) fail("next_invoice_number", error);
  return data as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. County sales tax + Ship-To sourcing + per-item surtax cap (mig 656, edge fn)
// ─────────────────────────────────────────────────────────────────────────────
export interface TaxLineItemInput {
  description?: string | null;
  taxable_amount: number;
  taxable?: boolean;
}

export interface TaxPreviewRequest {
  subtotal: number;
  discountTotal?: number;
  tradeAllowance?: number;
  taxProfile?: string;
  branchSlug?: string | null;
  companyId?: string | null;
  deliveryState?: string | null;
  /** Ship-To sourced county — preferred over bill-to. */
  shipToCounty?: string | null;
  deliveryCounty?: string | null;
  /** Per-item taxable amounts so the FL $5k discretionary surtax cap is applied per item. */
  lineItems?: TaxLineItemInput[];
}

export interface TaxLine {
  label: string;
  rate: number;
  amount: number;
  applies_to?: string;
  cap_applied?: number | null;
}

export interface TaxPreviewResult {
  tax_lines: TaxLine[];
  total_tax: number;
  state_tax: number;
  county_tax: number;
  taxable_basis: number;
  exemptions_applied: string[];
  manual_override_applied: boolean;
}

/** Invoke the tax-calculator edge function with Ship-To county + per-item lines. */
export async function previewTax(req: TaxPreviewRequest): Promise<TaxPreviewResult> {
  const { data, error } = await supabase.functions.invoke<TaxPreviewResult>("tax-calculator", {
    body: {
      subtotal: req.subtotal,
      discount_total: req.discountTotal ?? 0,
      trade_allowance: req.tradeAllowance ?? 0,
      tax_profile: req.taxProfile ?? "standard",
      branch_slug: req.branchSlug ?? null,
      company_id: req.companyId ?? null,
      delivery_state: req.deliveryState ?? "FL",
      ship_to_county: req.shipToCounty ?? null,
      delivery_county: req.deliveryCounty ?? req.shipToCounty ?? null,
      line_items: req.lineItems ?? null,
    },
  });
  if (error) fail("tax-calculator", error);
  if (!data) fail("tax-calculator", { message: "empty response" });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Net 30 terms + 60-day auto-hold (mig 657)
// ─────────────────────────────────────────────────────────────────────────────
/** Run the workspace credit-hold sweep; returns the count of newly-held accounts. */
export async function runCreditHoldSweep(workspaceId?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc("evaluate_credit_holds", {
    p_workspace_id: workspaceId ?? null,
  });
  if (error) fail("evaluate_credit_holds", error);
  return Number(data ?? 0);
}

/** Non-throwing check of a single customer's credit-hold state. */
export async function isCustomerOnCreditHold(companyId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_customer_on_credit_hold", {
    p_company_id: companyId,
  });
  if (error) fail("is_customer_on_credit_hold", error);
  return Boolean(data);
}

export interface CreditHoldRow {
  id: string;
  name: string | null;
  credit_hold: boolean;
  credit_hold_reason: string | null;
  credit_hold_set_at: string | null;
}

/** List accounts currently on credit hold in the workspace. */
export async function listHeldAccounts(workspaceId: string): Promise<CreditHoldRow[]> {
  const { data, error } = await supabase
    .from("qrm_companies")
    .select("id, name, credit_hold, credit_hold_reason, credit_hold_set_at")
    .eq("workspace_id", workspaceId)
    .eq("credit_hold", true)
    .order("credit_hold_set_at", { ascending: false })
    .limit(100);
  if (error) fail("listHeldAccounts", error);
  return (data ?? []) as CreditHoldRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Margin matrix + segment tags (mig 658)
// ─────────────────────────────────────────────────────────────────────────────
export type MarginLineClass = "parts" | "service" | "equipment";
export type MarginSegment = "customer" | "warranty" | "internal" | "sublet";

export interface MarginMatrixSummaryRow {
  line_class: MarginLineClass;
  segment: MarginSegment;
  gross_margin_cents: number;
  net_margin_cents: number;
  entry_count?: number;
}

/** Read the [Parts|Service|Equipment] x [Customer|Warranty|Internal|Sublet] rollup. */
export async function getMarginMatrix(workspaceId: string): Promise<MarginMatrixSummaryRow[]> {
  const { data, error } = await supabase
    .from("v_margin_matrix_summary")
    .select("line_class, segment, gross_margin_cents, net_margin_cents, entry_count")
    .eq("workspace_id", workspaceId);
  if (error) fail("getMarginMatrix", error);
  return (data ?? []) as MarginMatrixSummaryRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Equipment-sale reversal approver + audit (mig 659)
// ─────────────────────────────────────────────────────────────────────────────
export interface ReversalResult {
  approved: boolean;
  outcome: string;
  reason?: string;
  reversal_id?: string;
  credit_memo_id?: string;
  approver_role?: string;
}

/** Gate an equipment-sale reversal to a Sales Manager / Iron Manager, with audit. */
export async function reverseEquipmentSaleWithApproval(params: {
  stockNumber: string;
  reversalId: string;
  reason: string;
  approverId: string;
}): Promise<ReversalResult> {
  const { data, error } = await supabase.rpc("reverse_equipment_sale_with_approval", {
    p_stock_number: params.stockNumber,
    p_reversal_id: params.reversalId,
    p_reason: params.reason,
    p_approver_id: params.approverId,
  });
  if (error) fail("reverse_equipment_sale_with_approval", error);
  return (data ?? { approved: false, outcome: "unknown" }) as ReversalResult;
}

export interface ReversalAuditRow {
  id: string;
  reversal_id: string | null;
  stock_number: string | null;
  action: "approved" | "rejected" | "executed";
  approver_role: string | null;
  reason: string | null;
  outcome: string | null;
  created_at: string;
}

/** Recent equipment-reversal audit entries (approved / rejected / executed). */
export async function listReversalAudit(workspaceId: string): Promise<ReversalAuditRow[]> {
  const { data, error } = await supabase
    .from("equipment_reversal_audit")
    .select("id, reversal_id, stock_number, action, approver_role, reason, outcome, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) fail("listReversalAudit", error);
  return (data ?? []) as ReversalAuditRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Form 8300 (cash > $10k) + FET 12% scaffold (mig 660)
// ─────────────────────────────────────────────────────────────────────────────
export interface Form8300Row {
  id: string;
  invoice_id: string | null;
  cash_amount: number;
  status: "flagged" | "filed" | "void" | "exempt";
  flagged_at: string;
}

/** List Form 8300 cash-transaction reports for the workspace. */
export async function listForm8300Reports(workspaceId: string): Promise<Form8300Row[]> {
  const { data, error } = await supabase
    .from("form_8300_reports")
    .select("id, invoice_id, cash_amount, status, flagged_at")
    .eq("workspace_id", workspaceId)
    .order("flagged_at", { ascending: false })
    .limit(100);
  if (error) fail("listForm8300Reports", error);
  return (data ?? []) as Form8300Row[];
}

/** Re-evaluate Form 8300 flagging for a specific invoice; returns the report id or null. */
export async function evaluateForm8300(invoiceId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("evaluate_form_8300", { p_invoice_id: invoiceId });
  if (error) fail("evaluate_form_8300", error);
  return (data as string | null) ?? null;
}

export interface FetCategoryRow {
  id: string;
  category_code: string;
  description: string | null;
  fet_rate: number;
  is_active: boolean;
}

/** List the FET-taxable unit categories (grapple trucks / bodies / chassis @ 12%). */
export async function listFetCategories(workspaceId: string): Promise<FetCategoryRow[]> {
  const { data, error } = await supabase
    .from("fet_taxable_categories")
    .select("id, category_code, description, fet_rate, is_active")
    .eq("workspace_id", workspaceId)
    .order("category_code", { ascending: true });
  if (error) fail("listFetCategories", error);
  return (data ?? []) as FetCategoryRow[];
}

/** Compute the 12% Federal Excise Tax (Form 720), returning 0 when exempt. */
export async function computeFet(params: {
  taxableAmount: number;
  rate?: number;
  isExempt?: boolean;
}): Promise<number> {
  const { data, error } = await supabase.rpc("compute_fet", {
    p_taxable_amount: params.taxableAmount,
    p_rate: params.rate ?? 0.12,
    p_is_exempt: params.isExempt ?? false,
  });
  if (error) fail("compute_fet", error);
  return Number(data ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. AP 3-way match + approval routing + double-pay guard (mig 661)
// ─────────────────────────────────────────────────────────────────────────────
export type ApMatchStatus =
  | "unmatched"
  | "matched"
  | "price_mismatch"
  | "quantity_mismatch"
  | "partial";

export interface VendorInvoiceRow {
  id: string;
  vendor_invoice_number: string;
  amount: number;
  amount_paid: number;
  balance_due: number;
  status: string;
  hold_status: string;
  match_status: ApMatchStatus | null;
}

/** List vendor invoices for the AP workbench. */
export async function listVendorInvoices(workspaceId: string): Promise<VendorInvoiceRow[]> {
  const { data, error } = await supabase
    .from("vendor_invoices")
    .select("id, vendor_invoice_number, amount, amount_paid, balance_due, status, hold_status, match_status")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail("listVendorInvoices", error);
  return (data ?? []) as VendorInvoiceRow[];
}

/** Run the PO ↔ receipt ↔ invoice 3-way match; returns the resulting match_status. */
export async function evaluateThreeWayMatch(vendorInvoiceId: string): Promise<ApMatchStatus> {
  const { data, error } = await supabase.rpc("evaluate_three_way_match", {
    p_vendor_invoice_id: vendorInvoiceId,
  });
  if (error) fail("evaluate_three_way_match", error);
  return (data as ApMatchStatus) ?? "unmatched";
}

/** Materialize approval-matrix steps (Section 9.3) for an invoice; returns steps created. */
export async function routeApInvoiceForApproval(vendorInvoiceId: string): Promise<number> {
  const { data, error } = await supabase.rpc("route_ap_invoice_for_approval", {
    p_vendor_invoice_id: vendorInvoiceId,
  });
  if (error) fail("route_ap_invoice_for_approval", error);
  return Number(data ?? 0);
}

/**
 * Record an AP payment. The RPC enforces the double-pay guard: it locks the
 * invoice FOR UPDATE and raises when the invoice is already paid, the amount
 * exceeds the balance, or approval is still pending. Returns the payment id.
 */
export async function recordApPayment(params: {
  vendorInvoiceId: string;
  amount: number;
  method?: string | null;
  reference?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("record_ap_payment", {
    p_vendor_invoice_id: params.vendorInvoiceId,
    p_amount: params.amount,
    p_method: params.method ?? null,
    p_reference: params.reference ?? null,
  });
  if (error) fail("record_ap_payment", error);
  return data as string;
}
