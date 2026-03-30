import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  computeValuationBadges,
  mapMarketValuationRowToResult,
  type MarketValuationRow,
  scoreCacheCandidate,
  validateMarketValuationRequest,
} from "./market-valuation-logic.ts";

Deno.test("validateMarketValuationRequest accepts valid payload", () => {
  const parsed = validateMarketValuationRequest({
    make: "Barko",
    model: "595B",
    year: 2020,
    hours: 4100,
    condition: "used",
  });

  assertNotEquals(parsed, null);
  assertEquals(parsed?.year, 2020);
});

Deno.test("validateMarketValuationRequest rejects invalid payload", () => {
  const parsed = validateMarketValuationRequest({
    make: "",
    model: "",
    year: 1910,
    hours: -10,
    condition: "",
  });

  assertEquals(parsed, null);
});

Deno.test("validateMarketValuationRequest accepts stock_number-only payload", () => {
  const parsed = validateMarketValuationRequest({
    stock_number: "SN-123",
  });

  assertNotEquals(parsed, null);
  assertEquals(parsed?.stock_number, "SN-123");
  assertEquals(parsed?.make, "");
  assertEquals(parsed?.model, "");
});

Deno.test("scoreCacheCandidate prefers stock match", () => {
  const request = {
    make: "Barko",
    model: "595B",
    year: 2020,
    hours: 4500,
    condition: "used",
    stock_number: "ABC-123",
  };

  const baseRow: MarketValuationRow = {
    id: "1",
    stock_number: null,
    make: "Barko",
    model: "595B",
    year: 2020,
    hours: 4600,
    condition: "used",
    location: null,
    estimated_fmv: 200000,
    low_estimate: 180000,
    high_estimate: 220000,
    confidence_score: 0.7,
    source: "composite_mock",
    source_detail: {},
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(),
  };

  const stockMatched: MarketValuationRow = {
    ...baseRow,
    stock_number: "ABC-123",
  };

  assertNotEquals(
    scoreCacheCandidate(stockMatched, request),
    scoreCacheCandidate(baseRow, request),
  );
});

Deno.test("mapMarketValuationRowToResult hides breakdown when disabled", () => {
  const row: MarketValuationRow = {
    id: "1",
    stock_number: "ABC-123",
    make: "Barko",
    model: "595B",
    year: 2020,
    hours: 4200,
    condition: "used",
    location: "FL",
    estimated_fmv: 210000,
    low_estimate: 196000,
    high_estimate: 224000,
    confidence_score: 0.76,
    source: "composite_live",
    source_detail: {
      source_breakdown: [{
        source: "ironguides",
        value: 210000,
        weight: 0.7,
        confidence: 0.8,
      }],
      data_badges: ["LIVE"],
    },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(),
  };

  const hidden = mapMarketValuationRowToResult(row, false);
  const shown = mapMarketValuationRowToResult(row, true);

  assertEquals(hidden.source_breakdown.length, 0);
  assertEquals(shown.source_breakdown.length, 1);
});

Deno.test("computeValuationBadges returns limited data for mixed mode", () => {
  const badges = computeValuationBadges([
    {
      source: "ironguides",
      badge: "LIVE",
      isMock: false,
      latencyMs: 100,
      value: 210000,
      weight: 0.6,
      confidence: 0.8,
    },
    {
      source: "auction_data",
      badge: "DEMO",
      isMock: true,
      latencyMs: 120,
      value: 200000,
      weight: 0.4,
      confidence: 0.5,
    },
  ]);

  assertEquals(badges.includes("LIMITED_MARKET_DATA"), true);
  assertEquals(badges.includes("LIVE"), true);
  assertEquals(badges.includes("DEMO"), true);
});
