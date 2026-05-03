import { describe, expect, it } from "bun:test";
import { normalizeTradeValuationResponse } from "./trade-walkaround-api";

describe("trade walkaround API response normalizers", () => {
  it("normalizes valuation and AI assessment payloads without trusting malformed fields", () => {
    expect(normalizeTradeValuationResponse({
      valuation: {
        id: "valuation-1",
        deal_id: "deal-1",
        make: "Yanmar",
        model: "VIO55",
        year: 2022,
        serial_number: "SN123",
        hours: 410,
        photos: [{ type: "front", url: "https://example.test/front.jpg" }],
        attachments_included: ["bucket", 42],
        ai_condition_score: 82,
        ai_condition_notes: "Clean trade",
        ai_detected_damage: ["scratched panel", null],
        preliminary_value: 42000,
        final_value: Number.NaN,
        created_at: "2026-05-01T00:00:00.000Z",
      },
      ai_assessment: {
        score: 82,
        notes: "Clean trade",
        detected_damage: ["scratched panel", null],
      },
      pipeline_duration_ms: 375,
    })).toMatchObject({
      valuation: {
        id: "valuation-1",
        deal_id: "deal-1",
        make: "Yanmar",
        model: "VIO55",
        year: 2022,
        attachments_included: ["bucket"],
        ai_detected_damage: ["scratched panel"],
        final_value: null,
      },
      ai_assessment: {
        score: 82,
        notes: "Clean trade",
        detected_damage: ["scratched panel"],
      },
      pipeline_duration_ms: 375,
    });
  });

  it("rejects missing required valuation fields", () => {
    expect(() => normalizeTradeValuationResponse({
      valuation: {
        id: "valuation-1",
        make: "Yanmar",
        created_at: "2026-05-01T00:00:00.000Z",
      },
    })).toThrow("Trade valuation response is missing 'model'.");
  });
});
