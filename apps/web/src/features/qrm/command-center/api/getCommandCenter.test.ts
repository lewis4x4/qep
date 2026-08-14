import { describe, expect, mock, test, beforeEach } from "bun:test";

type InvokeCall = { name: string; options: { body: unknown } };
const invokeCalls: InvokeCall[] = [];
let nextInvokeResponse: { data: unknown; error: unknown } = { data: null, error: null };

mock.module("@/lib/supabase", () => ({
  supabase: {
    functions: {
      invoke: async (name: string, options: { body: unknown }) => {
        invokeCalls.push({ name, options });
        return nextInvokeResponse;
      },
    },
  },
}));

const { getCommandCenter } = await import("./getCommandCenter");

beforeEach(() => {
  invokeCalls.length = 0;
  nextInvokeResponse = { data: null, error: null };
});

describe("getCommandCenter", () => {
  test("invokes qrm-command-center with scope in POST body", async () => {
    nextInvokeResponse = {
      data: {
        scope: "team",
        roleVariant: "iron_woman",
        freshness: {},
        commandStrip: {
          closableRevenue7d: 0,
          closableRevenue30d: 0,
          atRiskRevenue: 0,
          blockedDeals: 0,
          overdueFollowUps: 0,
          urgentApprovals: 0,
          narrative: "Quiet board.",
        },
        aiChiefOfStaff: {
          bestMove: null,
          biggestRisk: null,
          fastestPath: null,
        },
        actionLanes: {
          revenueReady: [],
          revenueAtRisk: [],
          blockers: [],
        },
        pipelinePressure: { stages: [] },
        revenueRealityBoard: { rows: [] },
        dealerRealityGrid: { tiles: [] },
        relationshipEngine: { contacts: [] },
        knowledgeGaps: { gaps: [], repAbsence: [], worstFields: [] },
        executiveIntel: { enabled: false },
      },
      error: null,
    };

    const payload = await getCommandCenter("team");
    expect(payload.scope).toBe("team");
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0].name).toBe("qrm-command-center");
    expect(invokeCalls[0].options.body).toEqual({ scope: "team" });
  });

  test("maps team-scope 403 to dealership English instead of privilege formulas", async () => {
    const ctx = new Response(
      JSON.stringify({
        error:
          "Team scope requires manager/admin privileges or Iron Manager blend weight ≥ 0.5",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
    nextInvokeResponse = {
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: ctx,
      },
    };

    await expect(getCommandCenter("team")).rejects.toThrow(
      "You don't have access to the shop-wide Command Center view. Ask a manager.",
    );
  });

  test("maps legacy deployed team-scope 403 formula to dealership English", async () => {
    const ctx = new Response(
      JSON.stringify({
        error:
          "Team scope requires Iron Manager privileges (blend weight ≥ 0.5)",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
    nextInvokeResponse = {
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: ctx,
      },
    };

    await expect(getCommandCenter("team")).rejects.toThrow(
      "You don't have access to the shop-wide Command Center view. Ask a manager.",
    );
  });

  test("preserves non-privilege outage errors with HTTP context", async () => {
    const ctx = new Response(
      JSON.stringify({ error: "Upstream signal query timed out" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
    nextInvokeResponse = {
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: ctx,
      },
    };

    await expect(getCommandCenter("team")).rejects.toThrow(
      /Upstream signal query timed out \(HTTP 503\)/,
    );
  });
});
