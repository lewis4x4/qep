import { describe, expect, test } from "bun:test";
import {
  normalizeBranchStackRows,
  normalizeOwnerAskAnythingResponse,
  normalizeOwnerDashboardSummary,
  normalizeOwnerEventFeed,
  normalizeOwnerMarginExceptionRows,
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

  test("normalizes owner margin exception rows and filters malformed payloads", () => {
    expect(normalizeOwnerMarginExceptionRows([
      {
        exception_id: "exception-1",
        workspace_id: "default",
        exception_created_at: "2026-05-20T12:00:00.000Z",
        quote_package_id: "quote-1",
        brand_id: "brand-1",
        brand_code: "DEERE",
        brand_name: "John Deere",
        rep_id: "rep-1",
        rep_name: "Avery Rep",
        quoted_margin_pct: "7.5",
        threshold_margin_pct: "10",
        delta_pts: null,
        estimated_gap_cents: "125000",
        reason: "Competitive match required",
        approval_case_id: "case-1",
        quote_number: "Q-1001",
        customer_name: "Cooper Timber",
        customer_company: "Cooper Timber LLC",
        branch_name: "Louisville",
        net_total: "250000",
        approval_margin_pct: "7.5",
        approval_status: "approved_with_conditions",
        assigned_to: "owner-1",
        assigned_to_name: "Olivia Owner",
        assigned_role: "owner",
        decided_by: "owner-1",
        decided_by_name: "Olivia Owner",
        decided_at: "2026-05-20T13:00:00.000Z",
        decision_note: "Hold delivery until cash down lands.",
      },
      {
        exception_id: "exception-2",
        workspace_id: "default",
        exception_created_at: "2026-05-20T14:00:00.000Z",
        quote_package_id: "quote-2",
        quoted_margin_pct: 8,
        threshold_margin_pct: 10,
        delta_pts: -2,
        estimated_gap_cents: null,
        reason: "Fleet conquest",
        approval_status: "not_real",
      },
      { exception_id: "bad", quoted_margin_pct: "not numeric" },
    ])).toEqual([
      {
        exception_id: "exception-1",
        workspace_id: "default",
        exception_created_at: "2026-05-20T12:00:00.000Z",
        quote_package_id: "quote-1",
        brand_id: "brand-1",
        brand_code: "DEERE",
        brand_name: "John Deere",
        rep_id: "rep-1",
        rep_name: "Avery Rep",
        quoted_margin_pct: 7.5,
        threshold_margin_pct: 10,
        delta_pts: -2.5,
        estimated_gap_cents: 125000,
        reason: "Competitive match required",
        approval_case_id: "case-1",
        quote_number: "Q-1001",
        customer_name: "Cooper Timber",
        customer_company: "Cooper Timber LLC",
        branch_name: "Louisville",
        net_total: 250000,
        approval_margin_pct: 7.5,
        approval_status: "approved_with_conditions",
        assigned_to: "owner-1",
        assigned_to_name: "Olivia Owner",
        assigned_role: "owner",
        decided_by: "owner-1",
        decided_by_name: "Olivia Owner",
        decided_at: "2026-05-20T13:00:00.000Z",
        decision_note: "Hold delivery until cash down lands.",
      },
      {
        exception_id: "exception-2",
        workspace_id: "default",
        exception_created_at: "2026-05-20T14:00:00.000Z",
        quote_package_id: "quote-2",
        brand_id: null,
        brand_code: null,
        brand_name: null,
        rep_id: null,
        rep_name: null,
        quoted_margin_pct: 8,
        threshold_margin_pct: 10,
        delta_pts: -2,
        estimated_gap_cents: null,
        reason: "Fleet conquest",
        approval_case_id: null,
        quote_number: null,
        customer_name: null,
        customer_company: null,
        branch_name: null,
        net_total: null,
        approval_margin_pct: null,
        approval_status: null,
        assigned_to: null,
        assigned_to_name: null,
        assigned_role: null,
        decided_by: null,
        decided_by_name: null,
        decided_at: null,
        decision_note: null,
      },
    ]);

    expect(normalizeOwnerMarginExceptionRows(null)).toEqual([]);
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
