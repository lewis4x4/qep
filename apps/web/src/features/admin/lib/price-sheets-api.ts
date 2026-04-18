/**
 * Price Sheets Admin API — Supabase queries for the admin price-sheet dashboard.
 *
 * Schema notes (actual DB, not plan spec):
 *   qb_freight_zones has state_codes text[] (array), freight_large_cents +
 *   freight_small_cents (separate fields), no notes column, no updated_at.
 *   FreightZone type is derived directly from Database types to stay in sync.
 *
 * getBrandSheetStatus runs 3 parallel queries + 1 conditional query (item counts)
 * to assemble a per-brand dashboard row without any n+1.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BrandSheetStatus = {
  brand_id: string;
  brand_name: string;
  brand_code: string;
  has_active_sheet: boolean;
  /** "v2026.04" derived from uploaded_at of the latest published sheet, or null */
  active_sheet_version: string | null;
  /** Count of qb_price_sheet_items rows for the active published sheet */
  active_sheet_item_count: number;
  /** ISO timestamp of the latest published sheet's uploaded_at, or null */
  last_uploaded_at: string | null;
  /** Count of qb_price_sheets rows in non-published in-flight status for this brand */
  pending_review_count: number;
  /** Maps to qb_brands.discount_configured — surfaced as "Deal Engine Enabled" in UI */
  discount_configured: boolean;
  has_inbound_freight_key: boolean;
  /** Count of qb_freight_zones rows for this brand */
  freight_zone_count: number;
};

/**
 * FreightZone is the exact DB row shape from qb_freight_zones.
 * Note: uses state_codes (text[], not state_code string) and separate
 * freight_large_cents / freight_small_cents fields (not a single rate_cents).
 */
export type FreightZone = Database["public"]["Tables"]["qb_freight_zones"]["Row"];
export type FreightZoneInsert = Database["public"]["Tables"]["qb_freight_zones"]["Insert"];
export type FreightZoneUpdate = Database["public"]["Tables"]["qb_freight_zones"]["Update"];

// ── Internal helpers ──────────────────────────────────────────────────────────

const IN_FLIGHT_STATUSES = new Set(["pending_review", "extracting", "extracted"]);

function sheetVersion(uploadedAt: string): string {
  const d = new Date(uploadedAt);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `v${d.getUTCFullYear()}.${mm}`;
}

// ── getBrandSheetStatus ───────────────────────────────────────────────────────

/**
 * Returns one row per brand with freshness and configuration status for the
 * price sheets dashboard. Covers all brands, including those with no sheets.
 *
 * Makes 3 parallel queries + 1 conditional query (item counts for published sheets).
 */
export async function getBrandSheetStatus(): Promise<BrandSheetStatus[]> {
  const [brandsRes, sheetsRes, zonesRes] = await Promise.all([
    supabase
      .from("qb_brands")
      .select("id, code, name, discount_configured, has_inbound_freight_key")
      .order("name", { ascending: true }),
    supabase
      .from("qb_price_sheets")
      .select("id, brand_id, uploaded_at, status")
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("qb_freight_zones")
      .select("brand_id"),
  ]);

  const brands  = (brandsRes.data  ?? []) as Array<{ id: string; code: string; name: string; discount_configured: boolean; has_inbound_freight_key: boolean }>;
  const sheets  = (sheetsRes.data  ?? []) as Array<{ id: string; brand_id: string | null; uploaded_at: string; status: string }>;
  const zones   = (zonesRes.data   ?? []) as Array<{ brand_id: string }>;

  // Latest published sheet per brand (sheets are ordered newest-first)
  const latestPublished = new Map<string, typeof sheets[0]>();
  for (const sheet of sheets) {
    if (sheet.status === "published" && sheet.brand_id && !latestPublished.has(sheet.brand_id)) {
      latestPublished.set(sheet.brand_id, sheet);
    }
  }

  // In-flight sheet count per brand (pending_review / extracting / extracted)
  const pendingByBrand = new Map<string, number>();
  for (const sheet of sheets) {
    if (sheet.brand_id && IN_FLIGHT_STATUSES.has(sheet.status)) {
      pendingByBrand.set(sheet.brand_id, (pendingByBrand.get(sheet.brand_id) ?? 0) + 1);
    }
  }

  // Item counts for active published sheets (single bounded query)
  const itemCountBySheet = new Map<string, number>();
  const publishedIds = [...latestPublished.values()].map((s) => s.id);
  if (publishedIds.length > 0) {
    const { data: items } = await supabase
      .from("qb_price_sheet_items")
      .select("price_sheet_id")
      .in("price_sheet_id", publishedIds);
    for (const item of (items ?? []) as Array<{ price_sheet_id: string }>) {
      itemCountBySheet.set(item.price_sheet_id, (itemCountBySheet.get(item.price_sheet_id) ?? 0) + 1);
    }
  }

  // Freight zone count per brand
  const zoneCountByBrand = new Map<string, number>();
  for (const zone of zones) {
    zoneCountByBrand.set(zone.brand_id, (zoneCountByBrand.get(zone.brand_id) ?? 0) + 1);
  }

  return brands.map((brand) => {
    const active = latestPublished.get(brand.id) ?? null;
    return {
      brand_id:                brand.id,
      brand_name:              brand.name,
      brand_code:              brand.code,
      has_active_sheet:        active !== null,
      active_sheet_version:    active ? sheetVersion(active.uploaded_at) : null,
      active_sheet_item_count: active ? (itemCountBySheet.get(active.id) ?? 0) : 0,
      last_uploaded_at:        active?.uploaded_at ?? null,
      pending_review_count:    pendingByBrand.get(brand.id) ?? 0,
      discount_configured:     brand.discount_configured,
      has_inbound_freight_key: brand.has_inbound_freight_key,
      freight_zone_count:      zoneCountByBrand.get(brand.id) ?? 0,
    };
  });
}

// ── Freight zones CRUD ────────────────────────────────────────────────────────

export async function getFreightZones(brandId: string): Promise<FreightZone[]> {
  const { data, error } = await supabase
    .from("qb_freight_zones")
    .select("*")
    .eq("brand_id", brandId)
    .order("zone_name", { ascending: true });

  if (error) return [];
  return (data ?? []) as FreightZone[];
}

/**
 * Insert when no id provided; update existing row when id is present.
 * Dollar↔cents conversion is the caller's responsibility — pass raw cents.
 */
export async function upsertFreightZone(
  input: FreightZoneInsert & { id?: string },
): Promise<{ ok: true; zone: FreightZone } | { error: string }> {
  if (input.id) {
    const { id, ...rest } = input;
    const { data, error } = await supabase
      .from("qb_freight_zones")
      .update(rest as FreightZoneUpdate)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return { error: error.message };
    return { ok: true, zone: data as FreightZone };
  }

  const { data, error } = await supabase
    .from("qb_freight_zones")
    .insert(input)
    .select("*")
    .single();
  if (error) return { error: error.message };
  return { ok: true, zone: data as FreightZone };
}

export async function deleteFreightZone(
  zoneId: string,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_freight_zones")
    .delete()
    .eq("id", zoneId);

  if (error) return { error: error.message };
  return { ok: true };
}
