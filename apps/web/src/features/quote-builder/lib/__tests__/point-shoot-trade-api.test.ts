import { describe, expect, test } from "bun:test";
import {
  normalizeApplyTradeResultPayload,
  normalizeBookValueRangePayload,
  normalizeBookValueSources,
  normalizePointShootIdentificationPayload,
  normalizeTradeValuationPhotos,
  normalizeTradeValuationProposalSnapshot,
} from "../point-shoot-trade-api";

describe("point-shoot trade API normalizers", () => {
  test("normalizes equipment vision payloads", () => {
    const ident = normalizePointShootIdentificationPayload({
      analysis: {
        equipment: {
          make: " Deere ",
          model: "333G",
          year: "2021 model year",
          category: "CTL",
        },
        condition: {
          overall: "GOOD",
          hours_estimate: "~2,400 hrs",
        },
        identification_confidence: "medium",
        description: "Clean machine",
        potential_issues: ["Track wear", "", 42],
      },
      image_url: "https://example.com/photo.jpg",
    });

    expect(ident).toEqual({
      make: "Deere",
      model: "333G",
      year: 2021,
      category: "CTL",
      conditionOverall: "good",
      conditionSummary: "Clean machine",
      confidence: "medium",
      hoursEstimate: 2400,
      potentialIssues: ["Track wear"],
      photoUrl: "https://example.com/photo.jpg",
    });
  });

  test("falls back safely for malformed equipment vision payloads", () => {
    expect(normalizePointShootIdentificationPayload({ analysis: { condition: { overall: "mint" } } })).toMatchObject({
      make: null,
      model: null,
      year: null,
      conditionOverall: "unknown",
      confidence: "low",
      potentialIssues: [],
      photoUrl: null,
    });
  });

  test("normalizes book value sources and filters unusable rows", () => {
    expect(normalizeBookValueSources([
      {
        kind: "synthetic_iron_planet",
        name: "Iron Planet",
        value_cents: "1000000",
        low_cents: "900000",
        high_cents: "1100000",
        confidence: "high",
        sample_size: "4",
        as_of: "2026-05-03",
        detail: "Synthetic comp",
      },
      { name: "Missing value" },
      { value_cents: 50 },
    ])).toEqual([
      {
        kind: "synthetic_iron_planet",
        name: "Iron Planet",
        value_cents: 1000000,
        low_cents: 900000,
        high_cents: 1100000,
        confidence: "high",
        sample_size: 4,
        as_of: "2026-05-03",
        detail: "Synthetic comp",
      },
    ]);
  });

  test("normalizes book value ranges with safe source cleanup", () => {
    const range = normalizeBookValueRangePayload({
      make: "Deere",
      model: "333G",
      year: "2021",
      hours: "2400",
      low_cents: "900000",
      mid_cents: "1000000",
      high_cents: "1100000",
      confidence: "medium",
      is_synthetic: true,
      sources: [{ kind: "unknown", name: "Fallback", value_cents: 1000000, confidence: "bad" }],
    });

    expect(range).toEqual({
      make: "Deere",
      model: "333G",
      year: 2021,
      hours: 2400,
      lowCents: 900000,
      midCents: 1000000,
      highCents: 1100000,
      confidence: "medium",
      isSynthetic: true,
      sources: [{
        kind: "market_valuation",
        name: "Fallback",
        value_cents: 1000000,
        low_cents: null,
        high_cents: null,
        confidence: "low",
        sample_size: null,
        as_of: null,
        detail: null,
      }],
    });
  });

  test("normalizes trade valuation apply responses with echoed photos", () => {
    expect(normalizeApplyTradeResultPayload({
      valuation: {
        id: "valuation-1",
        preliminary_value: "9250",
        photos: [
          { type: "point_shoot", url: "https://cdn.qep.example/trade-front.jpg" },
          { type: "hour_meter", url: "https://cdn.qep.example/trade-hours.jpg" },
        ],
      },
    }, 920000)).toEqual({
      valuationId: "valuation-1",
      preliminaryValueCents: 925000,
      photoUrl: "https://cdn.qep.example/trade-front.jpg",
      photoUrls: ["https://cdn.qep.example/trade-front.jpg", "https://cdn.qep.example/trade-hours.jpg"],
    });
  });

  test("uses fallback preliminary value and rejects missing valuation id", () => {
    expect(normalizeApplyTradeResultPayload({ valuation: { id: "valuation-2" } }, 920000)).toEqual({
      valuationId: "valuation-2",
      preliminaryValueCents: 920000,
      photoUrl: null,
      photoUrls: [],
    });

    expect(() => normalizeApplyTradeResultPayload({ valuation: {} }, 920000)).toThrow(
      "Trade valuation response missing id",
    );
  });

  test("normalizes durable trade valuation snapshots for proposal enrichment", () => {
    expect(normalizeTradeValuationPhotos([
      { type: "point_shoot", url: "https://cdn.qep.example/trade.jpg" },
      "https://cdn.qep.example/fallback.jpg",
      { type: "bad" },
      null,
    ])).toEqual([
      { type: "point_shoot", url: "https://cdn.qep.example/trade.jpg" },
      { type: "trade", url: "https://cdn.qep.example/fallback.jpg" },
    ]);

    expect(normalizeTradeValuationProposalSnapshot({
      id: "trade-123",
      make: " Deere ",
      model: "333G",
      year: "2021",
      serial_number: " SN123 ",
      hours: "2400",
      photos: [{ type: "point_shoot", url: "https://cdn.qep.example/trade.jpg" }],
      market_comps: [{ source: "IronPlanet", price: 43000 }, "bad"],
      auction_value: "45000",
      discounted_value: "41400",
      reconditioning_estimate: "1200",
      preliminary_value: "40200",
      conditional_language: "Same condition as evaluated",
      ai_condition_notes: "Clean undercarriage.",
      operational_status: "daily_use",
    })).toEqual({
      id: "trade-123",
      make: "Deere",
      model: "333G",
      year: 2021,
      serialNumber: "SN123",
      hours: 2400,
      photos: [{ type: "point_shoot", url: "https://cdn.qep.example/trade.jpg" }],
      marketComps: [{ source: "IronPlanet", price: 43000 }],
      auctionValue: 45000,
      discountedValue: 41400,
      reconditioningEstimate: 1200,
      preliminaryValue: 40200,
      conditionalLanguage: "Same condition as evaluated",
      aiConditionNotes: "Clean undercarriage.",
      operationalStatus: "daily_use",
    });
  });
});
