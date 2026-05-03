import { describe, expect, it } from "bun:test";
import { normalizeDealQuoteRows } from "./deal-quotes";

describe("normalizeDealQuoteRows", () => {
  it("normalizes quote package rows and filters malformed records", () => {
    expect(normalizeDealQuoteRows([
      {
        id: "quote-1",
        status: "sent",
        quote_number: "Q-1001",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "",
        sent_at: "2026-04-02T00:00:00.000Z",
        expires_at: 42,
        net_total: Number.NaN,
      },
      { id: null, status: "draft" },
      "bad",
    ])).toEqual([
      {
        id: "quote-1",
        status: "sent",
        quote_number: "Q-1001",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-01T00:00:00.000Z",
        sent_at: "2026-04-02T00:00:00.000Z",
        expires_at: null,
        net_total: null,
      },
    ]);
  });

  it("returns an empty list for non-array payloads", () => {
    expect(normalizeDealQuoteRows(null)).toEqual([]);
    expect(normalizeDealQuoteRows({ id: "quote-1" })).toEqual([]);
  });
});
