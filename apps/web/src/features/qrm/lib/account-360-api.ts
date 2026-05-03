import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

const accountSupabase = supabase as SupabaseClient<Database>;

type QrmCompanyRow = Database["public"]["Tables"]["qrm_companies"]["Row"];
type QrmArAgencyRow = Database["public"]["Tables"]["qrm_customer_ar_agencies"]["Row"];
type QrmProfitabilityFactRow = Database["public"]["Tables"]["qrm_customer_profitability_import_facts"]["Row"];
type QrmCompanyMemoRow = Database["public"]["Tables"]["qrm_company_memos"]["Row"];
type QrmContactRow = Database["public"]["Tables"]["qrm_contacts"]["Row"];

export interface Account360Company {
  id: string;
  name: string;
  workspace_id: string;
  city?: string | null;
  state?: string | null;
  metadata?: Record<string, unknown>;
  ein?: string | null;
  ein_masked?: boolean | null;
}

export interface Account360Profile {
  id?: string;
  budget_cycle_month?: number | null;
  fiscal_year_end_month?: number | null;
  health_score?: number | null;
  health_score_components?: Record<string, unknown> | null;
  health_score_updated_at?: string | null;
  last_interaction_at?: string | null;
  lifetime_value?: number | null;
  total_deals?: number | null;
}

export interface Account360FleetItem {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  serial_number: string | null;
  asset_tag: string | null;
  stage_label: string | null;
  eta: string | null;
  stage_updated: string | null;
}

export interface Account360OpenQuote {
  id: string;
  deal_id: string;
  status: string;
  net_total: number | null;
  expires_at: string | null;
  created_at: string;
  deal_name: string | null;
}

export interface Account360ServiceJob {
  id: string;
  current_stage: string;
  customer_problem_summary: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  completed_at: string | null;
  machine_id: string | null;
}

export interface Account360PartsRollup {
  lifetime_total: number;
  order_count: number;
  recent: Array<{
    id: string;
    status: string;
    total: number;
    created_at: string;
  }>;
}

export interface Account360Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  status: string;
}

export interface Account360HealthDelta {
  current_score: number | null;
  components: Record<string, unknown>;
  delta_7d: number | null;
  delta_30d: number | null;
  delta_90d: number | null;
}

export interface Account360ARBlock {
  id: string;
  block_reason: string;
  block_threshold_days: number;
  current_max_aging_days: number | null;
  status: "active" | "overridden" | "cleared";
  override_until: string | null;
  blocked_at: string;
}

export interface Account360Response {
  company: Account360Company;
  profile: Account360Profile | null;
  fleet: Account360FleetItem[];
  open_quotes: Account360OpenQuote[];
  service: Account360ServiceJob[];
  parts: Account360PartsRollup;
  invoices: Account360Invoice[];
  health: Account360HealthDelta | null;
  ar_block: Account360ARBlock | null;
}

/** Single round-trip composite for the Account 360 page. */
export async function fetchAccount360(companyId: string): Promise<Account360Response | null> {
  const { data, error } = await accountSupabase.rpc("get_account_360", { p_company_id: companyId });
  if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to load Account 360"));
  return coerceRpcJson<Account360Response>(data);
}

export interface FleetRadarLensItem {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  trade_up_score?: number | null;
  lifetime_parts_spend?: number | null;
  lens: string;
  reason: string;
}

export interface FleetRadarResponse {
  aging: FleetRadarLensItem[];
  expensive: FleetRadarLensItem[];
  trade_up: FleetRadarLensItem[];
  underutilized: FleetRadarLensItem[];
  attachment_upsell: FleetRadarLensItem[];
}

export async function fetchFleetRadar(companyId: string): Promise<FleetRadarResponse | null> {
  const { data, error } = await accountSupabase.rpc("get_fleet_radar", { p_company_id: companyId });
  if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to load Fleet Radar"));
  return coerceRpcJson<FleetRadarResponse>(data);
}

function coerceRpcJson<T>(value: Json | null): T | null {
  return value === null ? null : value as T;
}

function requiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeProductCategory(value: unknown): IntelliDealerCompanySnapshot["product_category"] {
  return value === "business" || value === "individual" || value === "government" || value === "non_profit" || value === "internal"
    ? value
    : null;
}

function normalizeArType(value: unknown): IntelliDealerCompanySnapshot["ar_type"] {
  return value === "open_item" || value === "balance_forward" || value === "true_balance_forward" ? value : "open_item";
}

