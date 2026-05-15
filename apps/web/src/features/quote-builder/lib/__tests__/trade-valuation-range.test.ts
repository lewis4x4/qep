import { describe, expect, test } from "bun:test";
import { inferTradeRangeSummary } from "../trade-valuation-range";

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
