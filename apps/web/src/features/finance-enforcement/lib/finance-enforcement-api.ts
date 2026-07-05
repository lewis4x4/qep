/**
 * Feature-local API adapter for the QEP finance-enforcement surfaces.
 *
 * Wraps the role-gated Postgres RPCs and the tax-calculator edge function
 * shipped in migrations 655-670 plus 766 (branch-prefixed invoice numbering, county
 * tax + Ship-To sourcing, Net 30 / 60-day credit holds, margin matrix,
 * equipment-sale reversal approver, Form 8300 + FET, AP 3-way match /
 * approval routing / double-pay guard, QEP OS invoice sequencing, quarter
 * close/reopen, AR dunning, finance-only margin segments, and IntelliDealer
 * master-match dry runs, and the July 3 trade-reconditioning margin gate).
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
// K1.1 Finance SoR foundation read model (handoff 2026-07-03)
// ─────────────────────────────────────────────────────────────────────────────
export type FinanceBoundaryRole =
  | "forward_accounting_sor"
  | "transition_operational_sor"
  | "downstream_output_only";

export interface FinanceSystemBoundaryRow {
  system: "QEP OS" | "IntelliDealer" | "QuickBooks Desktop";
  role: FinanceBoundaryRole;
  isLedgerOfRecord: boolean;
  evidence: string;
}

export interface FinanceFoundationCapability {
  migration: string;
  label: string;
  ownerSystem: "qep_os" | "intellidealer_transition" | "quickbooks_downstream";
  status: "shipped" | "parked";
  evidence: string;
}

export interface FinanceFoundationConfigRow {
  config_key: string;
  config_value: unknown;
  safe_default: unknown;
  authorizing_question: string | null;
  note: string | null;
  is_active: boolean;
}

export type FinanceConfigReadinessStatus = "owner_reviewed" | "config_required";

export interface FinanceConfigReadinessRow {
  config_key: string;
  label: string;
  status: FinanceConfigReadinessStatus;
  effective_value: unknown | null;
  parked_default: unknown | null;
  source_migration: string | null;
  authorizing_question: string;
  note: string;
}

export interface FinanceFoundationStatus {
  preparedFrom: string;
  systemBoundary: FinanceSystemBoundaryRow[];
  capabilities: FinanceFoundationCapability[];
  requiredConfig: FinanceConfigReadinessRow[];
  configSummary: {
    ownerReviewed: number;
    configRequired: number;
  };
}

const SYSTEM_BOUNDARY: FinanceSystemBoundaryRow[] = [
  {
    system: "QEP OS",
    role: "forward_accounting_sor",
    isLedgerOfRecord: true,
    evidence: "K-stream decision artifact: QEP OS owns forward AR/AP/reporting, tax evidence, close/reopen audit, and financial source data.",
  },
  {
    system: "IntelliDealer",
    role: "transition_operational_sor",
    isLedgerOfRecord: false,
    evidence: "K-stream decision artifact: IntelliDealer remains the current operational SoR during transition until cutover/parallel closeout.",
  },
  {
    system: "QuickBooks Desktop",
    role: "downstream_output_only",
    isLedgerOfRecord: false,
    evidence: "K-stream decision artifact: QuickBooks Desktop is downstream check-register and CPA-reporting output only, not the ledger of record.",
  },
];

const FOUNDATION_CAPABILITIES: FinanceFoundationCapability[] = [
  {
    migration: "655/662",
    label: "Branch-prefixed QEP OS invoice sequencing",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "invoice_number_sequences, finance_invoice_sequences, qep_next_finance_invoice_number",
  },
  {
    migration: "656/666",
    label: "Florida county tax destination sourcing and DR-15 rental evidence",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "tax_jurisdictions, qep_resolve_fl_tax_jurisdiction, finance_foundation_fl_dr15_monthly_breakout",
  },
  {
    migration: "657/664",
    label: "AR terms, 60-day holds, finance-charge and dunning ledger",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "payment_terms, evaluate_credit_holds, ar_dunning_events, run_ar_dunning_cycle",
  },
  {
    migration: "658/669",
    label: "Finance-only margin segmentation across equipment, parts, and service",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "v_margin_matrix_summary, finance_margin_segment_facts, finance_margin_segment_matrix",
  },
  {
    migration: "766",
    label: "Trade-reconditioning 15% expected gross-margin approval gate",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "qep_trade_expected_margin_pct, qep_trade_recondition_margin_floor_pct, qb_margin_thresholds 15% floor, trade_recondition_approval_audit",
  },
  {
    migration: "659/667",
    label: "Equipment-sale reversal manager approval and append-only audit",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "equipment_reversal_audit, equipment_reversal_approval_audit",
  },
  {
    migration: "660/668",
    label: "Form 8300 and federal excise tax compliance scaffolding",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "form_8300_reports, form_8300_compliance_events, fet_liability_events",
  },
  {
    migration: "661/665",
    label: "AP 3-way match, approval routing, and double-pay guard",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "goods_receipts, ap_approval_matrix, ap_invoice_approvals, ap_payments",
  },
  {
    migration: "663",
    label: "Quarter close hard lock and dual-approver reopen",
    ownerSystem: "qep_os",
    status: "shipped",
    evidence: "gl_periods quarter_status, quarter_reopen_log, reopen_gl_quarter",
  },
  {
    migration: "670",
    label: "IntelliDealer master-match dry-run harness",
    ownerSystem: "intellidealer_transition",
    status: "parked",
    evidence: "intellidealer_master_match_dry_runs live_load_status = PARKED",
  },
  {
    migration: "368+",
    label: "QuickBooks GL/export bridge",
    ownerSystem: "quickbooks_downstream",
    status: "parked",
    evidence: "quickbooks_gl_sync_jobs and quickbooks_gl_status are outbound sync evidence only",
  },
];

const REQUIRED_FINANCE_CONFIGS: Array<{
  config_key: string;
  label: string;
  source_migration: string | null;
  authorizing_question: string;
  note: string;
}> = [
  {
    config_key: "invoice_pad_width",
    label: "Invoice zero-pad width",
    source_migration: "662",
    authorizing_question: "Round 3 open item: invoice width",
    note: "Surface as config-required until owner-reviewed width is accepted.",
  },
  {
    config_key: "cpa_adjustment_posting_target",
    label: "CPA adjustment posting target",
    source_migration: "663",
    authorizing_question: "Round 2 Q9: CPA adjustment posting target",
    note: "Do not infer current-period or source-period behavior as final.",
  },
  {
    config_key: "finance_charge_basis",
    label: "Finance-charge basis",
    source_migration: "664",
    authorizing_question: "Round 3 open item: finance-charge basis",
    note: "Principal-only is parked as a safe default, not a final business decision.",
  },
  {
    config_key: "florida_finance_charge_lawful_cap",
    label: "Florida finance-charge lawful cap",
    source_migration: "664",
    authorizing_question: "Finance charge lawful maximum cap",
    note: "Requires owner/legal review before live billing.",
  },
  {
    config_key: "reconditioning_soft_cap_threshold",
    label: "AP trade-reconditioning soft-cap threshold",
    source_migration: "665",
    authorizing_question: "Round 3 open item: trade-in reconditioning soft-cap",
    note: "Threshold remains null until owner-reviewed.",
  },
  {
    config_key: "trade_recondition_material_change_threshold",
    label: "Trade-reconditioning material-change reapproval threshold",
    source_migration: "766",
    authorizing_question: "Round 3 open item: material recon change threshold",
    note: "The stale/reapproval path is shipped, but the trigger threshold remains config-required until owner-reviewed.",
  },
  {
    config_key: "corporate_allocation_basis",
    label: "Corporate-to-branch allocation basis",
    source_migration: null,
    authorizing_question: "K3.1 migration-path decision",
    note: "Open working-session value; no default basis is assumed.",
  },
  {
    config_key: "depreciation_allocation_rules",
    label: "Per-unit depreciation allocation rules",
    source_migration: null,
    authorizing_question: "K3.1 migration-path decision",
    note: "Open working-session value; no depreciation schedule is assumed.",
  },
  {
    config_key: "floor_plan_lender_terms",
    label: "Floor-plan lender terms",
    source_migration: null,
    authorizing_question: "K3.1 migration-path decision",
    note: "Wells Fargo, Bank of Oklahoma, Northpoint, Incredible Bank, US Bank, Mitsubishi Finance, and IBS treatment remain config-required.",
  },
  {
    config_key: "open_service_wo_cutover_policy",
    label: "Open service-WO cutover policy",
    source_migration: null,
    authorizing_question: "K3.1 migration-path decision",
    note: "Open service WOs remain the hardest cutover case.",
  },
  {
    config_key: "master_id_strategy",
    label: "Customer/vendor master-ID strategy",
    source_migration: "670",
    authorizing_question: "K3.1 migration-path decision",
    note: "Dry-run matching is shipped; live canonical-load strategy is still parked.",
  },
  {
    config_key: "net45_account_list",
    label: "Net 45 account list",
    source_migration: "657",
    authorizing_question: "Open finance value: Net 45 account list",
    note: "Payment terms support Net 45, but assignments must be data-driven.",
  },
  {
    config_key: "internal_wo_rate_and_parts_markup",
    label: "Internal WO rate and parts markup",
    source_migration: null,
    authorizing_question: "Open finance value: internal WO door rate and internal parts markup",
    note: "No internal rate or markup is assumed.",
  },
  {
    config_key: "bank_account_list",
    label: "Bank account list and branch cash tracking",
    source_migration: null,
    authorizing_question: "Open finance value: exact bank account list",
    note: "No bank-account list is embedded in code.",
  },
  {
    config_key: "dr15_collection_allowance",
    label: "DR-15 collection allowance choice",
    source_migration: "666",
    authorizing_question: "Open finance value: DR-15 collection allowance choice",
    note: "DR-15 reporting evidence exists; allowance choice remains config-required.",
  },
  {
    config_key: "quickbooks_desktop_version",
    label: "QuickBooks Desktop exact version",
    source_migration: null,
    authorizing_question: "Open finance value: QuickBooks Desktop exact version",
    note: "Captured only for downstream output compatibility; never promotes QuickBooks to ledger.",
  },
];

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}

function hasNullLeaf(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.some(hasNullLeaf);
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).some(hasNullLeaf);
  }
  return false;
}

function isParkedSafeDefault(row: FinanceFoundationConfigRow | undefined): boolean {
  if (!row) return true;
  if (hasNullLeaf(row.config_value)) return true;
  return stableJsonStringify(row.config_value) === stableJsonStringify(row.safe_default);
}

export function buildFinanceFoundationStatus(
  configRows: FinanceFoundationConfigRow[],
): FinanceFoundationStatus {
  const byKey = new Map(configRows.filter((row) => row.is_active).map((row) => [row.config_key, row]));
  const requiredConfig = REQUIRED_FINANCE_CONFIGS.map((item): FinanceConfigReadinessRow => {
    const row = byKey.get(item.config_key);
    const configRequired = isParkedSafeDefault(row);
    return {
      config_key: item.config_key,
      label: item.label,
      status: configRequired ? "config_required" : "owner_reviewed",
      effective_value: configRequired ? null : row?.config_value ?? null,
      parked_default: row?.safe_default ?? null,
      source_migration: item.source_migration,
      authorizing_question: row?.authorizing_question ?? item.authorizing_question,
      note: row?.note ?? item.note,
    };
  });

  return {
    preparedFrom: "QEP_GOLD_HANDOFF_NEXT_OPEN_ITEMS_2026-07-03, QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03, Linear QEP-221 July 3 trade-recondition note, and migration 766",
    systemBoundary: SYSTEM_BOUNDARY,
    capabilities: FOUNDATION_CAPABILITIES,
    requiredConfig,
    configSummary: {
      ownerReviewed: requiredConfig.filter((row) => row.status === "owner_reviewed").length,
      configRequired: requiredConfig.filter((row) => row.status === "config_required").length,
    },
  };
}

/** Read the K1.1 finance SoR foundation status without promoting safe defaults. */
export async function getFinanceFoundationStatus(workspaceId: string): Promise<FinanceFoundationStatus> {
  const { data, error } = await supabase
    .from("finance_foundation_config")
    .select("config_key, config_value, safe_default, authorizing_question, note, is_active")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("config_key", { ascending: true });
  if (error) fail("getFinanceFoundationStatus", error);
  return buildFinanceFoundationStatus((data ?? []) as FinanceFoundationConfigRow[]);
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
