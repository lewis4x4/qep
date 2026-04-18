import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Supabase mock ────────────────────────────────────────────────────────────
// Chain: from → select → order → [gte] → [eq] → limit (terminal → Promise)

const mockLimit  = mock(() => Promise.resolve({ data: [], error: null }));
const mockEqSrc  = mock(() => ({ limit: mockLimit }));
const mockGte    = mock(() => ({ eq: mockEqSrc, limit: mockLimit }));
const mockOrder  = mock(() => ({ gte: mockGte, eq: mockEqSrc, limit: mockLimit }));
const mockSelect = mock(() => ({ order: mockOrder }));
const mockFrom   = mock((_table: string) => ({ select: mockSelect }));

mock.module("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

const { getAiRequestLogs, getAiLogStats } = await import("../ai-log-api");

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
    const stats = await getAiLogStats({});
    expect(stats.total).toBe(3);
    expect(stats.resolved).toBe(2);
    expect(stats.voice).toBe(1);
    expect(stats.text).toBe(2);
  });
});