export interface IntelliDealerCompanySnapshot extends Pick<
  QrmCompanyRow,
  | "id"
  | "legacy_customer_number"
  | "status"
  | "product_category"
  | "ar_type"
  | "payment_terms_code"
  | "terms_code"
  | "county"
  | "territory_code"
  | "pricing_level"
  | "business_fax"
  | "business_cell"
  | "do_not_contact"
  | "opt_out_sale_pi"
> {
  metadata: Record<string, unknown> | null;
}

export type IntelliDealerArAgency = Pick<
  QrmArAgencyRow,
  | "id"
  | "agency_code"
  | "expiration_year_month"
  | "active"
  | "is_default_agency"
  | "credit_rating"
  | "default_promotion_code"
  | "credit_limit_cents"
  | "transaction_limit_cents"
>;

export type IntelliDealerProfitabilityFact = Pick<
  QrmProfitabilityFactRow,
  | "id"
  | "area_code"
  | "area_label"
  | "ytd_sales_last_month_end_cents"
  | "ytd_costs_last_month_end_cents"
  | "current_month_sales_cents"
  | "current_month_costs_cents"
  | "ytd_margin_cents"
  | "ytd_margin_pct"
  | "current_month_margin_cents"
  | "current_month_margin_pct"
  | "last_12_margin_cents"
  | "last_12_margin_pct"
  | "fiscal_last_year_sales_cents"
  | "fiscal_last_year_margin_cents"
  | "territory_code"
  | "salesperson_code"
  | "county_code"
  | "business_class_code"
  | "as_of_date"
>;

export type IntelliDealerCompanyMemo = Pick<QrmCompanyMemoRow, "id" | "body" | "pinned" | "created_at" | "updated_at">;

export type IntelliDealerContactSignal = Pick<
  QrmContactRow,
  "id" | "first_name" | "last_name" | "title" | "email" | "phone" | "cell" | "direct_phone"
>;

export interface IntelliDealerAccountSummary {
  company: IntelliDealerCompanySnapshot | null;
  contacts: IntelliDealerContactSignal[];
  arAgencies: IntelliDealerArAgency[];
  profitability: IntelliDealerProfitabilityFact[];
  memos: IntelliDealerCompanyMemo[];
}

export async function fetchIntelliDealerAccountSummary(companyId: string): Promise<IntelliDealerAccountSummary> {
  const [companyResult, contactResult, arResult, profitabilityResult, memoResult] = await Promise.all([
    accountSupabase
      .from("qrm_companies")
      .select("id, legacy_customer_number, status, product_category, ar_type, payment_terms_code, terms_code, county, territory_code, pricing_level, business_fax, business_cell, do_not_contact, opt_out_sale_pi, metadata")
      .eq("id", companyId)
      .maybeSingle(),
    accountSupabase
      .from("qrm_contacts")
      .select("id, first_name, last_name, title, email, phone, cell, direct_phone")
      .eq("primary_company_id", companyId)
      .is("deleted_at", null)
      .order("last_name", { ascending: true })
      .limit(8),
    accountSupabase
      .from("qrm_customer_ar_agencies")
      .select("id, agency_code, expiration_year_month, active, is_default_agency, credit_rating, default_promotion_code, credit_limit_cents, transaction_limit_cents")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("is_default_agency", { ascending: false })
      .order("agency_code", { ascending: true }),
    accountSupabase
      .from("qrm_customer_profitability_import_facts")
      .select("id, area_code, area_label, ytd_sales_last_month_end_cents, ytd_costs_last_month_end_cents, current_month_sales_cents, current_month_costs_cents, ytd_margin_cents, ytd_margin_pct, current_month_margin_cents, current_month_margin_pct, last_12_margin_cents, last_12_margin_pct, fiscal_last_year_sales_cents, fiscal_last_year_margin_cents, territory_code, salesperson_code, county_code, business_class_code, as_of_date")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("area_code", { ascending: true }),
    accountSupabase
      .from("qrm_company_memos")
      .select("id, body, pinned, created_at, updated_at")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(25),
  ]);

  if (companyResult.error) throw new Error(companyResult.error.message ?? "Failed to load IntelliDealer company snapshot");
  if (contactResult.error) throw new Error(contactResult.error.message ?? "Failed to load IntelliDealer contacts");
  if (arResult.error) throw new Error(arResult.error.message ?? "Failed to load IntelliDealer A/R agencies");
  if (profitabilityResult.error) throw new Error(profitabilityResult.error.message ?? "Failed to load IntelliDealer profitability");
  if (memoResult.error) throw new Error(memoResult.error.message ?? "Failed to load IntelliDealer memos");

  return {
    company: normalizeIntelliDealerCompanyRows(companyResult.data ? [companyResult.data] : [])[0] ?? null,
    contacts: normalizeIntelliDealerContactRows(contactResult.data),
    arAgencies: normalizeIntelliDealerArAgencyRows(arResult.data),
    profitability: normalizeIntelliDealerProfitabilityRows(profitabilityResult.data),
    memos: normalizeIntelliDealerMemoRows(memoResult.data),
  };
}

