import { describe, expect, test } from "bun:test";
import {
  normalizeAnalyticsSnapshot,
  normalizeCrossReferenceFallbackRows,
  normalizeCustomerPartsIntel,
  normalizeForecastRows,
  normalizeInventoryHealthRows,
  normalizeOrderManagerLinesResult,
  normalizeOrderManagerOrderResult,
  normalizeOrderManagerPickResult,
  normalizeOrderManagerSubmitResult,
  normalizeOrderEvents,
  normalizePartActivityRows,
  normalizePartsOrderListRows,
  normalizePhotoPartIdentificationResult,
  normalizePredictiveKits,
  normalizeReplenishQueueRows,
  normalizeSubstituteRows,
  normalizeTransferRecommendations,
  normalizeVendorMetricsRows,
  normalizeVendorTrends,
  normalizeVoicePartsOrderResult,
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

  test("normalizes predictive kits with joined companies and kit parts", () => {
    expect(normalizePredictiveKits([
      {
        id: "kit-1",
        fleet_id: "fleet-1",
        crm_company_id: "co-1",
        equipment_make: "Deere",
        equipment_model: "333G",
        equipment_serial: "SN123",
        current_hours: "450",
        predicted_service_window: "2026-06",
        predicted_failure_type: "hydraulic",
        confidence: "0.8",
        kit_parts: [
          { part_number: "P-100", description: "Filter", quantity: "2", unit_cost: "10.5", in_stock: true },
          { description: "missing part" },
        ],
        kit_value: "21",
        kit_part_count: "1",
        stock_status: "all_in_stock",
        parts_in_stock: "1",
        parts_total: "1",
        status: "suggested",
        nearest_branch_id: "01",
        created_at: "2026-05-03T12:00:00Z",
        crm_companies: [{ name: "Tiger" }],
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "kit-1",
        fleet_id: "fleet-1",
        crm_company_id: "co-1",
        equipment_make: "Deere",
        equipment_model: "333G",
        equipment_serial: "SN123",
        current_hours: 450,
        predicted_service_window: "2026-06",
        predicted_failure_type: "hydraulic",
        confidence: 0.8,
        kit_parts: [
          { part_number: "P-100", description: "Filter", quantity: 2, unit_cost: 10.5, in_stock: true },
        ],
        kit_value: 21,
        kit_part_count: 1,
        stock_status: "all_in_stock",
        parts_in_stock: 1,
        parts_total: 1,
        status: "suggested",
        nearest_branch_id: "01",
        created_at: "2026-05-03T12:00:00Z",
        company_name: "Tiger",
      },
    ]);
  });

  test("normalizes replenish queue rows and vendor joins", () => {
    expect(normalizeReplenishQueueRows([
      {
        id: "rq-1",
        workspace_id: "ws-1",
        part_number: "P-100",
        branch_id: "01",
        qty_on_hand: "1",
        reorder_point: "3",
        recommended_qty: "5",
        economic_order_qty: "10",
        selected_vendor_id: "vendor-1",
        vendor_score: "0.9",
        vendor_selection_reason: "best",
        estimated_unit_cost: "12",
        estimated_total: "60",
        status: "pending",
        approved_by: null,
        approved_at: null,
        parts_order_id: null,
        rejection_reason: null,
        expires_at: "2026-05-10",
        computation_batch_id: "batch-1",
        created_at: "2026-05-03T12:00:00Z",
        vendor_profiles: { name: "Vendor" },
      },
    ])).toEqual([
      {
        id: "rq-1",
        workspace_id: "ws-1",
        part_number: "P-100",
        branch_id: "01",
        qty_on_hand: 1,
        reorder_point: 3,
        recommended_qty: 5,
        economic_order_qty: 10,
        selected_vendor_id: "vendor-1",
        vendor_score: 0.9,
        vendor_selection_reason: "best",
        estimated_unit_cost: 12,
        estimated_total: 60,
        status: "pending",
        approved_by: null,
        approved_at: null,
        parts_order_id: null,
        rejection_reason: null,
        expires_at: "2026-05-10",
        computation_batch_id: "batch-1",
        created_at: "2026-05-03T12:00:00Z",
        vendor_name: "Vendor",
      },
    ]);
  });

  test("normalizes inventory health rows and vendor metrics rows", () => {
    expect(normalizeInventoryHealthRows([
      {
        inventory_id: "inv-1",
        workspace_id: "ws-1",
        branch_id: "01",
        part_number: "P-100",
        qty_on_hand: "0",
        bin_location: "A1",
        catalog_id: "cat-1",
        reorder_point: "3",
        safety_stock: "1",
        economic_order_qty: "10",
        consumption_velocity: "0.5",
        avg_lead_time_days: "4",
        reorder_computed_at: "2026-05-03",
        stock_status: "bad",
        days_until_stockout: "0",
      },
    ])).toEqual([
      {
        inventory_id: "inv-1",
        workspace_id: "ws-1",
        branch_id: "01",
        part_number: "P-100",
        qty_on_hand: 0,
        bin_location: "A1",
        catalog_id: "cat-1",
        reorder_point: 3,
        safety_stock: 1,
        economic_order_qty: 10,
        consumption_velocity: 0.5,
        avg_lead_time_days: 4,
        reorder_computed_at: "2026-05-03",
        stock_status: "stockout",
        days_until_stockout: 0,
      },
    ]);

    expect(normalizeVendorMetricsRows([
      { id: "vendor-1", name: "Vendor", avg_lead_time_hours: "24", responsiveness_score: "0.5", fill_rate: "0.9", price_competitiveness: "0.8", composite_score: "0.7", machine_down_priority: true },
      { id: "bad" },
    ])).toEqual([
      {
        id: "vendor-1",
        name: "Vendor",
        avg_lead_time_hours: 24,
        responsiveness_score: 0.5,
        fill_rate: 0.9,
        price_competitiveness: 0.8,
        composite_score: 0.7,
        machine_down_priority: true,
      },
    ]);
  });

  test("normalizes parts order list rows with joined customer/company arrays", () => {
    expect(normalizePartsOrderListRows([
      {
        id: "order-1",
        status: "submitted",
        order_source: "portal",
        fulfillment_run_id: "run-1",
        line_items: [{ part_number: "P-100" }],
        created_at: "2026-05-03T12:00:00Z",
        portal_customer_id: "pc-1",
        crm_company_id: "co-1",
        portal_customers: [{ first_name: "Ann", last_name: "Smith", email: "ann@example.test" }],
        crm_companies: [{ id: "co-1", name: "Tiger" }],
      },
      { id: "bad", status: "submitted" },
    ])).toEqual([
      {
        id: "order-1",
        status: "submitted",
        order_source: "portal",
        fulfillment_run_id: "run-1",
        line_items: [{ part_number: "P-100" }],
        created_at: "2026-05-03T12:00:00Z",
        portal_customer_id: "pc-1",
        crm_company_id: "co-1",
        portal_customers: { first_name: "Ann", last_name: "Smith", email: "ann@example.test" },
        crm_companies: { id: "co-1", name: "Tiger" },
      },
    ]);
  });

  test("normalizes parts order manager edge responses and rejects malformed required payloads", () => {
    expect(normalizeOrderManagerOrderResult({ order: { id: "order-1" } })).toEqual({
      order: { id: "order-1" },
    });
    expect(normalizeOrderManagerSubmitResult({
      order: { id: "order-1" },
      fulfillment_run_id: "fulfill-1",
    })).toEqual({
      order: { id: "order-1" },
      fulfillment_run_id: "fulfill-1",
    });
    expect(normalizeOrderManagerLinesResult({ lines: "3" })).toEqual({ lines: 3 });
    expect(normalizeOrderManagerPickResult({
      picked: {
        line_id: "line-1",
        part_number: "P-100",
        quantity: "2",
        branch_id: "01",
      },
    })).toEqual({
      picked: {
        line_id: "line-1",
        part_number: "P-100",
        quantity: 2,
        branch_id: "01",
      },
    });
    expect(() => normalizeOrderManagerOrderResult({})).toThrow("missing order");
    expect(() => normalizeOrderManagerLinesResult({ lines: "bad" })).toThrow("missing line count");
  });

  test("normalizes voice parts order edge responses with safe defaults", () => {
    expect(normalizeVoicePartsOrderResult({
      order_id: "order-1",
      extraction: {
        parts: [{ description: "left track pad", quantity: "2" }, { quantity: 1 }],
        is_machine_down: true,
        customer_name: "Tiger",
      },
      matches: [
        { input_description: "left track pad", matched_part: "P-100", confidence: "high" },
        { matched_part: "bad" },
      ],
      is_machine_down: true,
      auto_submitted: true,
    })).toEqual({
      order_id: "order-1",
      extraction: {
        parts: [{ description: "left track pad", quantity: 2 }],
        is_machine_down: true,
        customer_name: "Tiger",
      },
      matches: [{ input_description: "left track pad", matched_part: "P-100", confidence: "high" }],
      is_machine_down: true,
      auto_submitted: true,
    });

    expect(normalizeVoicePartsOrderResult({ extraction: "bad" })).toEqual({
      order_id: "",
      extraction: {
        parts: [],
        is_machine_down: false,
        customer_name: null,
      },
      matches: [],
      is_machine_down: false,
      auto_submitted: false,
    });
  });

  test("normalizes photo identification edge responses", () => {
    expect(normalizePhotoPartIdentificationResult({
      identification: {
        identified_parts: [
          {
            description: "Hydraulic filter",
            part_type: "filter",
            condition: "worn",
            wear_indicators: ["rust", 123],
            confidence: "0.82",
          },
          { part_type: "missing description" },
        ],
        equipment_context: { make: "Deere", model: "333G", system: "hydraulics" },
      },
      catalog_matches: [
        {
          part_number: "P-100",
          description: "Filter",
          category: "Hydraulics",
          list_price: "25.5",
          match_score: "0.91",
          match_reason: "visual",
          inventory: [{ branch_id: "01", qty_on_hand: "4" }, { qty_on_hand: "bad" }],
          substitutes: [{ part_number: "P-200", relationship: "interchangeable" }, { part_number: "bad" }],
        },
      ],
      has_matches: false,
    })).toEqual({
      identification: {
        identified_parts: [
          {
            description: "Hydraulic filter",
            part_type: "filter",
            condition: "worn",
            wear_indicators: ["rust"],
            confidence: 0.82,
          },
        ],
        equipment_context: { make: "Deere", model: "333G", system: "hydraulics" },
      },
      catalog_matches: [
        {
          part_number: "P-100",
          description: "Filter",
          category: "Hydraulics",
          list_price: 25.5,
          match_score: 0.91,
          match_reason: "visual",
          inventory: [{ branch_id: "01", qty_on_hand: 4 }],
          substitutes: [{ part_number: "P-200", relationship: "interchangeable" }],
        },
      ],
      has_matches: true,
    });
  });

  test("returns empty defaults for malformed inputs", () => {
    expect(normalizeForecastRows({})).toEqual([]);
    expect(normalizeOrderEvents(null)).toEqual([]);
    expect(normalizeAnalyticsSnapshot({ id: "missing date" })).toBeNull();
    expect(normalizePartActivityRows("bad")).toEqual([]);
    expect(normalizeCustomerPartsIntel(undefined)).toBeNull();
  });
});
