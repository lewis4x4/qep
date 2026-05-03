/**
 * Point-Shoot-Trade API (Slice 20b).
 *
 * Thin orchestration over three edge functions:
 *
 *   1. equipment-vision          — photo → {make, model, year, condition}
 *   2. trade-book-value-range    — make/model/year/hours → multi-source range
 *   3. trade-valuation           — writes the trade_valuations row and
 *                                  computes the preliminary_value used by
 *                                  the Quote Builder save flow.
 *
 * Kept out of trade-walkaround-api.ts so the existing QRM walkaround page
 * stays stable; this is a separate, leaner, Quote-Builder-inline path.
 */

import { supabase } from "@/lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const EQUIPMENT_VISION_URL      = `${SUPABASE_URL}/functions/v1/equipment-vision`;
const BOOK_VALUE_RANGE_URL      = `${SUPABASE_URL}/functions/v1/trade-book-value-range`;
const TRADE_VALUATION_URL       = `${SUPABASE_URL}/functions/v1/trade-valuation`;

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new TradeApiError("auth", 401, "Not signed in", "Your session expired. Sign in again to continue.");
  return `Bearer ${token}`;
}

/**
 * Typed error class so the UI can distinguish auth failures, server outages,
 * and validation issues without string-matching. The UI shows a rep-friendly
 * message; the raw detail is kept for Sentry / console.
 */
export type TradeApiErrorKind =
  | "auth"        // 401/403 — gateway JWT reject, role denied, expired session
  | "service"    // 5xx — function or upstream API broke
  | "validation"  // 400 — payload bad (rare given we control the payload)
  | "network";    // fetch threw (offline, DNS, etc.)

export class TradeApiError extends Error {
  constructor(
    public readonly kind: TradeApiErrorKind,
    public readonly status: number,
    public readonly detail: string,
    public readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "TradeApiError";
  }
}

function classify(status: number, detail: string): TradeApiErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "service";
  if (status === 0) return "network";
  return "validation";
}

function userMessageFor(kind: TradeApiErrorKind, step: string): string {
  switch (kind) {
    case "auth":
      return "Your session needs a refresh — sign out and back in, then try again. You can also enter the trade manually below.";
    case "service":
      return `The ${step} service is temporarily unavailable. Try again in a moment, or enter the trade manually below.`;
    case "network":
      return "No connection — check your signal and try again. Your photo is preserved.";
    case "validation":
      return `The ${step} request was rejected. Try a different angle of the equipment, or enter manually.`;
  }
}

async function parseError(res: Response, step: string): Promise<TradeApiError> {
  const detail = await res.text().catch(() => "");
  const kind = classify(res.status, detail);
  return new TradeApiError(kind, res.status, detail || `HTTP ${res.status}`, userMessageFor(kind, step));
}

async function fetchWithClassify(url: string, init: RequestInit, step: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new TradeApiError("network", 0, detail, userMessageFor("network", step));
  }
  if (!res.ok) throw await parseError(res, step);
  return res;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface PointShootIdentification {
  make: string | null;
  model: string | null;
  year: number | null;
  category: string | null;
  conditionOverall: "excellent" | "good" | "fair" | "poor" | "unknown";
  conditionSummary: string;
  confidence: "high" | "medium" | "low";
  hoursEstimate: number | null;
  potentialIssues: string[];
  photoUrl: string | null;
}

export type BookValueSourceKind =
  | "market_valuation"
  | "auction_comps"
  | "competitor_listings"
  | "synthetic_iron_planet"
  | "synthetic_ritchie_bros"
  | "synthetic_internal_history";

export interface BookValueSource {
  kind: BookValueSourceKind;
  name: string;
  value_cents: number;
  low_cents: number | null;
  high_cents: number | null;
  confidence: "high" | "medium" | "low";
  sample_size: number | null;
  as_of: string | null;
  detail: string | null;
}

export interface BookValueRange {
  make: string;
  model: string;
  year: number | null;
  hours: number | null;
  lowCents: number;
  midCents: number;
  highCents: number;
  confidence: "high" | "medium" | "low";
  sources: BookValueSource[];
  isSynthetic: boolean;
}

export interface ApplyTradeResult {
  valuationId: string;
  preliminaryValueCents: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return normalized === "high" ? "high" : normalized === "medium" ? "medium" : "low";
}

