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
import { US_STATE_CODES, type StateCode } from "./us-states";

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
const US_STATE_CODE_SET: ReadonlySet<string> = new Set(US_STATE_CODES);

type BrandSheetSourceRow = {
  id: string;
  code: string;
  name: string;
  discount_configured: boolean;
  has_inbound_freight_key: boolean;
};

type PriceSheetSourceRow = {
  id: string;
  brand_id: string;
  uploaded_at: string;
  status: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredNumber(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed == null ? null : parsed;
}

function isStateCode(value: unknown): value is StateCode {
  return typeof value === "string" && US_STATE_CODE_SET.has(value);
}

function validStateCodes(value: unknown): StateCode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStateCode);
}

export function normalizeBrandSheetSourceRows(value: unknown): BrandSheetSourceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const code = requiredString(row.code);
    const name = requiredString(row.name);
    if (!id || !code || !name) return [];
    return [{
      id,
      code,
      name,
      discount_configured: bool(row.discount_configured),
      has_inbound_freight_key: bool(row.has_inbound_freight_key),
    }];
  });
}

export function normalizePriceSheetSourceRows(value: unknown): PriceSheetSourceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const brandId = requiredString(row.brand_id);
    const uploadedAt = requiredString(row.uploaded_at);
    const status = requiredString(row.status);
    if (!id || !brandId || !uploadedAt || !status || !Number.isFinite(new Date(uploadedAt).getTime())) return [];
    return [{ id, brand_id: brandId, uploaded_at: uploadedAt, status }];
  });
}

export function normalizeBrandIdRows(value: unknown): Array<{ brand_id: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const brandId = requiredString(row.brand_id);
    return brandId ? [{ brand_id: brandId }] : [];
  });
}

export function normalizePriceSheetItemRows(value: unknown): Array<{ price_sheet_id: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const priceSheetId = requiredString(row.price_sheet_id);
    return priceSheetId ? [{ price_sheet_id: priceSheetId }] : [];
  });
}

export function normalizeFreightZoneRows(value: unknown): FreightZone[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const workspaceId = requiredString(row.workspace_id);
    const brandId = requiredString(row.brand_id);
    const zoneName = requiredString(row.zone_name);
    const freightLargeCents = requiredNumber(row.freight_large_cents);
    const freightSmallCents = requiredNumber(row.freight_small_cents);
    const createdAt = requiredString(row.created_at);
    if (!id || !workspaceId || !brandId || !zoneName || freightLargeCents == null || freightSmallCents == null || !createdAt) {
      return [];
    }
    return [{
      id,
      workspace_id: workspaceId,
      brand_id: brandId,
      zone_name: zoneName,
      state_codes: validStateCodes(row.state_codes),
      freight_large_cents: freightLargeCents,
      freight_small_cents: freightSmallCents,
      effective_from: nullableString(row.effective_from),
      effective_to: nullableString(row.effective_to),
      created_at: createdAt,
    }];
  });
}

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

  const brands = normalizeBrandSheetSourceRows(brandsRes.data);
  const sheets = normalizePriceSheetSourceRows(sheetsRes.data);
  const zones = normalizeBrandIdRows(zonesRes.data);

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
    for (const item of normalizePriceSheetItemRows(items)) {
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
  return normalizeFreightZoneRows(data);
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
    const zone = normalizeFreightZoneRows(data ? [data] : [])[0];
    if (!zone) return { error: "Saved freight zone returned malformed row" };
    return { ok: true, zone };
  }

  const { data, error } = await supabase
    .from("qb_freight_zones")
    .insert(input)
    .select("*")
    .single();
  if (error) return { error: error.message };
  const zone = normalizeFreightZoneRows(data ? [data] : [])[0];
  if (!zone) return { error: "Saved freight zone returned malformed row" };
  return { ok: true, zone };
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

// ── Coverage analysis (CP7) ──────────────────────────────────────────────────

export type FreightCoverage = {
  /** State codes with at least one zone. */
  covered: StateCode[];
  /** State codes with zero zones. */
  uncovered: StateCode[];
  /** States claimed by 2+ zones for this brand. */
  overlaps: Array<{
    state_code: StateCode;
    zone_ids: string[];
  }>;
};

/**
 * Pure analysis over an array of freight zones for one brand.
 * Surfaces coverage gaps (states with no zone) and overlaps (states in
 * multiple zones) so the admin UI can highlight them visually.
 *
 * Defensive: dedups state_codes within a single zone so a zone that
 * accidentally contains ["FL", "FL"] doesn't create a false "overlap".
 */
