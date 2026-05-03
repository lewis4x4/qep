import { describe, expect, test } from "bun:test";
import {
  normalizeAnalyticsSnapshot,
  normalizeCrossReferenceFallbackRows,
  normalizeCustomerPartsIntel,
  normalizeForecastRows,
  normalizeOrderEvents,
  normalizePartActivityRows,
  normalizeSubstituteRows,
  normalizeTransferRecommendations,
  normalizeVendorTrends,
} from "./parts-row-normalizers";

describe("parts row normalizers", () => {
  test("normalizes demand forecast rows and derives fallback coverage from risk", () => {
    expect(normalizeForecastRows([
      {
        workspace_id: "ws-1",
        part_number: "P-100",
        branch_id: "01",
        forecast_month: "2026-05-01",
        predicted_qty: "10",
        confidence_low: "7",
        confidence_high: "13",
        stockout_risk: "critical",
        qty_on_hand_at_forecast: "2",
        current_qty_on_hand: "3",
        consumption_velocity: "0.5",
        current_reorder_point: "4",
        coverage_status: "bad",
        days_of_stock_remaining: "6",
        drivers: { order_history: 5 },
        computed_at: "2026-05-03T12:00:00Z",
      },
      { workspace_id: "ws-1", part_number: "" },
    ], { fallbackFromRisk: true })).toEqual([
      {
        workspace_id: "ws-1",
        part_number: "P-100",
        branch_id: "01",
        forecast_month: "2026-05-01",
        predicted_qty: 10,
        confidence_low: 7,
        confidence_high: 13,
        stockout_risk: "critical",
        qty_on_hand_at_forecast: 2,
        current_qty_on_hand: 3,
        consumption_velocity: 0.5,
        current_reorder_point: 4,
        coverage_status: "action_required",
        days_of_stock_remaining: 6,
        drivers: { order_history: 5 },
        computed_at: "2026-05-03T12:00:00Z",
      },
    ]);
  });

  test("normalizes order events with joined profile arrays", () => {
    expect(normalizeOrderEvents([
      {
        id: "event-1",
        event_type: "status_changed",
        source: "system",
        actor_id: "user-1",
        from_status: "draft",
        to_status: "submitted",
        metadata: { note: "ok" },
        created_at: "2026-05-03T12:00:00Z",
        profiles: [{ full_name: "Parts User" }],
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "event-1",
        event_type: "status_changed",
        source: "system",
        actor_id: "user-1",
        from_status: "draft",
        to_status: "submitted",
        metadata: { note: "ok" },
        created_at: "2026-05-03T12:00:00Z",
        actor_name: "Parts User",
      },
    ]);
  });

  test("normalizes analytics snapshots and vendor trends", () => {
    expect(normalizeAnalyticsSnapshot({
      id: "snap-1",
      snapshot_date: "2026-05-03",
      total_revenue: "1000",
      total_cost: "700",
      total_margin: "300",
      order_count: "4",
      line_count: "9",
      revenue_by_category: [{ category: "Filters", revenue: "500", cost: "300", margin: "200", line_count: "3" }],
      revenue_by_source: [{ order_source: "portal", revenue: "250", order_count: "2" }],
      top_customers: [{ company_id: "co-1", company_name: "Tiger", revenue: "400", order_count: "1" }],
      fastest_moving: [{ part_number: "P-100", description: "Filter", total_qty: "5", total_revenue: "125" }],
      total_inventory_value: "9000",
      dead_stock_value: "100",
      dead_stock_count: "2",
    })).toEqual({
      id: "snap-1",
      snapshot_date: "2026-05-03",
      total_revenue: 1000,
      total_cost: 700,
      total_margin: 300,
      order_count: 4,
      line_count: 9,
      revenue_by_category: [{ category: "Filters", revenue: 500, cost: 300, margin: 200, line_count: 3 }],
      revenue_by_source: [{ order_source: "portal", revenue: 250, order_count: 2 }],
      top_customers: [{ company_id: "co-1", company_name: "Tiger", revenue: 400, order_count: 1 }],
      fastest_moving: [{ part_number: "P-100", description: "Filter", total_qty: 5, total_revenue: 125 }],
      total_inventory_value: 9000,
      dead_stock_value: 100,
      dead_stock_count: 2,
    });

    expect(normalizeVendorTrends([
      { id: "vendor-1", name: "Vendor", avg_lead_time_hours: "48", responsiveness_score: "92", fill_rate: "0.98", composite_score: "88", machine_down_priority: true },
      { name: "missing id" },
    ])).toEqual([
      {
        id: "vendor-1",
        name: "Vendor",
        avg_lead_time_hours: 48,
        responsiveness_score: 92,
        fill_rate: 0.98,
        composite_score: 88,
        machine_down_priority: true,
      },
    ]);
  });

  test("normalizes part activity joined order rows", () => {
    expect(normalizePartActivityRows([
      {
        id: "line-1",
        quantity: "2",
        unit_price: "10.5",
        line_total: "21",
        created_at: "2026-05-03T12:00:00Z",
        parts_orders: {
          id: "order-1",
          status: "submitted",
          portal_customers: [{ first_name: "Ann", last_name: "Smith" }],
          crm_companies: null,
        },
      },
      { id: "bad", parts_orders: null },
    ])).toEqual([
      {
        id: "line-1",
        order_id: "order-1",
        order_status: "submitted",
        quantity: 2,
        unit_price: 10.5,
        line_total: 21,
        created_at: "2026-05-03T12:00:00Z",
        customer_label: "Ann Smith",
      },
    ]);
  });

  test("normalizes substitute RPC and fallback cross-reference rows", () => {
    expect(normalizeSubstituteRows([
      {
        xref_id: "xref-1",
        substitute_part_number: "P-200",
        relationship: "interchangeable",
        confidence: "0.95",
        source: "rpc",
        fitment_notes: "same",
        price_delta: "2",
        lead_time_delta_days: "1",
        qty_available: "8",
        available_branch: "01",
        catalog_description: "Alt",
      },
      { xref_id: "bad" },
    ])).toEqual([
      {
        xref_id: "xref-1",
        substitute_part_number: "P-200",
        relationship: "interchangeable",
        confidence: 0.95,
        source: "rpc",
        fitment_notes: "same",
        price_delta: 2,
        lead_time_delta_days: 1,
        qty_available: 8,
        available_branch: "01",
        catalog_description: "Alt",
      },
    ]);

    expect(normalizeCrossReferenceFallbackRows([
      {
        id: "xref-2",
        part_number_a: "P-100",
        relationship: "superseded_by",
        confidence: "0.7",
        source: "table",
        price_delta: "5",
        lead_time_delta_days: "2",
      },
    ], "inbound")).toEqual([
      {
        xref_id: "xref-2",
        substitute_part_number: "P-100",
        relationship: "superseded_by",
        confidence: 0.7,
        source: "table",
        fitment_notes: null,
        price_delta: -5,
        lead_time_delta_days: -2,
        qty_available: 0,
        available_branch: null,
        catalog_description: null,
      },
    ]);
  });

  test("normalizes customer parts intelligence payloads", () => {
    expect(normalizeCustomerPartsIntel({
      id: "intel-1",
      crm_company_id: "co-1",
      total_spend_12m: "1000",
      total_spend_prior_12m: "750",
      spend_trend: "up",
      monthly_spend: [{ month: "2026-05", revenue: "100" }],
      order_count_12m: "5",
      avg_order_value: "200",
      last_order_date: "2026-04-01",
      days_since_last_order: "32",
      fleet_count: "3",
      machines_approaching_service: "1",
      predicted_next_quarter_spend: "400",
      top_categories: [{ category: "Filters", revenue: "250", pct: "0.25" }],
      churn_risk: "low",
      recommended_outreach: "Call",
      opportunity_value: "300",
      computed_at: "2026-05-03T12:00:00Z",
    })).toEqual({
      id: "intel-1",
      crm_company_id: "co-1",
      total_spend_12m: 1000,
      total_spend_prior_12m: 750,
      spend_trend: "up",
      monthly_spend: [{ month: "2026-05", revenue: 100 }],
      order_count_12m: 5,
      avg_order_value: 200,
      last_order_date: "2026-04-01",
      days_since_last_order: 32,
      fleet_count: 3,
      machines_approaching_service: 1,
      predicted_next_quarter_spend: 400,
      top_categories: [{ category: "Filters", revenue: 250, pct: 0.25 }],
      churn_risk: "low",
      recommended_outreach: "Call",
      opportunity_value: 300,
      computed_at: "2026-05-03T12:00:00Z",
    });
  });

  test("normalizes transfer recommendations", () => {
    expect(normalizeTransferRecommendations([
      {
        id: "transfer-1",
        part_number: "P-100",
        from_branch_id: "01",
        to_branch_id: "02",
        recommended_qty: "4",
        from_qty_on_hand: "12",
        to_qty_on_hand: "0",
        to_reorder_point: "2",
        to_forecast_demand: "5",
        estimated_transfer_cost: "25",
        estimated_stockout_cost_avoided: "500",
        net_savings: "475",
        priority: "critical",
        confidence: "0.9",
        reason: "stockout risk",
        status: "pending",
        created_at: "2026-05-03T12:00:00Z",
      },
      { id: "bad", part_number: "P-200" },
    ])).toEqual([
      {
        id: "transfer-1",
        part_number: "P-100",
        from_branch_id: "01",
        to_branch_id: "02",
        recommended_qty: 4,
        from_qty_on_hand: 12,
        to_qty_on_hand: 0,
        to_reorder_point: 2,
        to_forecast_demand: 5,
        estimated_transfer_cost: 25,
        estimated_stockout_cost_avoided: 500,
        net_savings: 475,
        priority: "critical",
        confidence: 0.9,
        reason: "stockout risk",
        status: "pending",
        created_at: "2026-05-03T12:00:00Z",
      },
    ]);
  });

  test("returns empty defaults for malformed inputs", () => {
    expect(normalizeForecastRows({})).toEqual([]);
    expect(normalizeOrderEvents(null)).toEqual([]);
    expect(normalizeAnalyticsSnapshot({ id: "missing date" })).toBeNull();
    expect(normalizePartActivityRows("bad")).toEqual([]);
    expect(normalizeCustomerPartsIntel(undefined)).toBeNull();
  });
});
