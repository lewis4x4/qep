import type {
  AdapterResult,
  AuctionDataResult,
  DataBadge,
  IronGuidesResult,
  MarketValuationRequest,
  MarketValuationResult,
  RouseResult,
  ValuationSourceBreakdown,
} from "./integration-types.ts";

export interface MarketValuationRow {
  id: string;
  stock_number: string | null;
  make: string;
  model: string;
  year: number;
  hours: number | null;
  condition: string | null;
  location: string | null;
  estimated_fmv: number | null;
  low_estimate: number | null;
  high_estimate: number | null;
  confidence_score: number | null;
  source: string;
  source_detail: Record<string, unknown> | null;
  expires_at: string;
  created_at: string;
}

export interface SourceTelemetry {
  source: string;
  badge: DataBadge;
  isMock: boolean;
  latencyMs: number;
  value: number;
  weight: number;
  confidence: number;
  lowEstimate?: number;
  highEstimate?: number;
}

export const CACHE_FRESH_MS = 4 * 60 * 60 * 1000;
const DEFAULT_TTL_HOURS = 48;

export function validateMarketValuationRequest(
  input: unknown,
): MarketValuationRequest | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const body = input as Record<string, unknown>;

  const make = typeof body.make === "string" ? body.make.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const condition = typeof body.condition === "string"
    ? body.condition.trim()
    : "";
  const stockNumber = typeof body.stock_number === "string"
    ? body.stock_number.trim()
    : undefined;
  const location = typeof body.location === "string"
    ? body.location.trim()
    : undefined;

  const year = typeof body.year === "number" ? body.year : Number.NaN;
  const hours = typeof body.hours === "number" ? body.hours : Number.NaN;

  const hasFullIdentity =
    Boolean(make && model && condition) &&
    Number.isInteger(year) &&
    year >= 1980 &&
    year <= 2100 &&
    Number.isFinite(hours) &&
    hours >= 0;

  if (stockNumber) {
    if (hasFullIdentity) {
      return {
        make,
        model,
        year,
        hours,
        condition,
        location,
        stock_number: stockNumber,
      };
    }
    return {
      make: "",
      model: "",
      year: 0,
      hours: 0,
      condition: "",
      location,
      stock_number: stockNumber,
    };
  }

  if (!make || !model || !condition) return null;
  if (!Number.isInteger(year) || year < 1980 || year > 2100) return null;
  if (!Number.isFinite(hours) || hours < 0) return null;

  return {
    make,
    model,
    year,
    hours,
    condition,
    location,
    stock_number: stockNumber,
  };
}

/** True when the request was validated as stock-number-led (no full equipment identity). */
export function isStockOnlyValuationRequest(
  request: MarketValuationRequest,
): boolean {
  return Boolean(
    request.stock_number &&
      request.make === "" &&
      request.model === "",
  );
}

function parseBadges(value: unknown): DataBadge[] {
  if (!Array.isArray(value)) return [];

  const output: DataBadge[] = [];
  for (const item of value) {
    if (
      item === "LIVE" ||
      item === "DEMO" ||
      item === "ESTIMATED" ||
      item === "STALE_CACHE" ||
      item === "LIMITED_MARKET_DATA" ||
      item === "AI_OFFLINE"
    ) {
      output.push(item);
    }
  }

  return [...new Set(output)];
}

function normalizeCondition(value: string): string {
  return value.trim().toLowerCase();
}

export function scoreCacheCandidate(
  row: MarketValuationRow,
  request: MarketValuationRequest,
): number {
  let score = 0;

  if (
    normalizeCondition(row.condition ?? "") ===
      normalizeCondition(request.condition)
  ) {
    score += 2;
  }

  if (request.stock_number && row.stock_number === request.stock_number) {
    score += 4;
  }

  const rowHours = row.hours ?? request.hours;
  const maxDelta = Math.max(500, request.hours * 0.2);
  const delta = Math.abs(rowHours - request.hours);
  if (delta <= maxDelta) {
    score += 3 * (1 - delta / maxDelta);
  }

  return score;
}