export function analyzeFreightCoverage(zones: FreightZone[]): FreightCoverage {
  const zonesPerState = new Map<StateCode, Set<string>>();

  for (const zone of zones) {
    const states = validStateCodes(zone.state_codes);
    const seenInThisZone = new Set<StateCode>();
    for (const state of states) {
      if (seenInThisZone.has(state)) continue;
      seenInThisZone.add(state);

      const existing = zonesPerState.get(state);
      if (existing) {
        existing.add(zone.id);
      } else {
        zonesPerState.set(state, new Set([zone.id]));
      }
    }
  }

  const covered: StateCode[] = [];
  const uncovered: StateCode[] = [];
  const overlaps: FreightCoverage["overlaps"] = [];

  for (const code of US_STATE_CODES) {
    const zoneSet = zonesPerState.get(code);
    if (!zoneSet || zoneSet.size === 0) {
      uncovered.push(code);
    } else {
      covered.push(code);
      if (zoneSet.size > 1) {
        overlaps.push({ state_code: code, zone_ids: [...zoneSet] });
      }
    }
  }

  return { covered, uncovered, overlaps };
}

// ── Dollar / cents conversion (CP7) ──────────────────────────────────────────

/**
 * Parse a user-facing dollar string → integer cents.
 * Accepts: "$1,942.00", "1942", "1,942", "1942.5", ".50", "" (→ null).
 * Rejects: negative, non-numeric tails, more than two decimal places.
 * Returns null for empty/invalid input.
 */
export function parseDollarInput(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Strip $ and commas; keep digits + one period
  const cleaned = trimmed.replace(/[$,]/g, "");

  // Must be digits (optionally with one decimal point with up to 2 digits after)
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(cleaned)) return null;

  const [whole = "0", fraction = ""] = cleaned.split(".");
  const wholeCents = Number(whole) * 100;
  const fractionCents = Number((fraction + "00").slice(0, 2)); // right-pad then take 2
  return wholeCents + fractionCents;
}

/**
 * Format integer cents → display dollar string.
 * 194200 → "1,942.00"  ·  0 → "0.00"  ·  null/undefined → ""
 * Does NOT include the $ prefix — caller adds it when composing the UI.
 */
export function formatCentsAsDollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  const whole = Math.floor(Math.abs(cents) / 100);
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  const wholeStr = whole.toLocaleString("en-US");
  const sign = cents < 0 ? "-" : "";
  return `${sign}${wholeStr}.${fraction}`;
}

// ── Upload + extract pipeline (CP5) ──────────────────────────────────────────

export type UploadSheetInput = {
  brandId: string;
  brandCode: string;
  file: File;
  sheetType: "price_book" | "retail_programs" | "both";
  workspaceId: string;
  uploadedBy: string;
};

export type UploadSheetResult =
  | {
      ok: true;
      priceSheetId: string;
      itemsWritten: number;
      programsWritten: number;
      itemsApplied: number;
      programsApplied: number;
    }
  | {
      error: string;
      /** Present when insert succeeded but extract/publish failed — user can retry. */
      priceSheetId?: string;
      /** Which phase failed — surfaced in the drawer for a clearer retry CTA. */
      phase?: "extract" | "publish";
      /** When phase="publish", the extract counts the server returned so the
       *  retry path can preserve them through to the final success banner. */
      extractCounts?: { itemsWritten: number; programsWritten: number };
    };

const STORAGE_BUCKET = "price-sheets";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — Anthropic PDF limit

const ALLOWED_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "csv"]);

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

