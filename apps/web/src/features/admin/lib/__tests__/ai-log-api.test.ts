import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Supabase mock ────────────────────────────────────────────────────────────
// Chain: from → select → order → [gte] → [eq] → limit (terminal → Promise)

const mockLimit  = mock(() => Promise.resolve({ data: [], error: null }));
const mockEqSrc  = mock(() => ({ limit: mockLimit }));
const mockGte    = mock(() => ({ eq: mockEqSrc, limit: mockLimit }));
const mockOrder  = mock(() => ({ gte: mockGte, eq: mockEqSrc, limit: mockLimit }));
// `in` is terminal for the qb_quotes side query — returns Promise.
const mockIn     = mock(() => Promise.resolve({ data: [], error: null }));
const mockSelect = mock(() => ({ order: mockOrder, in: mockIn }));
const mockFrom   = mock((_table: string) => ({ select: mockSelect }));

mock.module("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

const {
  getAiRequestLogs,
  getAiLogStats,
  deriveTimeToQuote,
  formatTimeToQuote,
} = await import("../ai-log-api");

describe("ai-log-api", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockOrder.mockClear();
    mockGte.mockClear();
    mockEqSrc.mockClear();
    mockLimit.mockClear();
  });

  test("getAiRequestLogs({ daysBack: 7 }) applies a created_at >= filter", async () => {
    const before = new Date();
    before.setDate(before.getDate() - 7);

    await getAiRequestLogs({ daysBack: 7 });

    expect(mockFrom).toHaveBeenCalledWith("qb_ai_request_log");
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    // gte was called with "created_at" and a string that parses to ~7 days ago
    const gteArgs = mockGte.mock.calls[0];
    expect(gteArgs[0]).toBe("created_at");
    const cutoffDate = new Date(gteArgs[1] as string);
    // Allow up to 5s of timing slack
    expect(Math.abs(cutoffDate.getTime() - before.getTime())).toBeLessThan(5000);
  });

  test("getAiRequestLogs({ promptSource: 'voice' }) applies .eq('prompt_source', 'voice')", async () => {
    // Simulate no daysBack filter (null) so eq is the first chained call after order
    const mockLimitNoFilter = mock(() => Promise.resolve({ data: [], error: null }));
    const mockEqVoice = mock(() => ({ limit: mockLimitNoFilter }));
    const mockOrderNoFilter = mock(() => ({ gte: mockGte, eq: mockEqVoice, limit: mockLimit }));
    mockSelect.mockImplementationOnce(() => ({ order: mockOrderNoFilter }));

    await getAiRequestLogs({ daysBack: null, promptSource: "voice" });

    expect(mockFrom).toHaveBeenCalledWith("qb_ai_request_log");
    expect(mockEqVoice).toHaveBeenCalledWith("prompt_source", "voice");
  });

  test("getAiRequestLogs: when logs return rows, a second query to qb_quotes is made with those log ids", async () => {
    mockLimit.mockImplementationOnce(() =>
      Promise.resolve({
        data: [
          { id: "log-1", created_at: "2026-04-19T10:00:00Z", resolved_model_id: "m1" },
          { id: "log-2", created_at: "2026-04-19T10:05:00Z", resolved_model_id: null  },
        ],
        error: null,
      }),
    );
    mockIn.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));

    const rows = await getAiRequestLogs({});

    expect(mockFrom).toHaveBeenCalledWith("qb_ai_request_log");
    expect(mockFrom).toHaveBeenCalledWith("qb_quotes");
    expect(mockIn).toHaveBeenCalledWith("originating_log_id", ["log-1", "log-2"]);
    // With no quotes, both rows should report null time-to-quote
    expect(rows[0].time_to_quote_seconds).toBeNull();
    expect(rows[1].time_to_quote_seconds).toBeNull();
    expect(rows[0].originating_quote_id).toBeNull();
  });

  test("getAiRequestLogs: merges qb_quotes into log rows by originating_log_id", async () => {
    mockLimit.mockImplementationOnce(() =>
      Promise.resolve({
        data: [
          { id: "log-1", created_at: "2026-04-19T10:00:00Z", resolved_model_id: "m1" },
          { id: "log-2", created_at: "2026-04-19T10:05:00Z", resolved_model_id: "m2" },
        ],
        error: null,
      }),
    );
    mockIn.mockImplementationOnce(() =>
      Promise.resolve({
        data: [
          // log-1 gets a quote 42 seconds later
          { id: "q-1", originating_log_id: "log-1", created_at: "2026-04-19T10:00:42Z" },
          // log-2 has no quote
        ],
        error: null,
      }),
    );

    const rows = await getAiRequestLogs({});

    const row1 = rows.find((r) => r.id === "log-1")!;
    const row2 = rows.find((r) => r.id === "log-2")!;
    expect(row1.time_to_quote_seconds).toBe(42);
    expect(row1.originating_quote_id).toBe("q-1");
    expect(row2.time_to_quote_seconds).toBeNull();
    expect(row2.originating_quote_id).toBeNull();
  });

  test("getAiRequestLogs: skips the qb_quotes round-trip when logs are empty", async () => {
    mockIn.mockClear();
    mockLimit.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));
    const rows = await getAiRequestLogs({});
    expect(rows).toEqual([]);
    expect(mockIn).not.toHaveBeenCalled();
  });

  test("getAiLogStats returns correct resolve-rate math with 0 guards", async () => {
    // Empty data — resolved = 0, total = 0 → should not divide by zero
    const statsEmpty = await getAiLogStats({});
    expect(statsEmpty.total).toBe(0);
    expect(statsEmpty.resolved).toBe(0);

    // Simulate 3 rows: 2 resolved, 1 voice
    const mockRows = [
      { resolved_model_id: "uuid-1", prompt_source: "text" },
      { resolved_model_id: "uuid-2", prompt_source: "voice" },
      { resolved_model_id: null,     prompt_source: "text" },
    ];
    mockLimit.mockImplementationOnce(() => Promise.resolve({ data: mockRows, error: null }));
    // getAiLogStats calls getAiRequestLogs internally, which triggers the qb_quotes join
    mockIn.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));
    const stats = await getAiLogStats({});
    expect(stats.total).toBe(3);
    expect(stats.resolved).toBe(2);
    expect(stats.voice).toBe(1);
    expect(stats.text).toBe(2);
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("deriveTimeToQuote", () => {
  test("empty inputs → empty map", () => {
    const r = deriveTimeToQuote([], []);
    expect(r.size).toBe(0);
  });

  test("quote with no originating_log_id is ignored", () => {
    const logs = [{ id: "log-1", created_at: "2026-04-19T10:00:00Z" }];
    const quotes = [{ id: "q-1", originating_log_id: null, created_at: "2026-04-19T10:01:00Z" }];
    expect(deriveTimeToQuote(logs, quotes).size).toBe(0);
  });

  test("single match: delta in seconds, rounded", () => {
    const logs = [{ id: "log-1", created_at: "2026-04-19T10:00:00Z" }];
    const quotes = [{ id: "q-1", originating_log_id: "log-1", created_at: "2026-04-19T10:00:42Z" }];
    const r = deriveTimeToQuote(logs, quotes);
    expect(r.get("log-1")?.timeToQuoteSeconds).toBe(42);
    expect(r.get("log-1")?.quoteId).toBe("q-1");
  });

  test("multiple quotes for same log → earliest wins", () => {
    const logs = [{ id: "log-1", created_at: "2026-04-19T10:00:00Z" }];
    const quotes = [
      { id: "q-later", originating_log_id: "log-1", created_at: "2026-04-19T10:05:00Z" },
      { id: "q-early", originating_log_id: "log-1", created_at: "2026-04-19T10:00:30Z" },
    ];
    const r = deriveTimeToQuote(logs, quotes);
    expect(r.get("log-1")?.quoteId).toBe("q-early");
    expect(r.get("log-1")?.timeToQuoteSeconds).toBe(30);
  });

  test("negative delta (quote before log — clock skew) is skipped", () => {
    const logs = [{ id: "log-1", created_at: "2026-04-19T10:00:00Z" }];
    const quotes = [{ id: "q-1", originating_log_id: "log-1", created_at: "2026-04-19T09:59:00Z" }];
    const r = deriveTimeToQuote(logs, quotes);
    expect(r.size).toBe(0);
  });

  test("quote's originating_log_id not in log set is skipped", () => {
    const logs = [{ id: "log-1", created_at: "2026-04-19T10:00:00Z" }];
    const quotes = [{ id: "q-1", originating_log_id: "log-orphan", created_at: "2026-04-19T10:00:05Z" }];
    const r = deriveTimeToQuote(logs, quotes);
    expect(r.size).toBe(0);
  });
});

describe("formatTimeToQuote", () => {
  test("null → em-dash", () => {
    expect(formatTimeToQuote(null)).toBe("—");
  });
  test("under a minute: bare seconds", () => {
    expect(formatTimeToQuote(0)).toBe("0s");
    expect(formatTimeToQuote(42)).toBe("42s");
    expect(formatTimeToQuote(59)).toBe("59s");
  });
  test("exactly a minute: 'Xm' with no seconds", () => {
    expect(formatTimeToQuote(60)).toBe("1m");
    expect(formatTimeToQuote(120)).toBe("2m");
  });
  test("minutes + seconds", () => {
    expect(formatTimeToQuote(90)).toBe("1m 30s");
    expect(formatTimeToQuote(195)).toBe("3m 15s");
    expect(formatTimeToQuote(3599)).toBe("59m 59s");
  });
  test("hours + minutes", () => {
    expect(formatTimeToQuote(3600)).toBe("1h");
    expect(formatTimeToQuote(3845)).toBe("1h 4m");
    expect(formatTimeToQuote(7260)).toBe("2h 1m");
  });
});
