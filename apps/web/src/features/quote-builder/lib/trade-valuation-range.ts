import type { BookValueRange, TradeValuationProposalSnapshot } from "./point-shoot-trade-api";

export interface TradeRangeSummary {
  low: number;
  high: number;
  midpoint: number;
  sources: string[];
  confidence: "high" | "medium" | "low" | null;
  isSynthetic: boolean;
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

export function inferTradeRangeSummary(
  valuation: Pick<
    TradeValuationProposalSnapshot,
    "marketComps" | "auctionValue" | "preliminaryValue"
  > & { finalValue?: number | null },
): TradeRangeSummary | null {
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

/** Which dollar path the quote builder uses for trade credit (rep-facing; mirrors apply order). */
export type TradeCreditBasis = "final" | "preliminary" | "comps_midpoint" | "none";

function isFiniteMoney(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

/** Map book-value-range sources into the same comp inference used for desk valuations. */
export function tradeRangeSummaryFromBookValueRange(range: BookValueRange): TradeRangeSummary | null {
  const marketComps = range.sources.map((s) => {
    const row: Record<string, unknown> = { source: s.name };
    if (s.low_cents != null && s.high_cents != null) {
      row.low = s.low_cents / 100;
      row.high = s.high_cents / 100;
    }
    if (Number.isFinite(s.value_cents)) {
      row.price = s.value_cents / 100;
    }
    return row;
  });
  return inferTradeRangeSummary({
    marketComps,
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
