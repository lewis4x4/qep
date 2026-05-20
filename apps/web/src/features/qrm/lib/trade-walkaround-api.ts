import { supabase } from "@/lib/supabase";
import { buildTradeMarketCompsFromBookValueRange } from "./trade-market-context";
import { normalizeTradePhotos, type TradeWalkaroundPhoto } from "./trade-walkaround";
import type { BookValueRange, BookValueSourceKind } from "@/features/quote-builder/lib/point-shoot-trade-api";

const TRADE_VALUATION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trade-valuation`;
const BOOK_VALUE_RANGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trade-book-value-range`;
const PHOTO_BUCKET = "equipment-photos";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export interface TradeValuationRecord {
  id: string;
  deal_id: string | null;
  make: string;
  model: string;
  year: number | null;
  serial_number: string | null;
  hours: number | null;
  photos: TradeWalkaroundPhoto[];
  video_url: string | null;
  operational_status: string | null;
  last_full_service: string | null;
  needed_repairs: string | null;
  attachments_included: string[] | null;
  ai_condition_score: number | null;
  ai_condition_notes: string | null;
  ai_detected_damage: string[] | null;
  market_comps: Array<Record<string, unknown>> | null;
  auction_value: number | null;
  preliminary_value: number | null;
  final_value: number | null;
  conditional_language: string | null;
  created_at: string;
}

export interface TradeValuationResponse {
  valuation: TradeValuationRecord;
  ai_assessment: {
    score: number;
    notes: string;
    detected_damage: string[];
  };
  pipeline_duration_ms: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Trade valuation response is missing '${field}'.`);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return normalized === "high" ? "high" : normalized === "medium" ? "medium" : "low";
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

function stringArrayOrNull(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : null;
}

function recordArrayOrNull(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is Record<string, unknown> => isRecord(item));
}

function mapTradeValuation(row: unknown): TradeValuationRecord {
  if (!isRecord(row)) {
    throw new Error("Trade valuation response was malformed.");
  }

  return {
    id: requiredString(row.id, "id"),
    deal_id: nullableString(row.deal_id),
    make: requiredString(row.make, "make"),
    model: requiredString(row.model, "model"),
    year: nullableNumber(row.year),
    serial_number: nullableString(row.serial_number),
    hours: nullableNumber(row.hours),
    photos: normalizeTradePhotos(row.photos),
    video_url: nullableString(row.video_url),
    operational_status: nullableString(row.operational_status),
    last_full_service: nullableString(row.last_full_service),
    needed_repairs: nullableString(row.needed_repairs),
    attachments_included: stringArrayOrNull(row.attachments_included),
    ai_condition_score: nullableNumber(row.ai_condition_score),
    ai_condition_notes: nullableString(row.ai_condition_notes),
    ai_detected_damage: stringArrayOrNull(row.ai_detected_damage),
    market_comps: recordArrayOrNull(row.market_comps),
    auction_value: nullableNumber(row.auction_value),
    preliminary_value: nullableNumber(row.preliminary_value),
    final_value: nullableNumber(row.final_value),
    conditional_language: nullableString(row.conditional_language),
    created_at: requiredString(row.created_at, "created_at"),
  };
}

function mapAiAssessment(value: unknown): TradeValuationResponse["ai_assessment"] {
  if (!isRecord(value)) {
    return { score: 0, notes: "", detected_damage: [] };
  }
  return {
    score: nullableNumber(value.score) ?? 0,
    notes: nullableString(value.notes) ?? "",
    detected_damage: stringArrayOrNull(value.detected_damage) ?? [],
  };
}

function normalizeBookValueRangePayload(payload: unknown): BookValueRange {
  const record = isRecord(payload) ? payload : {};
  const sources = Array.isArray(record.sources)
    ? record.sources.flatMap((row) => {
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
    })
    : [];

  return {
    make: firstString(record.make) ?? "",
    model: firstString(record.model) ?? "",
    year: numberOrNull(record.year),
    hours: numberOrNull(record.hours),
    lowCents: numberOrNull(record.low_cents) ?? 0,
    midCents: numberOrNull(record.mid_cents) ?? 0,
    highCents: numberOrNull(record.high_cents) ?? 0,
    confidence: normalizeConfidence(record.confidence),
    sources,
    isSynthetic: record.is_synthetic === true,
  };
}

async function bestEffortEnrichTradeMarketContext(result: TradeValuationResponse): Promise<TradeValuationResponse> {
  const { valuation } = result;
  if (!valuation.make || !valuation.model) return result;
  try {
    const response = await fetch(BOOK_VALUE_RANGE_URL, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        make: valuation.make,
        model: valuation.model,
        year: valuation.year ?? undefined,
        hours: valuation.hours ?? undefined,
      }),
    });
    if (!response.ok) return result;
    const range = normalizeBookValueRangePayload(await response.json().catch(() => ({})));
    if (range.midCents <= 0 && range.sources.length === 0) return result;

    const { data, error } = await supabase
      .from("trade_valuations")
      .update({
        auction_value: range.midCents / 100,
        market_comps: buildTradeMarketCompsFromBookValueRange(range),
      })
      .eq("id", valuation.id)
      .select("*")
      .maybeSingle();
    if (error || !data) return result;
    return { ...result, valuation: mapTradeValuation(data) };
  } catch {
    return result;
  }
}

export function normalizeTradeValuationResponse(payload: unknown): TradeValuationResponse {
  if (!isRecord(payload)) {
    throw new Error("Trade valuation response was malformed.");
  }
  return {
    valuation: mapTradeValuation(payload.valuation),
    ai_assessment: mapAiAssessment(payload.ai_assessment),
    pipeline_duration_ms: nullableNumber(payload.pipeline_duration_ms) ?? 0,
  };
}

export async function getTradeValuation(dealId: string): Promise<TradeValuationRecord | null> {
  const { data, error } = await supabase
    .from("trade_valuations")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapTradeValuation(data);
}

export async function uploadTradeWalkaroundPhoto(input: {
  dealId: string;
  type: string;
  file: File;
}): Promise<TradeWalkaroundPhoto> {
  const ext = input.file.name.split(".").pop() ?? "jpg";
  const path = `trade-walkaround/${input.dealId}/${input.type}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, input.file, {
    upsert: false,
    contentType: input.file.type || undefined,
  });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return { type: input.type, url: data.publicUrl };
}

export async function createTradeValuation(input: {
  deal_id: string;
  make: string;
  model: string;
  year?: number;
  serial_number?: string;
  hours?: number;
  photos: TradeWalkaroundPhoto[];
  operational_status?: string;
  last_full_service?: string;
  needed_repairs?: string;
  attachments_included?: string[];
}): Promise<TradeValuationResponse> {
  const response = await fetch(TRADE_VALUATION_URL, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : "Failed to create trade valuation.";
    throw new Error(message);
  }
  if (!isRecord(payload)) {
    throw new Error("Trade valuation response was malformed.");
  }
  return bestEffortEnrichTradeMarketContext(normalizeTradeValuationResponse(payload));
}