function normalizeConditionOverall(value: unknown): PointShootIdentification["conditionOverall"] {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return normalized === "excellent" || normalized === "good" || normalized === "fair" || normalized === "poor"
    ? normalized
    : "unknown";
}

function normalizeBookValueSourceKind(value: unknown): BookValueSourceKind {
  return value === "market_valuation"
    || value === "auction_comps"
    || value === "competitor_listings"
    || value === "synthetic_iron_planet"
    || value === "synthetic_ritchie_bros"
    || value === "synthetic_internal_history"
    ? value
    : "market_valuation";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = firstString(item);
    return text ? [text] : [];
  });
}

function parseYear(value: unknown): number | null {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const yearNum = raw ? parseInt(raw.replace(/[^\d]/g, "").slice(0, 4), 10) : NaN;
  return Number.isFinite(yearNum) && yearNum > 1900 ? yearNum : null;
}

export function normalizePointShootIdentificationPayload(payload: unknown): PointShootIdentification {
  const record = isRecord(payload) ? payload : {};
  const analysis = isRecord(record.analysis) ? record.analysis : {};
  const equipment = isRecord(analysis.equipment) ? analysis.equipment : {};
  const condition = isRecord(analysis.condition) ? analysis.condition : {};

  return {
    make: firstString(equipment.make),
    model: firstString(equipment.model),
    year: parseYear(equipment.year),
    category: firstString(equipment.category),
    conditionOverall: normalizeConditionOverall(condition.overall),
    conditionSummary: firstString(analysis.description) ?? "",
    confidence: normalizeConfidence(analysis.identification_confidence),
    hoursEstimate: parseHours(nullableString(condition.hours_estimate)),
    potentialIssues: normalizeStringArray(analysis.potential_issues),
    photoUrl: nullableString(record.image_url),
  };
}

export function normalizeBookValueSources(value: unknown): BookValueSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const name = firstString(row.name);
    const valueCents = numberOrNull(row.value_cents);
    if (!name || valueCents == null) return [];
    return [{
      kind: normalizeBookValueSourceKind(row.kind),
      name,
      value_cents: valueCents,
      low_cents: numberOrNull(row.low_cents),
      high_cents: numberOrNull(row.high_cents),
      confidence: normalizeConfidence(row.confidence),
      sample_size: numberOrNull(row.sample_size),
      as_of: nullableString(row.as_of),
      detail: nullableString(row.detail),
    }];
  });
}

export function normalizeBookValueRangePayload(payload: unknown): BookValueRange {
  const record = isRecord(payload) ? payload : {};
  return {
    make: firstString(record.make) ?? "",
    model: firstString(record.model) ?? "",
    year: numberOrNull(record.year),
    hours: numberOrNull(record.hours),
    lowCents: numberOrNull(record.low_cents) ?? 0,
    midCents: numberOrNull(record.mid_cents) ?? 0,
    highCents: numberOrNull(record.high_cents) ?? 0,
    confidence: normalizeConfidence(record.confidence),
    sources: normalizeBookValueSources(record.sources),
    isSynthetic: record.is_synthetic === true,
  };
}

export function normalizeApplyTradeResultPayload(
  payload: unknown,
  fallbackPreliminaryValueCents: number,
): ApplyTradeResult {
  const record = isRecord(payload) ? payload : {};
  const valuation = isRecord(record.valuation) ? record.valuation : {};
  const id = firstString(valuation.id);
  if (!id) throw new Error("Trade valuation response missing id");
  const preliminaryValue = numberOrNull(valuation.preliminary_value);
  return {
    valuationId: id,
    preliminaryValueCents: Math.round(
      preliminaryValue == null ? fallbackPreliminaryValueCents : preliminaryValue * 100,
    ),
  };
}

// ── Photo → identification ───────────────────────────────────────────────

/**
 * Convert a File to a base64 string suitable for the equipment-vision
 * JSON path. We use JSON (not multipart) because the edge function
 * persists the photo to storage on its own, so we don't need a second
 * upload round-trip.
 */
async function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked btoa to avoid call-stack overflow on large images.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { base64: btoa(binary), mime: file.type || "image/jpeg" };
}