function fileTypeFromName(filename: string): "pdf" | "excel" | "csv" {
  const ext = fileExtension(filename);
  if (ext === "pdf") return "pdf";
  if (ext === "csv") return "csv";
  return "excel";
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function yearMonthUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// ── Edge function response shapes (shared by upload + retry paths) ──────────

type ExtractResponse = {
  priceSheetId: string;
  status: string;
  itemsWritten: number;
  programsWritten: number;
};

type PublishResponse = {
  priceSheetId: string;
  status: string;
  itemsApplied: number;
  itemsSkipped: number;
  programsApplied: number;
  programsSkipped: number;
};

/**
 * Invoke extract → publish for an already-inserted priceSheetId. Shared by
 * uploadAndExtractSheet (first attempt) and retryExtract (post-failure retry).
 *
 * On failure the priceSheetId + phase is returned so callers can surface
 * a targeted retry CTA without rebuilding the full pipeline.
 */
async function runExtractThenPublish(
  priceSheetId: string,
  extractWritten?: { itemsWritten: number; programsWritten: number },
): Promise<UploadSheetResult> {
  const extractCounts = extractWritten;

  // Extract pass — skipped when the caller already has extract data (retryPublish)
  let extractData: ExtractResponse | null = null;
  if (!extractCounts) {
    const res = await supabase.functions.invoke<ExtractResponse>(
      "extract-price-sheet",
      { body: { priceSheetId } },
    );
    if (res.error || !res.data) {
      return {
        error: `Extraction failed: ${res.error?.message ?? "no response"}`,
        priceSheetId,
        phase: "extract",
      };
    }
    extractData = res.data;
  }

  // Publish pass — always runs
  const pub = await supabase.functions.invoke<PublishResponse>(
    "publish-price-sheet",
    { body: { priceSheetId, auto_approve: true } },
  );
  if (pub.error || !pub.data) {
    const extracted =
      extractData
        ? { itemsWritten: extractData.itemsWritten, programsWritten: extractData.programsWritten }
        : extractCounts;
    return {
      error: `Publish failed: ${pub.error?.message ?? "no response"}`,
      priceSheetId,
      phase: "publish",
      extractCounts: extracted,
    };
  }

  const itemsWritten    = extractData?.itemsWritten    ?? extractCounts?.itemsWritten    ?? 0;
  const programsWritten = extractData?.programsWritten ?? extractCounts?.programsWritten ?? 0;

  return {
    ok: true,
    priceSheetId:    pub.data.priceSheetId,
    itemsWritten,
    programsWritten,
    itemsApplied:    pub.data.itemsApplied,
    programsApplied: pub.data.programsApplied,
  };
}

/**
 * Best-effort storage object cleanup. Used after a failed DB insert to avoid
 * orphaning uploaded files. Errors here are swallowed — the object will
 * eventually be reaped by a sweeper or bucket lifecycle policy, and the
 * caller-facing error message is driven by the original DB failure, not this.
 */
async function tryRemoveStorageObject(storagePath: string): Promise<void> {
  try {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[price-sheets-api] orphan cleanup failed for ${storagePath}`, e);
  }
}

/**
 * Full upload → DB insert → extract → auto-publish pipeline.
 *
 * Order of operations (each failure point leaves predictable state):
 *   1. Validate file size + extension client-side  → never leaves browser on fail
 *   2. supabase.storage.upload                      → no DB row yet
 *   3. INSERT qb_price_sheets (status=pending_review)
 *        — on failure, best-effort remove of the uploaded storage object
 *          so the bucket doesn't accumulate orphans over time (M1 fix)
 *   4. invoke extract-price-sheet                   → row stays; status moves to
 *                                                      extracted / rejected server-side
 *   5. invoke publish-price-sheet with auto_approve=true (CP6 — owner Q1=B,
 *      no review gate)                              → catalog live
 *
 * On step 4 or 5 failure we return the priceSheetId + phase so the caller can
 * offer a targeted retry via retryExtract() / retryPublish() without re-uploading.
 */
export async function uploadAndExtractSheet(
  input: UploadSheetInput,
): Promise<UploadSheetResult> {
  const { brandId, brandCode, file, sheetType, workspaceId, uploadedBy } = input;

  // 1. Client-side validation
  if (file.size > MAX_FILE_BYTES) {
    return { error: `File exceeds 25 MB (actual: ${(file.size / 1024 / 1024).toFixed(1)} MB)` };
  }
  const ext = fileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { error: `Unsupported file type: .${ext}. Use pdf, xlsx, xls, or csv.` };
  }

  // 2. Storage upload
  const brandDir = brandCode.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const period = yearMonthUtc(new Date());
  const storagePath = `${brandDir}/${period}/${Date.now()}-${sanitizeFileName(file.name)}`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: file.type || undefined,
    });

  if (uploadErr) {
    return { error: `Upload failed: ${uploadErr.message}` };
  }

  const fileUrl = `${STORAGE_BUCKET}/${storagePath}`;

  // 3. Insert qb_price_sheets row
  const { data: sheetRow, error: insertErr } = await supabase
    .from("qb_price_sheets")
    .insert({
      workspace_id: workspaceId,
      brand_id:     brandId,
      filename:     file.name,
      file_url:     fileUrl,
      file_type:    fileTypeFromName(file.name),
      sheet_type:   sheetType,
      status:       "pending_review",
      uploaded_by:  uploadedBy,
    })
    .select("id")
    .single();

  if (insertErr || !sheetRow) {
    // M1: prevent orphaned storage object on insert failure
    await tryRemoveStorageObject(storagePath);
    return { error: `Could not create sheet record: ${insertErr?.message ?? "unknown"}` };
  }

  const priceSheetId = sheetRow.id as string;

  // 4 + 5. Extract then publish
  return runExtractThenPublish(priceSheetId);
}

/**
 * Retry the extract → publish pipeline against an existing priceSheetId.
 * Used after a phase="extract" failure: the DB row was already inserted and
 * the storage object already uploaded, so re-running from extraction is both
 * correct and cheap.
 *
 * Note: the edge function enforces a status guard — the sheet must be in
 * 'pending_review' or 'extracted' status. If a prior attempt left it in
 * 'extracting' (mid-flight) or 'published', the edge function will reject.
 */
export async function retryExtract(
  priceSheetId: string,
): Promise<UploadSheetResult> {
  return runExtractThenPublish(priceSheetId);
}

/**
 * Retry only the publish pass against an already-extracted priceSheetId.
 * Used after a phase="publish" failure: extraction succeeded (items/programs
 * are in the staging tables), but applying to the catalog failed. Counts
 * passed in are the extraction counts the caller already saw, so the success
 * result still has itemsWritten / programsWritten populated for the UI.
 */
export async function retryPublish(
  priceSheetId: string,
  extractCounts: { itemsWritten: number; programsWritten: number },
): Promise<UploadSheetResult> {
  return runExtractThenPublish(priceSheetId, extractCounts);
}