export function mapMarketValuationRowToResult(
  row: MarketValuationRow,
  includeBreakdown: boolean,
): MarketValuationResult {
  const detail = row.source_detail ?? {};
  const detailBreakdown = Array.isArray(detail.source_breakdown)
    ? detail.source_breakdown as ValuationSourceBreakdown[]
    : [];

  const detailBadges = parseBadges(
    (detail as Record<string, unknown>).data_badges,
  );
  const ageMs = Date.now() - Date.parse(row.created_at);
  const ageBadge: DataBadge = ageMs > CACHE_FRESH_MS ? "STALE_CACHE" : "LIVE";
  const fallbackBadges: DataBadge[] = row.source.includes("mock")
    ? ["DEMO"]
    : ["LIVE"];

  const badges = [...new Set([...detailBadges, ...fallbackBadges, ageBadge])];

  return {
    id: row.id,
    estimated_fmv: row.estimated_fmv === null ? null : Number(row.estimated_fmv),
    low_estimate: row.low_estimate === null ? null : Number(row.low_estimate),
    high_estimate: row.high_estimate === null ? null : Number(row.high_estimate),
    confidence_score: Number(row.confidence_score ?? 0),
    source: row.source,
    source_breakdown: includeBreakdown ? detailBreakdown : [],
    data_badges: badges,
    expires_at: row.expires_at,
    valuation_status: "ready",
  };
}

export function mergeSourceBreakdown(
  telemetry: SourceTelemetry[],
): ValuationSourceBreakdown[] {
  return telemetry.map((item) => ({
    source: item.source,
    value: Math.round(item.value),
    weight: Number(item.weight.toFixed(2)),
    confidence: Number(item.confidence.toFixed(2)),
  }));
}

export function computeValuationBadges(
  telemetry: SourceTelemetry[],
): DataBadge[] {
  const liveCount = telemetry.filter((item) => !item.isMock).length;
  const mockCount = telemetry.filter((item) => item.isMock).length;

  const badges: DataBadge[] = ["ESTIMATED"];
  if (liveCount > 0) badges.push("LIVE");
  if (mockCount > 0) badges.push("DEMO");
  if (telemetry.length < 2 || (liveCount > 0 && mockCount > 0)) {
    badges.push("LIMITED_MARKET_DATA");
  }

  return [...new Set(badges)];
}

export function deriveTtlHours(config: unknown): number {
  if (typeof config !== "object" || config === null) return DEFAULT_TTL_HOURS;

  const row = config as Record<string, unknown>;
  const value = row.market_valuation_ttl_hours;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TTL_HOURS;
  }

  return Math.min(168, Math.max(12, Math.round(value)));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function telemetryFromSettledResults(
  settled: [
    PromiseSettledResult<AdapterResult<IronGuidesResult>>,
    PromiseSettledResult<AdapterResult<AuctionDataResult>>,
    PromiseSettledResult<AdapterResult<RouseResult>>,
  ],
): SourceTelemetry[] {
  const telemetry: SourceTelemetry[] = [];

  const ironguidesResult = settled[0];
  if (ironguidesResult?.status === "fulfilled") {
    telemetry.push({
      source: "ironguides",
      badge: ironguidesResult.value.badge,
      isMock: ironguidesResult.value.isMock,
      latencyMs: ironguidesResult.value.latencyMs,
      value: ironguidesResult.value.data.fair_market_value,
      weight: 0.55,
      confidence: ironguidesResult.value.data.confidence,
      lowEstimate: ironguidesResult.value.data.low_estimate,
      highEstimate: ironguidesResult.value.data.high_estimate,
    });
  }

  const auctionResult = settled[1];
  if (auctionResult?.status === "fulfilled") {
    const prices = auctionResult.value.data.results.map((row) =>
      row.hammer_price
    );
    if (prices.length > 0) {
      telemetry.push({
        source: "auction_data",
        badge: auctionResult.value.badge,
        isMock: auctionResult.value.isMock,
        latencyMs: auctionResult.value.latencyMs,
        value: median(prices),
        weight: 0.3,
        confidence: Math.min(0.75, 0.35 + prices.length * 0.08),
      });
    }
  }

  const rouseResult = settled[2];
  if (rouseResult?.status === "fulfilled") {
    telemetry.push({
      source: "rouse",
      badge: rouseResult.value.badge,
      isMock: rouseResult.value.isMock,
      latencyMs: rouseResult.value.latencyMs,
      value: rouseResult.value.data.monthly_rate * 10,
      weight: 0.15,
      confidence: 0.4,
    });
  }

  return telemetry;
}
