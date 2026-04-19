import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

// ── Service credits ──────────────────────────────────────────────────────────

export type ServiceCreditRow =
  Database["public"]["Tables"]["qb_service_credit_config"]["Row"];
export type ServiceCreditInput =
  Database["public"]["Tables"]["qb_service_credit_config"]["Insert"];

const DEFAULTS: ServiceCreditRow[] = [
  { workspace_id: "default", category: "compact",  credit_cents: 150000, travel_budget_cents: 20000, updated_at: new Date().toISOString() },
  { workspace_id: "default", category: "large",    credit_cents: 250000, travel_budget_cents: 20000, updated_at: new Date().toISOString() },
  { workspace_id: "default", category: "forestry", credit_cents: 350000, travel_budget_cents: 20000, updated_at: new Date().toISOString() },
];

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export async function getServiceCredits(): Promise<ServiceCreditRow[]> {
  const { data, error } = await supabase
    .from("qb_service_credit_config")
    .select("*")
    .order("category");

  if (error || !data || data.length === 0) {
    return DEFAULTS;
  }
  return data;
}

export async function upsertServiceCredits(
  rows: ServiceCreditInput[]
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_service_credit_config")
    .upsert(rows);

  if (error) return { error: error.message };
  return { ok: true };
}

// ── Internal freight rules ───────────────────────────────────────────────────

export type FreightRuleRow =
  Database["public"]["Tables"]["qb_internal_freight_rules"]["Row"];
export type FreightRuleInput =
  Database["public"]["Tables"]["qb_internal_freight_rules"]["Insert"];

export async function getFreightRules(): Promise<FreightRuleRow[]> {
  const { data, error } = await supabase
    .from("qb_internal_freight_rules")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return [];
  return data ?? [];
}

export async function createFreightRule(
  input: FreightRuleInput
): Promise<{ ok: true; id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("qb_internal_freight_rules")
    .insert(input)
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { ok: true, id: data.id };
}

export async function updateFreightRule(
  id: string,
  input: FreightRuleInput
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_internal_freight_rules")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteFreightRule(
  id: string
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_internal_freight_rules")
    .delete()
    .eq("id", id);

  if (error) return { error: error.message };
  return { ok: true };
}

// ── Brand freight keys ───────────────────────────────────────────────────────

export interface BrandFreightKeyRow {
  id: string;
  code: string;
  name: string;
  has_inbound_freight_key: boolean;
}

export async function getBrandFreightKeys(): Promise<BrandFreightKeyRow[]> {
  const { data, error } = await supabase
    .from("qb_brands")
    .select("id, code, name, has_inbound_freight_key")
    .order("name", { ascending: true });

  if (error) return [];
  return (data ?? []) as BrandFreightKeyRow[];
}

export async function setBrandFreightKey(
  brandId: string,
  enabled: boolean
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_brands")
    .update({ has_inbound_freight_key: enabled })
    .eq("id", brandId);

  if (error) return { error: error.message };
  return { ok: true };
}

// ── Brand Engine Status (CP9) ────────────────────────────────────────────────
//
// UI label: "Deal Engine Enabled". DB column is discount_configured (retained
// to avoid a 14-callsite rename). When true, the brand is fully configured and
// quote scenarios can be generated for it. When false, qb-ai-scenarios returns
// "not yet configured for Deal Engine" and skips scenario generation.

export interface BrandEngineStatusRow {
  id: string;
  code: string;
  name: string;
  /** Maps to qb_brands.discount_configured. Surfaced as "Deal Engine Enabled". */
  discount_configured: boolean;
  has_inbound_freight_key: boolean;
  /** # of published price sheets for this brand (from qb_price_sheets). */
  published_sheet_count: number;
  /** # of freight zones configured for this brand (from qb_freight_zones). */
  freight_zone_count: number;
  /** # of active programs for this brand (from qb_programs). */
  active_program_count: number;
}

export async function getBrandEngineStatus(): Promise<BrandEngineStatusRow[]> {
  const [brandsRes, sheetsRes, zonesRes, programsRes] = await Promise.all([
    supabase
      .from("qb_brands")
      .select("id, code, name, discount_configured, has_inbound_freight_key")
      .order("name", { ascending: true }),
    supabase
      .from("qb_price_sheets")
      .select("brand_id, status"),
    supabase
      .from("qb_freight_zones")
      .select("brand_id"),
    supabase
      .from("qb_programs")
      .select("brand_id, active"),
  ]);

  const brands   = (brandsRes.data   ?? []) as Array<{
    id: string; code: string; name: string;
    discount_configured: boolean; has_inbound_freight_key: boolean;
  }>;
  const sheets   = (sheetsRes.data   ?? []) as Array<{ brand_id: string | null; status: string }>;
  const zones    = (zonesRes.data    ?? []) as Array<{ brand_id: string }>;
  const programs = (programsRes.data ?? []) as Array<{ brand_id: string | null; active: boolean | null }>;

  const publishedByBrand = new Map<string, number>();
  for (const s of sheets) {
    if (!s.brand_id || s.status !== "published") continue;
    publishedByBrand.set(s.brand_id, (publishedByBrand.get(s.brand_id) ?? 0) + 1);
  }

  const zonesByBrand = new Map<string, number>();
  for (const z of zones) {
    zonesByBrand.set(z.brand_id, (zonesByBrand.get(z.brand_id) ?? 0) + 1);
  }

  const activeProgramsByBrand = new Map<string, number>();
  for (const p of programs) {
    if (!p.brand_id || !p.active) continue;
    activeProgramsByBrand.set(p.brand_id, (activeProgramsByBrand.get(p.brand_id) ?? 0) + 1);
  }

  return brands.map((b) => ({
    id:                      b.id,
    code:                    b.code,
    name:                    b.name,
    discount_configured:     b.discount_configured,
    has_inbound_freight_key: b.has_inbound_freight_key,
    published_sheet_count:   publishedByBrand.get(b.id) ?? 0,
    freight_zone_count:      zonesByBrand.get(b.id) ?? 0,
    active_program_count:    activeProgramsByBrand.get(b.id) ?? 0,
  }));
}

export async function setBrandDealEngineEnabled(
  brandId: string,
  enabled: boolean,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_brands")
    .update({ discount_configured: enabled })
    .eq("id", brandId);

  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * A brand is considered quote-ready when it has at least one published price
 * sheet AND at least one freight zone. Programs are nice-to-have (many brands
 * have programs, but a plain-pricing brand can still quote without them). The
 * inbound freight key is independent — only affects freight line display.
 *
 * Exported for tests and for UI warning surfaces.
 */
export function isBrandQuoteReady(row: BrandEngineStatusRow): boolean {
  return row.published_sheet_count > 0 && row.freight_zone_count > 0;
}

/**
 * Returns an array of human-readable missing-prereq labels for a brand.
 * Empty when all prereqs are met.
 */
export function missingPrereqs(row: BrandEngineStatusRow): string[] {
  const missing: string[] = [];
  if (row.published_sheet_count === 0) missing.push("price sheet");
  if (row.freight_zone_count === 0)    missing.push("freight zones");
  return missing;
}
