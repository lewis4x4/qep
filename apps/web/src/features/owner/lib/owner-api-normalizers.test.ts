import { describe, expect, test } from "bun:test";
import {
  normalizeBranchStackRows,
  normalizeOwnerAskAnythingResponse,
  normalizeOwnerDashboardSummary,
  normalizeOwnerEventFeed,
  normalizeOwnerMorningBrief,
  normalizeOwnershipHealthScore,
  normalizePredictiveInterventionsResponse,
  normalizeTeamSignalsResponse,
} from "./owner-api-normalizers";

describe("owner API normalizers", () => {
  test("normalizes owner dashboard summary RPC payloads", () => {
    expect(normalizeOwnerDashboardSummary({
      generated_at: "2026-05-03T12:00:00.000Z",
      workspace_id: "default",
      revenue: {
        today: "1000",
        mtd: "12000",
        prev_month_same_day: "9000",
        mtd_vs_prev_pct: "0.25",
      },
      pipeline: {
        weighted_total: "500000",
        at_risk_count: "7",
      },
      parts: {
        total_catalog: "100",
        dead_capital_usd: "2500",
        stockout_critical: "3",
        predictive_revenue_open: "4200",
        predictive_open_plays: "4",
        replenish_pending: "8",
        margin_erosion_flags: "2",
        last_import_at: "2026-05-02T00:00:00.000Z",
      },
      finance: { ar_aged_90_plus: "12500" },
    })).toEqual({
      generated_at: "2026-05-03T12:00:00.000Z",
      workspace_id: "default",
      revenue: {
        today: 1000,
        mtd: 12000,
        prev_month_same_day: 9000,
        mtd_vs_prev_pct: 0.25,
      },
      pipeline: {
        weighted_total: 500000,
        at_risk_count: 7,
      },
      parts: {
        total_catalog: 100,
        dead_capital_usd: 2500,
        stockout_critical: 3,
        predictive_revenue_open: 4200,
        predictive_open_plays: 4,
        replenish_pending: 8,
        margin_erosion_flags: 2,
        last_import_at: "2026-05-02T00:00:00.000Z",
      },
      finance: { ar_aged_90_plus: 12500 },
    });
  });

  test("normalizes ownership health scores and defaults invalid tiers", () => {
    expect(normalizeOwnershipHealthScore({
      score: "88",
      generated_at: "2026-05-03T12:00:00.000Z",
      dimensions: {
        parts: "90",
        sales: "80",
        service: "not numeric",
        rental: 70,
        finance: "60",
      },
      weights: { parts: "0.3", bad: "nope" },
      tier: "unknown",
    })).toEqual({
      score: 88,
      generated_at: "2026-05-03T12:00:00.000Z",
      dimensions: {
        parts: 90,
        sales: 80,
        service: 0,
        rental: 70,
        finance: 60,
      },
      weights: { parts: 0.3 },
      tier: "healthy",
    });
  });

  test("normalizes owner event feeds and filters malformed events", () => {
    expect(normalizeOwnerEventFeed({
      since: "2026-05-02T12:00:00.000Z",
      count: "9",
      events: [
        {
          type: "parts_order_created",
          at: "2026-05-03T12:00:00.000Z",
          summary: "Order created",
          amount: "1400",
          revenue: "1400",
          id: "event-1",
        },
        { type: "bad", summary: "Missing date" },
      ],
    })).toEqual({
      since: "2026-05-02T12:00:00.000Z",
      count: 9,
      events: [
        {
          type: "parts_order_created",
          at: "2026-05-03T12:00:00.000Z",
          summary: "Order created",
          amount: 1400,
          revenue: 1400,
          id: "event-1",
        },
      ],
    });
  });

  test("normalizes branch stack rows and filters rows without a branch", () => {
    expect(normalizeBranchStackRows([
      {
        workspace_id: "default",
        branch_code: "LOU",
        parts_count: "100",
        inventory_value: "250000",
        dead_parts: "5",
        at_reorder_count: "8",
        dead_pct: "5",
        inventory_quartile: "1",
        dead_parts_quartile_asc: "4",
        reorder_quartile_asc: "3",
      },
      { branch_code: "" },
    ])).toEqual([
      {
        workspace_id: "default",
        branch_code: "LOU",
        parts_count: 100,
        inventory_value: 250000,
        dead_parts: 5,
        at_reorder_count: 8,
        dead_pct: 5,
        inventory_quartile: 1,
        dead_parts_quartile_asc: 4,
        reorder_quartile_asc: 3,
      },
    ]);
  });

  test("normalizes owner edge function responses", () => {
    expect(normalizeOwnerMorningBrief({
      brief: "Focus on aged AR.",
      generated_at: "2026-05-03T12:00:00.000Z",
      cached: true,
      model: "claude",
    })).toEqual({
      brief: "Focus on aged AR.",
      generated_at: "2026-05-03T12:00:00.000Z",
      cached: true,
      model: "claude",
    });

    expect(normalizeOwnerAskAnythingResponse({
      answer: "Watch stockouts.",
      tool_trace: [{ tool: "summary", input: { q: "parts" }, result: { ok: true } }],
      elapsed_ms: "42",
    })).toEqual({
      answer: "Watch stockouts.",
      tool_trace: [{ tool: "summary", input: { q: "parts" }, result: { ok: true } }],
      elapsed_ms: 42,
    });
  });

  test("normalizes predictive intervention and team signal payloads", () => {
    expect(normalizePredictiveInterventionsResponse({
      generated_at: "2026-05-03T12:00:00.000Z",
      model: "claude",
      interventions: [
        {
          title: "Recover stockout",
          projection: "$5K recovery",
          rationale: "Critical part demand",
          impact_usd: "5000",
          horizon_days: "14",
          severity: "unknown",
          action: { label: "Open parts", route: "/parts" },
        },
        { title: "Bad" },
      ],
    })).toEqual({
      generated_at: "2026-05-03T12:00:00.000Z",
      model: "claude",
      interventions: [
        {
          title: "Recover stockout",
          projection: "$5K recovery",
          rationale: "Critical part demand",
          impact_usd: 5000,
          horizon_days: 14,
          severity: "medium",
          action: { label: "Open parts", route: "/parts" },
        },
      ],
    });

    expect(normalizeTeamSignalsResponse({
      generated_at: "2026-05-03T12:00:00.000Z",
      workspace_id: "default",
      reps: [
        {
          rep_name: "A Rep",
          rep_id: "rep-1",
          ytd_wins: "3",
          ytd_bookings: "120000",
          open_deals: "4",
          close_rate_pct: "33.3",
          avg_close_days: "12",
        },
        { rep_name: "" },
      ],
    })).toEqual({
      generated_at: "2026-05-03T12:00:00.000Z",
      workspace_id: "default",
      reps: [
        {
          rep_name: "A Rep",
          rep_id: "rep-1",
          ytd_wins: 3,
          ytd_bookings: 120000,
          open_deals: 4,
          close_rate_pct: 33.3,
          avg_close_days: 12,
        },
      ],
    });
  });

  test("returns safe empty owner collections for malformed inputs", () => {
    expect(normalizeBranchStackRows(null)).toEqual([]);
    expect(normalizeOwnerEventFeed(null)).toEqual({ since: "", count: 0, events: [] });
    expect(normalizeTeamSignalsResponse(null)).toEqual({ generated_at: "", workspace_id: "default", reps: [] });
  });
});
