import type { TradeValuationProposalSnapshot } from "./point-shoot-trade-api";

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
