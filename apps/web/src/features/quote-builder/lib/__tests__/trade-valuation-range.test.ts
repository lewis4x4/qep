import { describe, expect, test } from "bun:test";
import type { BookValueRange } from "../point-shoot-trade-api";
import {
  buildTradeMarketCompsFromBookValueRange,
  buildTradeMarketContext,
  describePointShootApplyCreditLine,
  describeTradeCreditBasis,
  inferTradeRangeSummary,
  tradeRangeSummaryFromBookValueRange,
} from "../trade-valuation-range";

describe("inferTradeRangeSummary", () => {
  test("uses point-shoot aggregate values as dollars without cent conversion", () => {
    const range = inferTradeRangeSummary({
      marketComps: [
        { source: "IronPlanet", price: 43_000, low: 40_000, high: 46_000 },
        { source: "_aggregate", price: 45_000, low: 38_000, high: 52_000, confidence: "medium", is_synthetic: true },
      ],
      auctionValue: 45_000,
      preliminaryValue: 40_200,
    });

    expect(range).toEqual({
      low: 38_000,
      high: 52_000,
      midpoint: 40_200,
      sources: ["IronPlanet"],
      confidence: "medium",
      isSynthetic: true,
    });
  });

  test("falls back to visible comp bounds when aggregate is absent", () => {
    const range = inferTradeRangeSummary({
      marketComps: [
        { source: "Auction comp", low: 41_000, high: 49_000 },
        { source: "Dealer listing", price: 53_000 },
      ],
      auctionValue: null,
      preliminaryValue: null,
    });

    expect(range?.low).toBe(41_000);
    expect(range?.high).toBe(53_000);
    expect(range?.midpoint).toBe(47_000);
    expect(range?.sources).toEqual(["Auction comp", "Dealer listing"]);
  });
});

describe("describeTradeCreditBasis", () => {
  test("prefers final over preliminary and comps", () => {
    const range = inferTradeRangeSummary({
      marketComps: [{ source: "IronPlanet", low: 40_000, high: 46_000 }],
      auctionValue: null,
      preliminaryValue: 41_000,
      finalValue: 39_500,
    });
    expect(describeTradeCreditBasis({ finalValue: 39_500, preliminaryValue: 41_000, inferredRange: range })).toEqual({
      basis: "final",
      line: "Trade credit follows the final appraisal value (overrides comp range).",
    });
  });

  test("uses preliminary when no final", () => {
    const range = inferTradeRangeSummary({
      marketComps: [{ source: "IronPlanet", low: 40_000, high: 46_000 }],
      auctionValue: null,
      preliminaryValue: 41_000,
      finalValue: null,
    });
    expect(describeTradeCreditBasis({ finalValue: null, preliminaryValue: 41_000, inferredRange: range })).toEqual({
      basis: "preliminary",
      line: "Trade credit follows the preliminary desk value.",
    });
  });

  test("uses comp midpoint when no desk values", () => {
    const range = inferTradeRangeSummary({
      marketComps: [{ source: "IronPlanet", low: 40_000, high: 46_000 }],
      auctionValue: null,
      preliminaryValue: null,
      finalValue: null,
    });
    expect(describeTradeCreditBasis({ finalValue: null, preliminaryValue: null, inferredRange: range })).toEqual({
      basis: "comps_midpoint",
      line: "Trade credit follows the comp-range midpoint until a desk value is on file.",
    });
  });
});

describe("point-shoot book value → range summary", () => {
  test("maps BookValueRange sources into an inferred range", () => {
    const range: BookValueRange = {
      make: "CAT",
      model: "299D3",
      year: 2019,
      hours: 2400,
      lowCents: 40_000_00,
      midCents: 43_000_00,
      highCents: 46_000_00,
      confidence: "medium",
      isSynthetic: false,
      sources: [
        { kind: "market_valuation", name: "IronPlanet", value_cents: 43_000_00, low_cents: 40_000_00, high_cents: 46_000_00, confidence: "medium", sample_size: 3, as_of: null, detail: null },
      ],
    };
    const comps = buildTradeMarketCompsFromBookValueRange(range);
    expect(comps).toEqual([
      {
        source: "IronPlanet",
        price: 43_000,
        low: 40_000,
        high: 46_000,
        confidence: "medium",
        kind: "market_valuation",
        sample_size: 3,
        as_of: null,
        detail: null,
      },
      {
        source: "_aggregate",
        price: 43_000,
        low: 40_000,
        high: 46_000,
        confidence: "medium",
        kind: "aggregate",
        is_synthetic: false,
      },
    ]);
    const summary = tradeRangeSummaryFromBookValueRange(range);
    expect(summary?.low).toBe(40_000);
    expect(summary?.high).toBe(46_000);
    expect(describePointShootApplyCreditLine(range)).toBe(
      "Trade credit follows the comp-range midpoint until a desk value is on file.",
    );
  });

  test("describePointShootApplyCreditLine falls back when comps cannot be inferred", () => {
    const range: BookValueRange = {
      make: "X",
      model: "Y",
      year: null,
      hours: null,
      lowCents: 10_000_00,
      midCents: 12_000_00,
      highCents: 14_000_00,
      confidence: "low",
      isSynthetic: true,
      sources: [],
    };
    expect(tradeRangeSummaryFromBookValueRange(range)).toBeNull();
    expect(describePointShootApplyCreditLine(range)).toBe(
      "Apply uses the displayed book-value midpoint until a desk value is on file.",
    );
  });
});

describe("buildTradeMarketContext", () => {
  test("builds internal context with aggregate range and source detail", () => {
    const context = buildTradeMarketContext({
      make: "Cat",
      model: "299D3",
      year: 2019,
      hours: 1800,
      marketComps: [
        { source: "IronPlanet", price: 43_000, low: 40_000, high: 46_000, confidence: "medium", sample_size: 3, as_of: "2026-05-01" },
        { source: "_aggregate", price: 45_000, low: 38_000, high: 52_000, confidence: "medium", kind: "aggregate", is_synthetic: true },
      ],
      auctionValue: 45_000,
      preliminaryValue: 40_200,
      finalValue: null,
    });

    expect(context?.equipmentLabel).toBe("2019 Cat 299D3");
    expect(context?.range).toMatchObject({ low: 38_000, high: 52_000, isSynthetic: true });
    expect(context?.appliedValue).toBe(40_200);
    expect(context?.creditBasis.basis).toBe("preliminary");
    expect(context?.sources[0]).toMatchObject({ name: "IronPlanet", sampleSize: 3, isAggregate: false });
    expect(context?.isSynthetic).toBe(true);
  });

  test("returns no-range degraded state without comparable rows", () => {
    const context = buildTradeMarketContext({
      make: "Deere",
      model: "333G",
      preliminaryValue: 39_000,
      marketComps: [],
    });

    expect(context?.range).toBeNull();
    expect(context?.appliedValue).toBe(39_000);
    expect(context?.noRangeReason).toBe("Comparable range is not on file for this valuation yet.");
  });
});