/** Parse "2,400" or "~2400 hrs" into a number if possible. */
function parseHours(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = String(raw).match(/[\d,]+/);
  if (!match) return null;
  const n = parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function identifyEquipmentFromPhoto(file: File): Promise<PointShootIdentification> {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Photo exceeds 20MB limit. Please use a smaller image.");
  }
  const { base64, mime } = await fileToBase64(file);

  const res = await fetchWithClassify(EQUIPMENT_VISION_URL, {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ image_base64: base64, mime_type: mime }),
  }, "equipment identification");
  return normalizePointShootIdentificationPayload(await res.json().catch(() => ({})));
}

// ── Book value range ─────────────────────────────────────────────────────

export async function fetchBookValueRange(input: {
  make: string;
  model: string;
  year?: number | null;
  hours?: number | null;
}): Promise<BookValueRange> {
  const res = await fetchWithClassify(BOOK_VALUE_RANGE_URL, {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  }, "book-value lookup");
  return normalizeBookValueRangePayload(await res.json().catch(() => ({})));
}

// ── Apply: create the trade_valuations row ───────────────────────────────

export interface ApplyTradeInput {
  dealId?: string | null;
  make: string;
  model: string;
  year?: number | null;
  hours?: number | null;
  photoUrl: string | null;
  conditionOverall: PointShootIdentification["conditionOverall"];
  bookValue: BookValueRange;
  allowanceDollars: number; // what the rep is offering (derived from midCents by default)
}

export async function applyPointShootTrade(input: ApplyTradeInput): Promise<ApplyTradeResult> {
  // Map the Point-Shoot range onto the existing trade-valuation contract.
  // We set auction_value = mid-of-range; the DB trigger handles the 8%
  // discount + preliminary value. We persist the full source breakdown in
  // market_comps so the Deal Coach / manager approval UI can explain the
  // number later.
  const operationalStatus = input.conditionOverall === "poor"
    ? "non_operational"
    : input.conditionOverall === "fair"
      ? "operational"
      : "daily_use";

  const res = await fetchWithClassify(TRADE_VALUATION_URL, {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deal_id: input.dealId ?? undefined,
      make: input.make,
      model: input.model,
      year: input.year ?? undefined,
      hours: input.hours ?? undefined,
      photos: input.photoUrl
        ? [{ type: "point_shoot", url: input.photoUrl }]
        : [],
      operational_status: operationalStatus,
    }),
  }, "trade apply");
  // Patch the row with our multi-source comps + auction_value from our
  // computed midpoint. We write cents → dollars for compatibility with
  // the existing numeric columns.
  //
  // market_comps is typed `jsonb default '[]'` in migration 074 and the
  // SOP (roadmap) contract says it's an array of `{source, price, url?}`
  // comps. We write a superset — each element is the canonical comp
  // shape plus our richer range / confidence fields — so downstream
  // readers that only know the SOP shape still work, while the Deal
  // Coach / manager approval UI can consume the extra fields when
  // upgraded. Aggregate bounds + meta go in a sidecar last-element.
  const auctionDollars = input.bookValue.midCents / 100;
  const applyResult = normalizeApplyTradeResultPayload(
    await res.json().catch(() => ({})),
    Math.round(auctionDollars * 0.92 * 100),
  );
  const compsArray = [
    ...input.bookValue.sources.map((s) => ({
      source: s.name,
      price: Math.round(s.value_cents / 100),
      low:   s.low_cents  != null ? Math.round(s.low_cents  / 100) : null,
      high:  s.high_cents != null ? Math.round(s.high_cents / 100) : null,
      confidence: s.confidence,
      kind: s.kind,
      sample_size: s.sample_size ?? null,
      as_of: s.as_of ?? null,
      detail: s.detail ?? null,
    })),
    {
      source: "_aggregate",
      price: Math.round(input.bookValue.midCents / 100),
      low:   Math.round(input.bookValue.lowCents / 100),
      high:  Math.round(input.bookValue.highCents / 100),
      confidence: input.bookValue.confidence,
      kind: "aggregate",
      is_synthetic: input.bookValue.isSynthetic,
    },
  ];
  await supabase
    .from("trade_valuations")
    .update({
      auction_value: auctionDollars,
      market_comps: compsArray,
    })
    .eq("id", applyResult.valuationId);

  return applyResult;
}