export function normalizeIntelliDealerCompanyRows(rows: unknown): IntelliDealerCompanySnapshot[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      legacy_customer_number: nullableString(row.legacy_customer_number),
      status: nullableString(row.status),
      product_category: normalizeProductCategory(row.product_category),
      ar_type: normalizeArType(row.ar_type),
      payment_terms_code: nullableString(row.payment_terms_code),
      terms_code: nullableString(row.terms_code),
      county: nullableString(row.county),
      territory_code: nullableString(row.territory_code),
      pricing_level: nullableNumber(row.pricing_level),
      business_fax: nullableString(row.business_fax),
      business_cell: nullableString(row.business_cell),
      do_not_contact: nullableBoolean(row.do_not_contact) ?? false,
      opt_out_sale_pi: nullableBoolean(row.opt_out_sale_pi) ?? false,
      metadata: isRecord(row.metadata) ? row.metadata : null,
    }];
  });
}

export function normalizeIntelliDealerContactRows(rows: unknown): IntelliDealerContactSignal[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      first_name: requiredString(row.first_name),
      last_name: requiredString(row.last_name),
      title: nullableString(row.title),
      email: nullableString(row.email),
      phone: nullableString(row.phone),
      cell: nullableString(row.cell),
      direct_phone: nullableString(row.direct_phone),
    }];
  });
}

export function normalizeIntelliDealerArAgencyRows(rows: unknown): IntelliDealerArAgency[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      agency_code: requiredString(row.agency_code, "UNKNOWN"),
      expiration_year_month: nullableString(row.expiration_year_month),
      active: nullableBoolean(row.active) ?? false,
      is_default_agency: nullableBoolean(row.is_default_agency) ?? false,
      credit_rating: nullableString(row.credit_rating),
      default_promotion_code: nullableString(row.default_promotion_code),
      credit_limit_cents: nullableNumber(row.credit_limit_cents),
      transaction_limit_cents: nullableNumber(row.transaction_limit_cents),
    }];
  });
}

export function normalizeIntelliDealerProfitabilityRows(rows: unknown): IntelliDealerProfitabilityFact[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      area_code: requiredString(row.area_code, "unknown"),
      area_label: requiredString(row.area_label, "Unknown"),
      ytd_sales_last_month_end_cents: nullableNumber(row.ytd_sales_last_month_end_cents),
      ytd_costs_last_month_end_cents: nullableNumber(row.ytd_costs_last_month_end_cents),
      current_month_sales_cents: nullableNumber(row.current_month_sales_cents),
      current_month_costs_cents: nullableNumber(row.current_month_costs_cents),
      ytd_margin_cents: nullableNumber(row.ytd_margin_cents),
      ytd_margin_pct: nullableNumber(row.ytd_margin_pct),
      current_month_margin_cents: nullableNumber(row.current_month_margin_cents),
      current_month_margin_pct: nullableNumber(row.current_month_margin_pct),
      last_12_margin_cents: nullableNumber(row.last_12_margin_cents),
      last_12_margin_pct: nullableNumber(row.last_12_margin_pct),
      fiscal_last_year_sales_cents: nullableNumber(row.fiscal_last_year_sales_cents),
      fiscal_last_year_margin_cents: nullableNumber(row.fiscal_last_year_margin_cents),
      territory_code: nullableString(row.territory_code),
      salesperson_code: nullableString(row.salesperson_code),
      county_code: nullableString(row.county_code),
      business_class_code: nullableString(row.business_class_code),
      as_of_date: nullableString(row.as_of_date),
    }];
  });
}

export function normalizeIntelliDealerMemoRows(rows: unknown): IntelliDealerCompanyMemo[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      body: requiredString(row.body),
      pinned: nullableBoolean(row.pinned) ?? false,
      created_at: requiredString(row.created_at),
      updated_at: requiredString(row.updated_at),
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
