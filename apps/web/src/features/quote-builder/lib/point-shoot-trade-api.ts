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
  if (!token) throw new Error("Not authenticated");
  return `Bearer ${token}`;
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

  const res = await fetch(EQUIPMENT_VISION_URL, {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ image_base64: base64, mime_type: mime }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Equipment identification failed: ${msg || res.status}`);
  }
  const payload = await res.json() as {
    analysis?: {
      equipment?: { make?: string | null; model?: string | null; year?: string | null; category?: string | null };
      condition?: { overall?: string; hours_estimate?: string | null };
      identification_confidence?: string;
      description?: string;
      potential_issues?: string[];
    };
    image_url?: string | null;
  };
  const a = payload.analysis ?? {};
  const yearStr = a.equipment?.year ?? null;
  const yearNum = yearStr ? parseInt(yearStr.replace(/[^\d]/g, "").slice(0, 4), 10) : NaN;
  const overall = (a.condition?.overall ?? "unknown").toLowerCase();
  const confidence = (a.identification_confidence ?? "low").toLowerCase();

  return {
    make:  a.equipment?.make  ?? null,
    model: a.equipment?.model ?? null,
    year:  Number.isFinite(yearNum) && yearNum > 1900 ? yearNum : null,
    category: a.equipment?.category ?? null,
    conditionOverall: ["excellent", "good", "fair", "poor"].includes(overall)
      ? (overall as "excellent" | "good" | "fair" | "poor")
      : "unknown",
    conditionSummary: a.description ?? "",
    confidence: confidence === "high" ? "high" : confidence === "medium" ? "medium" : "low",
    hoursEstimate: parseHours(a.condition?.hours_estimate ?? null),
    potentialIssues: Array.isArray(a.potential_issues) ? a.potential_issues : [],
    photoUrl: payload.image_url ?? null,
  };
}

// ── Book value range ─────────────────────────────────────────────────────

export async function fetchBookValueRange(input: {
  make: string;
  model: string;
  year?: number | null;
  hours?: number | null;
}): Promise<BookValueRange> {
  const res = await fetch(BOOK_VALUE_RANGE_URL, {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Book-value lookup failed: ${msg || res.status}`);
  }
  const p = await res.json() as {
    make: string;
    model: string;
    year: number | null;
    hours: number | null;
    low_cents: number;
    mid_cents: number;
    high_cents: number;
    confidence: "high" | "medium" | "low";
    sources: BookValueSource[];
    is_synthetic: boolean;
  };
  return {
    make: p.make,
    model: p.model,
    year: p.year,
    hours: p.hours,
    lowCents:  p.low_cents,
    midCents:  p.mid_cents,
    highCents: p.high_cents,
    confidence: p.confidence,
    sources: p.sources ?? [],
    isSynthetic: Boolean(p.is_synthetic),
  };
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

export interface ApplyTradeResult {
  valuationId: string;
  preliminaryValueCents: number;
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

  const res = await fetch(TRADE_VALUATION_URL, {
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
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Create trade valuation failed: ${msg || res.status}`);
  }
  const payload = await res.json() as {
    valuation?: {
      id: string;
      preliminary_value: number | null;
    };
  };
  const v = payload.valuation;
  if (!v?.id) throw new Error("Trade valuation response missing id");

  // Patch the row with our multi-source comps + auction_value from our
  // computed midpoint. We write cents → dollars for compatibility with
  // the existing numeric columns.
  const auctionDollars = input.bookValue.midCents / 100;
  await supabase
    .from("trade_valuations")
    .update({
      auction_value: auctionDollars,
      market_comps: {
        low_cents:  input.bookValue.lowCents,
        mid_cents:  input.bookValue.midCents,
        high_cents: input.bookValue.highCents,
        confidence: input.bookValue.confidence,
        is_synthetic: input.bookValue.isSynthetic,
        sources: input.bookValue.sources,
      },
    })
    .eq("id", v.id);

  return {
    valuationId: v.id,
    preliminaryValueCents: Math.round((v.preliminary_value ?? auctionDollars * 0.92) * 100),
  };
}
