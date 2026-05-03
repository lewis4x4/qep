import { describe, expect, test } from "bun:test";
import {
  normalizeAnalyticsAlertRows,
  normalizeKpiSnapshots,
  normalizeMetricDefinitions,
  normalizeSnapshotHistoryRows,
} from "./exec-row-normalizers";

describe("exec row normalizers", () => {
  test("normalizes metric definitions and filters invalid roles", () => {
    expect(normalizeMetricDefinitions([
      {
        metric_key: "weighted_pipeline",
        label: "Weighted pipeline",
        description: null,
        formula_text: "sum(weighted_amount)",
        display_category: "sales",
        owner_role: "ceo",
        source_tables: ["crm_deals_weighted", 42],
        refresh_cadence: "hourly",
        drill_contract: { drill_view: "crm_deals_weighted" },
        threshold_config: null,
        synthetic_weights: { pipeline: "0.7", bad: "NaN" },
        is_executive_metric: true,
      },
      {
        metric_key: "bad-role",
        label: "Bad",
        formula_text: "1",
        display_category: "bad",
        owner_role: "sales",
        refresh_cadence: "hourly",
        is_executive_metric: true,
      },
    ])).toEqual([
      {
        metric_key: "weighted_pipeline",
        label: "Weighted pipeline",
        description: null,
        formula_text: "sum(weighted_amount)",
        display_category: "sales",
        owner_role: "ceo",
        source_tables: ["crm_deals_weighted"],
        refresh_cadence: "hourly",
        drill_contract: { drill_view: "crm_deals_weighted" },
        threshold_config: {},
        synthetic_weights: { pipeline: 0.7 },
        is_executive_metric: true,
      },
    ]);
  });

  test("normalizes KPI snapshots and numeric strings", () => {
    expect(normalizeKpiSnapshots([
      {
        metric_key: "weighted_pipeline",
        metric_value: "1200000",
        comparison_value: "1100000",
        target_value: null,
        confidence_score: "0.94",
        data_quality_score: "0.98",
        period_start: "2026-05-01",
        period_end: "2026-05-31",
        calculated_at: "2026-05-03T12:00:00.000Z",
        refresh_state: "fresh",
        metadata: { source: "rpc" },
      },
      {
        metric_key: "bad-refresh",
        period_start: "2026-05-01",
        period_end: "2026-05-31",
        calculated_at: "2026-05-03T12:00:00.000Z",
        refresh_state: "unknown",
      },
    ])).toEqual([
      {
        metric_key: "weighted_pipeline",
        metric_value: 1200000,
        comparison_value: 1100000,
        target_value: null,
        confidence_score: 0.94,
        data_quality_score: 0.98,
        period_start: "2026-05-01",
        period_end: "2026-05-31",
        calculated_at: "2026-05-03T12:00:00.000Z",
        refresh_state: "fresh",
        metadata: { source: "rpc" },
      },
    ]);
  });

  test("normalizes analytics alerts and filters terminal statuses later", () => {
    expect(normalizeAnalyticsAlertRows([
      {
        id: "alert-1",
        alert_type: "threshold",
        metric_key: "weighted_pipeline",
        severity: "critical",
        title: "Pipeline fell below floor",
        description: "Investigate",
        role_target: "ceo",
        business_impact_value: "50000",
        business_impact_type: "revenue",
        entity_type: "branch",
        entity_id: "branch-1",
        branch_id: "01",
        root_cause_guess: "Low activity",
        suggested_action: "Review stalled deals",
        status: "new",
        acknowledged_at: null,
        resolved_at: null,
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
      },
      {
        id: "bad-severity",
        alert_type: "threshold",
        severity: "urgent",
        title: "Bad",
        role_target: "ceo",
        status: "new",
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
      },
    ])).toEqual([
      {
        id: "alert-1",
        alert_type: "threshold",
        metric_key: "weighted_pipeline",
        severity: "critical",
        title: "Pipeline fell below floor",
        description: "Investigate",
        role_target: "ceo",
        business_impact_value: 50000,
        business_impact_type: "revenue",
        entity_type: "branch",
        entity_id: "branch-1",
        branch_id: "01",
        root_cause_guess: "Low activity",
        suggested_action: "Review stalled deals",
        status: "new",
        acknowledged_at: null,
        resolved_at: null,
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes metric drill snapshot history rows", () => {
    expect(normalizeSnapshotHistoryRows([
      {
        metric_value: "125.5",
        period_end: "2026-05-31",
        calculated_at: "2026-05-03T12:00:00.000Z",
        refresh_state: "partial",
      },
      {
        metric_value: 10,
        period_end: "2026-05-31",
        calculated_at: "2026-05-03T12:00:00.000Z",
        refresh_state: "unknown",
      },
    ])).toEqual([
      {
        metric_value: 125.5,
        period_end: "2026-05-31",
        calculated_at: "2026-05-03T12:00:00.000Z",
        refresh_state: "partial",
      },
    ]);
  });

  test("returns empty arrays for non-array inputs", () => {
    expect(normalizeMetricDefinitions(null)).toEqual([]);
    expect(normalizeKpiSnapshots({ metric_key: "weighted_pipeline" })).toEqual([]);
    expect(normalizeAnalyticsAlertRows(undefined)).toEqual([]);
    expect(normalizeSnapshotHistoryRows({ metric_value: 10 })).toEqual([]);
  });
});
