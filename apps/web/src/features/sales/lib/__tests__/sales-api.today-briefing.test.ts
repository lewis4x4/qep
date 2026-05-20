import { beforeEach, describe, expect, mock, test } from "bun:test";

const fromCalls: string[] = [];
const eqCalls: Array<{ table: string; field: string; value: unknown }> = [];
const invokeCalls: Array<{ name: string; options: Record<string, unknown> | undefined }> = [];

let firstBriefingRead: unknown = null;
let secondBriefingRead: unknown = null;
let readCount = 0;
let invokeResponse: { data: unknown; error: { message?: string } | null } = {
  data: null,
  error: null,
};
let currentUser: { id: string } | null = { id: "rep-1" };

function makeMorningBriefingRow(id: string) {
  return {
    id,
    content: "# Morning brief",
    briefing_date: "2026-05-20",
    created_at: "2026-05-20T10:00:00Z",
    data: {
      sales_today: {
        greeting: "Morning",
        priority_actions: [{ type: "call", customer_name: "ACME", deal_id: "deal-1", summary: "Call ACME" }],
        expiring_quotes: [],
        opportunities: [],
        prep_cards: [],
        stats: { deals_in_pipeline: 3, quotes_sent_this_week: 1, total_pipeline_value: 125000 },
      },
    },
  };
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = mock(() => chain);
  chain.eq = mock((field: string, value: unknown) => {
    eqCalls.push({ table, field, value });
    return chain;
  });
  chain.maybeSingle = mock(async () => {
    if (table === "morning_briefings") {
      readCount += 1;
      return {
        data: readCount === 1 ? firstBriefingRead : secondBriefingRead,
        error: null,
      };
    }
    return { data: null, error: null };
  });
  return chain;
}

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: mock(async () => ({ data: { user: currentUser } })),
    },
    from: mock((table: string) => {
      fromCalls.push(table);
      return makeChain(table);
    }),
    functions: {
      invoke: mock(async (name: string, options?: Record<string, unknown>) => {
        invokeCalls.push({ name, options });
        return invokeResponse;
      }),
    },
  },
}));

const { fetchTodayBriefing } = await import("../sales-api");

describe("fetchTodayBriefing", () => {
  beforeEach(() => {
    fromCalls.length = 0;
    eqCalls.length = 0;
    invokeCalls.length = 0;
    firstBriefingRead = null;
    secondBriefingRead = null;
    readCount = 0;
    invokeResponse = { data: null, error: null };
    currentUser = { id: "rep-1" };
  });

  test("reads an existing morning_briefings row without regenerating", async () => {
    firstBriefingRead = makeMorningBriefingRow("brief-existing");

    const briefing = await fetchTodayBriefing();

    expect(briefing?.id).toBe("brief-existing");
    expect(fromCalls).toEqual(["morning_briefings"]);
    expect(invokeCalls).toEqual([]);
    expect(eqCalls).toContainEqual({ table: "morning_briefings", field: "user_id", value: "rep-1" });
  });

  test("generates once synchronously when today's morning_briefings row is missing", async () => {
    invokeResponse = {
      data: { briefing: makeMorningBriefingRow("brief-generated") },
      error: null,
    };

    const briefing = await fetchTodayBriefing();

    expect(briefing?.id).toBe("brief-generated");
    expect(invokeCalls).toEqual([
      { name: "morning-briefing", options: { body: { regenerate: false } } },
    ]);
    expect(readCount).toBe(1);
  });

  test("re-reads once after generation when the function returns no briefing payload", async () => {
    secondBriefingRead = makeMorningBriefingRow("brief-reread");
    invokeResponse = { data: { result: { status: "already_exists" } }, error: null };

    const briefing = await fetchTodayBriefing();

    expect(briefing?.id).toBe("brief-reread");
    expect(invokeCalls).toHaveLength(1);
    expect(readCount).toBe(2);
  });

  test("returns null without querying when the user is not authenticated", async () => {
    currentUser = null;

    await expect(fetchTodayBriefing()).resolves.toBeNull();

    expect(fromCalls).toEqual([]);
    expect(invokeCalls).toEqual([]);
  });
});
