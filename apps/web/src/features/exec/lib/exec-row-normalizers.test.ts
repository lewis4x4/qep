import { describe, expect, test } from "bun:test";
import {
  normalizeAnalyticsAlertRows,
  normalizeExecBranchComparisonRows,
  normalizeExecCustomerProfileRows,
  normalizeExecHealthMoverRows,
  normalizeExecInterventionHistoryRows,
  normalizeExecInventoryReadinessRows,
  normalizeExecMarginWaterfallRows,
  normalizeExecPacketResponse,
  normalizeExecPacketRunRows,
  normalizeExecPolicyExceptionRows,
  normalizeExecRentalReturnRows,
  normalizeExecTrafficRows,
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

  test("normalizes exec CFO rows and filters malformed exceptions", () => {
    expect(normalizeExecMarginWaterfallRows([
      {
        month: "2026-05-01",
        revenue: "1000000",
        gross_margin_dollars: "220000",
        net_contribution_dollars: "180000",
        load_dollars: "40000",
        loaded_margin_pct: "18.5",
      },
      { revenue: 10 },
    ])).toEqual([
      {
        month: "2026-05-01",
        revenue: 1000000,
        gross_margin_dollars: 220000,
        net_contribution_dollars: 180000,
        load_dollars: 40000,
        loaded_margin_pct: 18.5,
      },
    ]);

    expect(normalizeExecPolicyExceptionRows([
      {
        id: "ex-1",
        source: "analytics_alert",
        severity: "critical",
        title: "Margin policy breach",
        detail: "Investigate",
        payload: { deal_id: "deal-1" },
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad", source: "analytics_alert", severity: "urgent", title: "Bad", created_at: "2026-05-03" },
    ])).toEqual([
      {
        id: "ex-1",
        source: "analytics_alert",
        severity: "critical",
        title: "Margin policy breach",
        detail: "Investigate",
        payload: { deal_id: "deal-1" },
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes exec CEO growth rows", () => {
    expect(normalizeExecBranchComparisonRows([
      { branch_id: "01", overdue: "2", active: "10", closed: null },
    ])).toEqual([
      { branch_id: "01", overdue: 2, active: 10, closed: null },
    ]);

    expect(normalizeExecHealthMoverRows([
      { customer_profile_id: "profile-1", health_score: "42.5", health_score_updated_at: "2026-05-03T12:00:00.000Z" },
      { customer_profile_id: null, health_score: 10 },
    ])).toEqual([
      { customer_profile_id: "profile-1", health_score: 42.5, health_score_updated_at: "2026-05-03T12:00:00.000Z" },
    ]);

    expect(normalizeExecCustomerProfileRows([
      { id: "profile-1", customer_name: "TigerCat", company_name: "TigerCat Logistics", lifetime_value: "250000", fleet_size: "8" },
      { id: "bad", company_name: "Missing customer" },
    ])).toEqual([
      { id: "profile-1", customer_name: "TigerCat", company_name: "TigerCat Logistics", lifetime_value: 250000, fleet_size: 8 },
    ]);
  });

  test("normalizes exec packet edge and history payloads", () => {
    expect(normalizeExecPacketResponse({
      ok: true,
      run_id: "run-1",
      role: "cfo",
      generated_at: "2026-05-03T12:00:00.000Z",
      markdown: "# Packet",
      json: { role: "cfo" },
      stats: { definitions: "5", snapshots: "3", alerts: "2" },
    })).toEqual({
      ok: true,
      run_id: "run-1",
      role: "cfo",
      generated_at: "2026-05-03T12:00:00.000Z",
      markdown: "# Packet",
      json: { role: "cfo" },
      stats: { definitions: 5, snapshots: 3, alerts: 2 },
    });
    expect(normalizeExecPacketResponse({ ok: false, error: "failed" })).toBeNull();

    expect(normalizeExecPacketRunRows([
      {
        id: "run-1",
        generated_at: "2026-05-03T12:00:00.000Z",
        packet_md: "# Packet",
        metrics_count: "5",
        alerts_count: "2",
        delivery_status: "previewed",
        delivered_at: null,
        delivery_target: null,
        metadata: { preset: "daily" },
      },
      { id: "bad", generated_at: "2026-05-03" },
    ])).toEqual([
      {
        id: "run-1",
        generated_at: "2026-05-03T12:00:00.000Z",
        packet_md: "# Packet",
        metrics_count: 5,
        alerts_count: 2,
        delivery_status: "previewed",
        delivered_at: null,
        delivery_target: null,
        metadata: { preset: "daily" },
      },
    ]);
  });

  test("normalizes exec COO board rows and intervention history", () => {
    expect(normalizeExecTrafficRows([
      {
        id: "ticket-1",
        stock_number: "EQ-1",
        ticket_type: "delivery",
        status: "open",
        blocker_reason: null,
        promised_delivery_at: "2026-05-04T12:00:00.000Z",
        to_location: "Branch 01",
      },
      { id: "bad", status: "open" },
    ])).toHaveLength(1);

    expect(normalizeExecInventoryReadinessRows([
      { total_units: "10", ready_units: "4", in_prep_units: "3", blocked_units: "2", intake_stalled: "1", ready_rate_pct: "40" },
    ])).toEqual([
      { total_units: 10, ready_units: 4, in_prep_units: 3, blocked_units: 2, intake_stalled: 1, ready_rate_pct: 40 },
    ]);

    expect(normalizeExecRentalReturnRows([
      { id: "return-1", status: "inspection", aging_bucket: "3-5", refund_status: "pending", damage_description: "Scratch" },
      { id: "bad", aging_bucket: "3-5" },
    ])).toEqual([
      { id: "return-1", status: "inspection", aging_bucket: "3-5", refund_status: "pending", damage_description: "Scratch" },
    ]);

    expect(normalizeExecInterventionHistoryRows([
      {
        id: "history-1",
        resolution_type: "discount_override",
        resolution_notes: null,
        resolved_at: "2026-05-03T12:00:00.000Z",
        time_to_resolve_minutes: "18",
        recurrence_count: "2",
      },
      { id: "bad", resolved_at: "2026-05-03" },
    ])).toEqual([
      {
        id: "history-1",
        resolution_type: "discount_override",
        resolution_notes: null,
        resolved_at: "2026-05-03T12:00:00.000Z",
        time_to_resolve_minutes: 18,
        recurrence_count: 2,
      },
    ]);
  });
});
