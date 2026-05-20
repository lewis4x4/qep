import type { BookValueRange } from "@/features/quote-builder/lib/point-shoot-trade-api";

export interface TradeRangeSummary {
  low: number;
  high: number;
  midpoint: number;
  sources: string[];
  confidence: "high" | "medium" | "low" | null;
  isSynthetic: boolean;
}

export type TradeCreditBasis = "final" | "preliminary" | "comps_midpoint" | "none";

export interface TradeMarketContextSource {
  name: string;
  value: number | null;
  low: number | null;
  high: number | null;
  confidence: "high" | "medium" | "low" | null;
  kind: string | null;
  sampleSize: number | null;
  asOf: string | null;
  detail: string | null;
  isAggregate: boolean;
}

export interface TradeMarketContext {
  equipmentLabel: string;
  range: TradeRangeSummary | null;
  creditBasis: {
    basis: TradeCreditBasis;
    line: string;
  };
  appliedValue: number | null;
  sources: TradeMarketContextSource[];
  confidence: "high" | "medium" | "low" | null;
  isSynthetic: boolean;
  noRangeReason: string | null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function confidenceValue(value: unknown): TradeRangeSummary["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function sourceName(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isFiniteMoney(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeMarketSource(comp: Record<string, unknown>): TradeMarketContextSource | null {
  const name = sourceName(comp.source ?? comp.name);
  if (!name) return null;
  return {
    name,
    value: numberValue(comp.price ?? comp.value),
    low: numberValue(comp.low),
    high: numberValue(comp.high),
    confidence: confidenceValue(comp.confidence),
    kind: stringValue(comp.kind),
    sampleSize: numberValue(comp.sample_size ?? comp.sampleSize),
    asOf: stringValue(comp.as_of ?? comp.asOf),
    detail: stringValue(comp.detail),
    isAggregate: name === "_aggregate" || comp.kind === "aggregate",
  };
}

export function inferTradeRangeSummary(valuation: {
  marketComps?: Array<Record<string, unknown>> | null;
  auctionValue?: number | null;
  preliminaryValue?: number | null;
  finalValue?: number | null;
}): TradeRangeSummary | null {
  const comps = valuation.marketComps ?? [];
  const aggregate = comps.find((comp) => comp.source === "_aggregate");
  if (aggregate) {
    const low = numberValue(aggregate.low);
    const high = numberValue(aggregate.high);
    const midpoint = numberValue(aggregate.price ?? aggregate.value);
    if (low != null && high != null && midpoint != null) {
      return {
        low,
        high,
        midpoint: valuation.finalValue ?? valuation.preliminaryValue ?? midpoint,
        sources: comps
          .filter((comp) => comp.source !== "_aggregate")
          .flatMap((comp) => {
            const source = sourceName(comp.source);
            return source ? [source] : [];
          }),
        confidence: confidenceValue(aggregate.confidence),
        isSynthetic: aggregate.is_synthetic === true,
      };
    }
  }

  const points: number[] = [];
  const sources = new Set<string>();
  for (const comp of comps) {
    if (comp.source === "_aggregate") continue;
    const low = numberValue(comp.low);
    const high = numberValue(comp.high);
    const value = numberValue(comp.price ?? comp.value);
    if (low != null && high != null) {
      points.push(low, high);
    } else if (value != null) {
      points.push(value);
    }
    const source = sourceName(comp.source);
    if (source) sources.add(source);
  }
  if (valuation.auctionValue != null && valuation.auctionValue > 0) {
    points.push(valuation.auctionValue);
    sources.add("auction midpoint");
  }
  if (points.length === 0) return null;

  const low = Math.min(...points);
  const high = Math.max(...points);
  return {
    low,
    high,
    midpoint: valuation.finalValue ?? valuation.preliminaryValue ?? (low + high) / 2,
    sources: [...sources],
    confidence: null,
    isSynthetic: false,
  };
}

/**
 * One-line audit for operators: clarifies whether credit follows final desk, preliminary, or comp-only math.
 */
export function describeTradeCreditBasis(params: {
  finalValue: number | null;
  preliminaryValue: number | null;
  inferredRange: TradeRangeSummary | null;
}): { basis: TradeCreditBasis; line: string } {
  const { finalValue, preliminaryValue, inferredRange } = params;

  if (isFiniteMoney(finalValue)) {
    return {
      basis: "final",
      line: "Trade credit follows the final appraisal value (overrides comp range).",
    };
  }
  if (isFiniteMoney(preliminaryValue)) {
    return {
      basis: "preliminary",
      line: "Trade credit follows the preliminary desk value.",
    };
  }
  if (inferredRange) {
    return {
      basis: "comps_midpoint",
      line: "Trade credit follows the comp-range midpoint until a desk value is on file.",
    };
  }

  return { basis: "none", line: "" };
}

export function buildTradeMarketCompsFromBookValueRange(range: BookValueRange): Array<Record<string, unknown>> {
  return [
    ...range.sources.map((s) => ({
      source: s.name,
      price: Math.round(s.value_cents / 100),
      low: s.low_cents != null ? Math.round(s.low_cents / 100) : null,
      high: s.high_cents != null ? Math.round(s.high_cents / 100) : null,
      confidence: s.confidence,
      kind: s.kind,
      sample_size: s.sample_size ?? null,
      as_of: s.as_of ?? null,
      detail: s.detail ?? null,
    })),
    {
      source: "_aggregate",
      price: Math.round(range.midCents / 100),
      low: Math.round(range.lowCents / 100),
      high: Math.round(range.highCents / 100),
      confidence: range.confidence,
      kind: "aggregate",
      is_synthetic: range.isSynthetic,
    },
  ];
}

/** Map book-value-range sources into the same comp inference used for desk valuations. */
export function tradeRangeSummaryFromBookValueRange(range: BookValueRange): TradeRangeSummary | null {
  if (range.sources.length === 0) return null;
  return inferTradeRangeSummary({
    marketComps: buildTradeMarketCompsFromBookValueRange(range),
    auctionValue: null,
    preliminaryValue: null,
    finalValue: null,
  });
}

/**
 * Rep-facing line for Point-Shoot-Trade before apply: credit will use comp midpoint until desk values exist.
 */
export function describePointShootApplyCreditLine(range: BookValueRange): string {
  const inferred = tradeRangeSummaryFromBookValueRange(range);
  const { basis, line } = describeTradeCreditBasis({
    finalValue: null,
    preliminaryValue: null,
    inferredRange: inferred,
  });
  if (basis !== "none" && line) return line;
  if (Number.isFinite(range.midCents)) {
    return "Apply uses the displayed book-value midpoint until a desk value is on file.";
  }
  return "";
}

export function buildTradeMarketContext(input: {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  hours?: number | null;
  marketComps?: Array<Record<string, unknown>> | null;
  auctionValue?: number | null;
  preliminaryValue?: number | null;
  finalValue?: number | null;
}): TradeMarketContext | null {
  const marketComps = input.marketComps ?? [];
  const range = inferTradeRangeSummary({
    marketComps,
    auctionValue: input.auctionValue ?? null,
    preliminaryValue: input.preliminaryValue ?? null,
    finalValue: input.finalValue ?? null,
  });
  const creditBasis = describeTradeCreditBasis({
    finalValue: input.finalValue ?? null,
    preliminaryValue: input.preliminaryValue ?? null,
    inferredRange: range,
  });
  const appliedValue = input.finalValue ?? input.preliminaryValue ?? range?.midpoint ?? null;
  const sources = marketComps.flatMap((comp) => {
    const source = normalizeMarketSource(comp);
    return source ? [source] : [];
  });
  const equipmentLabel = [
    input.year ? String(input.year) : null,
    stringValue(input.make),
    stringValue(input.model),
  ].filter(Boolean).join(" ") || "Trade-in machine";

  if (!range && appliedValue == null && sources.length === 0 && equipmentLabel === "Trade-in machine") {
    return null;
  }

  return {
    equipmentLabel,
    range,
    creditBasis,
    appliedValue,
    sources,
    confidence: range?.confidence ?? sources.find((source) => source.confidence)?.confidence ?? null,
    isSynthetic: range?.isSynthetic === true || sources.some((source) => source.kind?.startsWith("synthetic_")),
    noRangeReason: range ? null : "Comparable range is not on file for this valuation yet.",
  };
}
