import { describe, expect, test } from "bun:test";
import {
  normalizeApprovedRowsResult,
  normalizeOrderedRowsResult,
  normalizeRejectedRowsResult,
  normalizeReplenishRows,
  normalizeReplenishSummary,
  normalizeUpdatedQtyResult,
} from "./replenish-api-normalizers";

const validRow = {
  id: "row-1",
  part_number: "P-100",
  branch_id: "LOU",
  qty_on_hand: "2",
  reorder_point: "5",
  recommended_qty: "10",
  selected_vendor_id: "vendor-1",
  vendor_name: "Vendor One",
  vendor_selection_reason: "Best price",
  estimated_unit_cost: "12.5",
  estimated_total: "125",
  status: "scheduled",
  scheduled_for: "2026-05-04",
  forecast_driven: true,
  forecast_covered_days: "30",
  vendor_price_corroborated: true,
  cdk_vendor_list_price: "14",
  potential_overpay_flag: true,
  source_type: "predictive_play",
  originating_play_id: "play-1",
  po_reference: "PO-1",
  part_description: "Filter",
  live_on_hand: "3",
  current_list_price: "20",
  play_reason: "Upcoming service",
  play_projected_due: "2026-05-20",
  play_probability: "0.8",
  customer_machine_make: "Deere",
  customer_machine_model: "333G",
  customer_machine_hours: "1200",
  customer_name: "Tigercat Logistics",
  created_at: "2026-05-03T12:00:00.000Z",
  ordered_at: null,
  approved_at: "2026-05-03T13:00:00.000Z",
};

describe("replenish API normalizers", () => {
  test("normalizes replenish summary RPC payloads", () => {
    expect(normalizeReplenishSummary({
      kpis: {
        pending: "1",
        scheduled: "2",
        auto_approved: "3",
        approved: "4",
        ordered: "5",
        overpay_flags: "6",
        from_predictive: "7",
        total_draft_value: "8000",
      },
      by_vendor: [
        {
          vendor_name: "Vendor One",
          selected_vendor_id: "vendor-1",
          item_count: "10",
          total_usd: "1250",
          next_order_date: "2026-05-04",
          overpay_items: "1",
          play_items: "2",
          pending_items: "3",
          scheduled_items: "4",
          auto_approved_items: "5",
        },
      ],
    })).toEqual({
      kpis: {
        pending: 1,
        scheduled: 2,
        auto_approved: 3,
        approved: 4,
        ordered: 5,
        overpay_flags: 6,
        from_predictive: 7,
        total_draft_value: 8000,
      },
      by_vendor: [
        {
          vendor_name: "Vendor One",
          selected_vendor_id: "vendor-1",
          item_count: 10,
          total_usd: 1250,
          next_order_date: "2026-05-04",
          overpay_items: 1,
          play_items: 2,
          pending_items: 3,
          scheduled_items: 4,
          auto_approved_items: 5,
        },
      ],
    });
  });

  test("normalizes enriched replenish rows and validates enums", () => {
    expect(normalizeReplenishRows([
      validRow,
      {
        ...validRow,
        id: "row-2",
        status: "unknown",
        source_type: "bad",
        forecast_driven: "yes",
        potential_overpay_flag: "true",
      },
      { id: "bad", part_number: "P-101", branch_id: "LOU" },
    ])).toEqual([
      {
        id: "row-1",
        part_number: "P-100",
        branch_id: "LOU",
        qty_on_hand: 2,
        reorder_point: 5,
        recommended_qty: 10,
        selected_vendor_id: "vendor-1",
        vendor_name: "Vendor One",
        vendor_selection_reason: "Best price",
        estimated_unit_cost: 12.5,
        estimated_total: 125,
        status: "scheduled",
        scheduled_for: "2026-05-04",
        forecast_driven: true,
        forecast_covered_days: 30,
        vendor_price_corroborated: true,
        cdk_vendor_list_price: 14,
        potential_overpay_flag: true,
        source_type: "predictive_play",
        originating_play_id: "play-1",
        po_reference: "PO-1",
        part_description: "Filter",
        live_on_hand: 3,
        current_list_price: 20,
        play_reason: "Upcoming service",
        play_projected_due: "2026-05-20",
        play_probability: 0.8,
        customer_machine_make: "Deere",
        customer_machine_model: "333G",
        customer_machine_hours: 1200,
        customer_name: "Tigercat Logistics",
        created_at: "2026-05-03T12:00:00.000Z",
        ordered_at: null,
        approved_at: "2026-05-03T13:00:00.000Z",
      },
      {
        ...normalizeReplenishRows([validRow])[0],
        id: "row-2",
        status: "pending",
        forecast_driven: false,
        potential_overpay_flag: false,
        source_type: "manual_entry",
      },
    ]);
  });

  test("normalizes mutation result counts", () => {
    expect(normalizeApprovedRowsResult({ approved_count: "3" })).toEqual({ approved_count: 3 });
    expect(normalizeRejectedRowsResult({ rejected_count: "4" })).toEqual({ rejected_count: 4 });
    expect(normalizeOrderedRowsResult({ ordered_count: "5" })).toEqual({ ordered_count: 5 });
    expect(normalizeUpdatedQtyResult({ new_qty: "6", new_total: "75.5" })).toEqual({ new_qty: 6, new_total: 75.5 });
  });

  test("returns safe empty replenish values for malformed inputs", () => {
    expect(normalizeReplenishRows(null)).toEqual([]);
    expect(normalizeReplenishSummary(null)).toEqual({
      kpis: {
        pending: 0,
        scheduled: 0,
        auto_approved: 0,
        approved: 0,
        ordered: 0,
        overpay_flags: 0,
        from_predictive: 0,
        total_draft_value: 0,
      },
      by_vendor: [],
    });
  });
});
