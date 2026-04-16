// Domain types for the QB moonshot. Wraps generated DB types with human names
// and adds helpers used across slices 02–08.
//
// Conventions (from the Quote Builder Moonshot spec):
//  - All monetary values in cents (bigint on the DB side, number in TS).
//  - Percentages stored as decimals (0.12 = 12%).
//  - UUIDs for all IDs.
//  - qb_* table prefix for Moonshot tables.

import type { Database } from "@/lib/database.types";

// ── Row / Insert types pulled from generated Database ───────────────────────

export type QbBrand                = Database["public"]["Tables"]["qb_brands"]["Row"];
export type QbBrandInsert          = Database["public"]["Tables"]["qb_brands"]["Insert"];
export type QbEquipmentModel       = Database["public"]["Tables"]["qb_equipment_models"]["Row"];
export type QbEquipmentModelInsert = Database["public"]["Tables"]["qb_equipment_models"]["Insert"];
export type QbAttachment           = Database["public"]["Tables"]["qb_attachments"]["Row"];
export type QbAttachmentInsert     = Database["public"]["Tables"]["qb_attachments"]["Insert"];
export type QbFreightZone          = Database["public"]["Tables"]["qb_freight_zones"]["Row"];
export type QbProgram              = Database["public"]["Tables"]["qb_programs"]["Row"];
export type QbProgramInsert        = Database["public"]["Tables"]["qb_programs"]["Insert"];
export type QbProgramStackingRule  = Database["public"]["Tables"]["qb_program_stacking_rules"]["Row"];
export type QbQuote                = Database["public"]["Tables"]["qb_quotes"]["Row"];
export type QbQuoteInsert          = Database["public"]["Tables"]["qb_quotes"]["Insert"];
export type QbQuoteLineItem        = Database["public"]["Tables"]["qb_quote_line_items"]["Row"];
export type QbDeal                 = Database["public"]["Tables"]["qb_deals"]["Row"];
export type QbDealInsert           = Database["public"]["Tables"]["qb_deals"]["Insert"];
export type QbTradeIn              = Database["public"]["Tables"]["qb_trade_ins"]["Row"];
export type QbPriceSheet           = Database["public"]["Tables"]["qb_price_sheets"]["Row"];
export type QbPriceSheetItem       = Database["public"]["Tables"]["qb_price_sheet_items"]["Row"];

// ── String unions (match check constraints in the DB) ───────────────────────

export type QbCustomerType = "standard" | "gmu";

export type QbCompanyClassification =
  | "standard"
  | "gmu"
  | "forestry"
  | "construction"
  | "land_clearing"
  | "rental"
  | "logging"
  | "other";

export type QbCompanyStatus =
  | "active"
  | "inactive"
  | "prospect"
  | "archived";

export type QbProgramType =
  | "cash_in_lieu"
  | "low_rate_financing"
  | "gmu_rebate"
  | "aged_inventory"
  | "bridge_rent_to_sales"
  | "additional_rebate"
  | "other";

export type QbQuoteStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "converted_to_deal"
  | "archived";

export type QbDealStatus =
  | "active"
  | "in_finance"
  | "won"
  | "lost"
  | "cancelled"
  | "delivered";

export type QbQuoteLineType =
  | "attachment"
  | "trade_in"
  | "discount"
  | "credit"
  | "adjustment";

export type QbPriceSheetStatus =
  | "pending_review"
  | "extracting"
  | "extracted"
  | "published"
  | "rejected"
  | "superseded";

// ── JSONB payload shapes (stored in qb_programs.details by program_type) ────

export interface QbCashInLieuDetails {
  rebates: Array<{ model_code: string; amount_cents: number }>;
}

export interface QbLowRateFinancingDetails {
  terms: Array<{
    months: number;
    rate_pct: number;
    dealer_participation_pct: number;
  }>;
  lenders: Array<{
    name: string;
    customer_type: "commercial" | "consumer";
    contact?: string;
  }>;
}

export interface QbGmuRebateDetails {
  discount_off_list_pct: number;
  requires_preapproval: boolean;
  eligible_customer_types: string[];
}

export interface QbAgedInventoryDetails {
  eligible_model_years: number[];
  rebates: Array<{ model_code: string; amount_cents: number }>;
  requires_reorder: boolean;
}

export interface QbBridgeRentToSalesDetails {
  rebates: Array<{ model_code: string; amount_cents: number }>;
  requires_reorder: boolean;
  can_combine_with_others: boolean;
}

// Financing scenario stored on qb_quotes.financing_scenario
export interface QbFinancingScenarioSnapshot {
  term_months: number;
  rate_pct: number;
  payment_cents: number;
  dealer_participation_cents: number;
  lender_name?: string;
}

// ── Money helpers — every QB monetary value is cents ────────────────────────

/** Format cents as a USD display string. 15000 → "$150" */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Format cents with cents precision. 15050 → "$150.50" */
export function formatCentsPrecise(cents: number | null | undefined): string {
  if (cents == null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Convert a dollar display input to cents. "150.50" → 15050 */
export function dollarsToCents(dollars: string | number): number {
  const n = typeof dollars === "string" ? Number(dollars) : dollars;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Format a decimal percentage for display. 0.1200 → "12.0%" */
export function formatPct(pct: number | null | undefined, digits = 1): string {
  if (pct == null) return "0%";
  return `${(pct * 100).toFixed(digits)}%`;
}
