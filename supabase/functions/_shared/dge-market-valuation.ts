import type {
  DataBadge,
  MarketValuationRequest,
  MarketValuationResult,
  ValuationSourceBreakdown,
} from "./integration-types.ts";

const CACHE_STALE_HOURS = Number.parseInt(
  Deno.env.get("MARKET_VALUATION_STALE_CACHE_HOURS") ?? "24",
  10,
);

const rateWindowByUser = new Map<string, { startedAt: number; count: number }>();

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;

export interface ParsedValuationRequest extends MarketValuationRequest {
  condition: string;
}

export interface CachedMarketValuation {
  id: string;
  estimated_fmv: number | null;
  low_estimate: number | null;
  high_estimate: number | null;
  confidence_score: number | null;
  source_detail: Record<string, unknown> | null;
  expires_at: string;
  created_at: string;
}

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function parseValuationRequest(payload: unknown): ParsedValuationRequest | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const body = payload as Record<string, unknown>;
  const make = typeof body.make === "string" ? body.make.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const condition = typeof body.condition === "string" ? body.condition.trim().toLowerCase() : "";
  const year = typeof body.year === "number" ? body.year : Number(body.year);
  const hours = typeof body.hours === "number" ? body.hours : Number(body.hours);

  if (!make || !model || !condition || !Number.isFinite(year) || !Number.isFinite(hours)) {
    return null;
  }
  if (year < 1950 || year > new Date().getFullYear() + 1 || hours < 0) {
    return null;
  }

  return {
    make,
    model,
    condition,
    year,
    hours,
    location: typeof body.location === "string" ? body.location.trim() : undefined,
    stock_number: typeof body.stock_number === "string" ? body.stock_number.trim() : undefined,
  };
}

export function checkValuationRateLimit(userId: string): boolean {
  const now = Date.now();
  const existing = rateWindowByUser.get(userId);

  if (!existing || now - existing.startedAt > RATE_LIMIT_WINDOW_MS) {
    rateWindowByUser.set(userId, { startedAt: now, count: 1 });
    return false;
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  existing.count += 1;
  return false;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }
  return sorted[midpoint];
}

export function computeCacheBadges(row: CachedMarketValuation): DataBadge[] {
  const badges = new Set<DataBadge>();
  const sourceDetail = asObject(row.source_detail);
  const detailBadges = sourceDetail.data_badges;

  if (Array.isArray(detailBadges)) {
    for (const badge of detailBadges) {
      if (typeof badge === "string") {
        badges.add(badge as DataBadge);
      }
    }
  }

  const ageMs = Date.now() - Date.parse(row.created_at);
  if (ageMs > CACHE_STALE_HOURS * 60 * 60 * 1000) {
    badges.add("STALE_CACHE");
  }

  if (badges.size === 0) {
    badges.add("LIVE");
  }

  return [...badges];
}

export function toMarketValuationResponse(
  id: string,
  estimatedFmv: number,
  lowEstimate: number,
  highEstimate: number,
  confidenceScore: number,
  sourceBreakdown: ValuationSourceBreakdown[],
  dataBadges: DataBadge[],
  expiresAt: string,
): MarketValuationResult {
  return {
    id,
    estimated_fmv: Math.round(estimatedFmv),
    low_estimate: Math.round(lowEstimate),
    high_estimate: Math.round(highEstimate),
    confidence_score: Math.round(clamp(confidenceScore, 0, 1) * 100) / 100,
    source: "composite_market_valuation",
    source_breakdown: sourceBreakdown,
    data_badges: dataBadges,
    expires_at: expiresAt,
  };
}
