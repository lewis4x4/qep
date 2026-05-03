import { describe, expect, test } from "bun:test";
import { normalizeVoiceOpsResult } from "./voice-ops-api-normalizers";

describe("voice ops API normalizers", () => {
  test("normalizes voice ops edge responses", () => {
    expect(normalizeVoiceOpsResult({
      ok: true,
      spoken_text: "I found the filter.",
      intent: "lookup",
      tool_calls: [
        {
          name: "search_parts",
          input: { q: "filter" },
          result: { part_number: "P-100" },
          elapsed_ms: "42",
        },
        { input: { missing: "name" } },
      ],
      elapsed_ms: "100",
      tokens_in: "50",
      tokens_out: "25",
      cost_usd_cents: "3",
    })).toEqual({
      ok: true,
      spoken_text: "I found the filter.",
      intent: "lookup",
      tool_calls: [
        {
          name: "search_parts",
          input: { q: "filter" },
          result: { part_number: "P-100" },
          elapsed_ms: 42,
        },
      ],
      elapsed_ms: 100,
      tokens_in: 50,
      tokens_out: 25,
      cost_usd_cents: 3,
    });
  });

  test("returns safe defaults for malformed voice responses", () => {
    expect(normalizeVoiceOpsResult({
      ok: "yes",
      intent: "bad",
      tool_calls: "bad",
    })).toEqual({
      ok: false,
      spoken_text: "",
      intent: "other",
      tool_calls: [],
      elapsed_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd_cents: 0,
    });
  });
});
