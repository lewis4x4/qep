import { beforeEach, describe, expect, mock, test } from "bun:test";

type QueryResult = { data: unknown; error: null | { message: string } };

const calls: Array<{ method: string; args: unknown[] }> = [];
let nextResult: QueryResult = { data: [], error: null };

function makeQuery(result: QueryResult) {
  const chain = {
    select: mock((...args: unknown[]) => {
      calls.push({ method: "select", args });
      return chain;
    }),
    order: mock((...args: unknown[]) => {
      calls.push({ method: "order", args });
      return chain;
    }),
    gte: mock((...args: unknown[]) => {
      calls.push({ method: "gte", args });
      return chain;
    }),
    lte: mock((...args: unknown[]) => {
      calls.push({ method: "lte", args });
      return chain;
    }),
    eq: mock((...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return chain;
    }),
    is: mock((...args: unknown[]) => {
      calls.push({ method: "is", args });
      return chain;
    }),
    limit: mock(async (...args: unknown[]) => {
      calls.push({ method: "limit", args });
      return result;
    }),
  };
  return chain;
}

const mockFrom = mock((table: string) => {
  calls.push({ method: "from", args: [table] });
  return makeQuery(nextResult);
});

mock.module("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

const { fetchOwnerMarginExceptions } = await import("./owner-api");

describe("owner-api margin exceptions", () => {
  beforeEach(() => {
    calls.length = 0;
    nextResult = { data: [], error: null };
  });

  test("queries v_margin_exceptions with owner report filters and clamps the limit", async () => {
    nextResult = {
      data: [
        {
          exception_id: "exception-1",
          workspace_id: "default",
          exception_created_at: "2026-05-20T12:00:00.000Z",
          quote_package_id: "quote-1",
          quoted_margin_pct: "7.5",
          threshold_margin_pct: "10",
          reason: "Competitive match required",
          approval_status: "pending",
        },
      ],
      error: null,
    };

    const rows = await fetchOwnerMarginExceptions({
      startDate: "2026-02-20T00:00:00.000Z",
      endDate: "2026-05-20T23:59:59.999Z",
      repId: "rep-1",
      approvalStatus: "no_approval",
      limit: 999,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.delta_pts).toBe(-2.5);
    expect(calls).toContainEqual({ method: "from", args: ["v_margin_exceptions"] });
    expect(calls.some((call) => call.method === "select" && String(call.args[0]).includes("exception_id"))).toBe(true);
    expect(calls).toContainEqual({ method: "order", args: ["exception_created_at", { ascending: false }] });
    expect(calls).toContainEqual({ method: "gte", args: ["exception_created_at", "2026-02-20T00:00:00.000Z"] });
    expect(calls).toContainEqual({ method: "lte", args: ["exception_created_at", "2026-05-20T23:59:59.999Z"] });
    expect(calls).toContainEqual({ method: "eq", args: ["rep_id", "rep-1"] });
    expect(calls).toContainEqual({ method: "is", args: ["approval_status", null] });
    expect(calls).toContainEqual({ method: "limit", args: [500] });
  });

  test("filters by concrete approval status and surfaces Supabase errors", async () => {
    nextResult = { data: null, error: { message: "permission denied" } };

    await expect(fetchOwnerMarginExceptions({ approvalStatus: "escalated", limit: 0 })).rejects.toThrow(
      "v_margin_exceptions: permission denied",
    );
    expect(calls).toContainEqual({ method: "eq", args: ["approval_status", "escalated"] });
    expect(calls).toContainEqual({ method: "limit", args: [1] });
  });
});
