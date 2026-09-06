import { describe, expect, it } from "bun:test";
import {
  formatServiceMetricLabel,
  normalizeMarginByRequestTypeRows,
  normalizeOwnerWatchMetric,
  serviceMetricsDashboardIsEmpty,
  type ServiceMetricsDashboardData,
} from "./service-metrics-api";

describe("service metrics api normalizers", () => {
  it("normalizes H1 margin rows without losing stored percentages", () => {
    const rows = normalizeMarginByRequestTypeRows([
      {
        workspace_id: "default",
        request_type: "field_service",
        job_count: "3",
        quote_count: 2,
        marginable_line_count: "5",
        below_floor_line_count: 1,
        target_met_line_count: 4,
        total_labor_revenue: "1800.50",
        total_margin_cost_basis: "810.25",
        total_margin_amount: "990.25",
        margin_pct: "55.00",
        latest_quote_created_at: "2026-05-29T12:00:00Z",
      },
    ]);

    expect(rows).toEqual([
      {
        workspaceId: "default",
        requestType: "field_service",
        jobCount: 3,
        quoteCount: 2,
        marginableLineCount: 5,
        belowFloorLineCount: 1,
        targetMetLineCount: 4,
        totalRevenue: 1800.5,
        totalMarginCostBasis: 810.25,
        totalMarginAmount: 990.25,
        marginPct: 55,
        costComplete: true,
        latestQuoteCreatedAt: "2026-05-29T12:00:00Z",
      },
    ]);
  });

  it("normalizes owner watch metrics with nullable percentages", () => {
    const metric = normalizeOwnerWatchMetric({
      workspace_id: "default",
      jobs_30d: 10,
      comeback_jobs_30d: 2,
      comeback_rate_pct: "20.00",
      completed_tat_count: null,
      avg_cycle_time_hours: "31.5",
      avg_cycle_target_hours: null,
      tat_on_time_pct: null,
      avg_technician_efficiency_pct: "104.4",
      labor_recovery_pct: "92.8",
      tech_hours_charged_30d: "42",
      tech_hours_worked_30d: "45.25",
      hold_excluded_actual_hours_30d: "16",
      hold_hours_excluded_30d: "5.5",
      shop_jobs_30d: 7,
      field_jobs_30d: 3,
      field_mix_pct: "30",
      open_work_orders: "12",
      open_hold_count: "4",
      open_jobs_on_hold_count: "3",
      warranty_revenue_cents: "125000",
      warranty_cost_cents: "100000",
      warranty_recovery_pct: "125",
      avg_hours_to_first_touch: "2.25",
      first_touch_job_count: 8,
      computed_at: "2026-05-30T12:00:00Z",
    });

    expect(metric?.comebackRatePct).toBe(20);
    expect(metric?.completedTatCount).toBe(0);
    expect(metric?.avgCycleTargetHours).toBeNull();
    expect(metric?.warrantyRevenueCents).toBe(125000);
  });

  it("formats enum-like metric labels for the dashboard", () => {
    expect(formatServiceMetricLabel("comeback_rework")).toBe("Comeback Rework");
    expect(formatServiceMetricLabel(null)).toBe("Unknown");
  });

  it("detects an empty dashboard payload", () => {
    const empty: ServiceMetricsDashboardData = {
      marginByRequestType: [],
      ownerWatch: null,
      cycleTimeBySegment: [],
      openWorkOrdersByStatus: [],
      openWorkOrdersByHoldReason: [],
    };
    expect(serviceMetricsDashboardIsEmpty(empty)).toBe(true);
    expect(serviceMetricsDashboardIsEmpty({ ...empty, marginByRequestType: [{
      workspaceId: "default",
      requestType: "repair",
      jobCount: 1,
      quoteCount: 1,
      marginableLineCount: 1,
      belowFloorLineCount: 0,
      targetMetLineCount: 1,
      totalRevenue: 100,
      totalMarginCostBasis: 45,
      totalMarginAmount: 55,
      marginPct: 55,
      latestQuoteCreatedAt: null,
    }] })).toBe(false);
  });
});

it("posted margin preserves unknown costs instead of inventing a profit", () => {
  const [row] = normalizeMarginByRequestTypeRows([{ request_type: "customer_repair", total_revenue: 150, missing_cost_line_count: 1, marginable_line_count: 1, margin_pct: null }]);
  expect(row.totalRevenue).toBe(150); expect(row.costComplete).toBe(false); expect(row.marginPct).toBeNull();
});
