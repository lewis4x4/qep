import { describe, expect, test } from "bun:test";
import {
  normalizeSupplierHealthRows,
  normalizeSupplierHealthSummary,
} from "./supplier-health-api-normalizers";

const validRow = {
  vendor_id: "vendor-1",
  vendor_name: "Vendor One",
  supplier_type: "oem",
  avg_lead_time_hours: "24",
  responsiveness_score: "0.9",
  profile_fill_rate: "0.95",
  price_competitiveness: "0.8",
  profile_composite_score: "0.88",
  catalog_parts: "100",
  parts_compared: "80",
  parts_up: "20",
  parts_up_more_than_5pct: "10",
  price_change_pct_yoy: "0.12",
  replenish_items_90d: "30",
  replenish_items_ordered: "25",
  fill_rate_pct_90d: "0.83",
  avg_approve_to_order_hours: "4",
  last_price_file_at: "2026-05-01T00:00:00.000Z",
  days_since_last_price_file: "2",
  health_tier: "red",
};

describe("supplier health API normalizers", () => {
  test("normalizes supplier health rows and validates tiers", () => {
    expect(normalizeSupplierHealthRows([
      validRow,
      { ...validRow, vendor_id: "vendor-2", health_tier: "bad" },
      { vendor_id: "bad" },
    ])).toEqual([
      {
        vendor_id: "vendor-1",
        vendor_name: "Vendor One",
        supplier_type: "oem",
        avg_lead_time_hours: 24,
        responsiveness_score: 0.9,
        profile_fill_rate: 0.95,
        price_competitiveness: 0.8,
        profile_composite_score: 0.88,
        catalog_parts: 100,
        parts_compared: 80,
        parts_up: 20,
        parts_up_more_than_5pct: 10,
        price_change_pct_yoy: 0.12,
        replenish_items_90d: 30,
        replenish_items_ordered: 25,
        fill_rate_pct_90d: 0.83,
        avg_approve_to_order_hours: 4,
        last_price_file_at: "2026-05-01T00:00:00.000Z",
        days_since_last_price_file: 2,
        health_tier: "red",
      },
      {
        vendor_id: "vendor-2",
        vendor_name: "Vendor One",
        supplier_type: "oem",
        avg_lead_time_hours: 24,
        responsiveness_score: 0.9,
        profile_fill_rate: 0.95,
        price_competitiveness: 0.8,
        profile_composite_score: 0.88,
        catalog_parts: 100,
        parts_compared: 80,
        parts_up: 20,
        parts_up_more_than_5pct: 10,
        price_change_pct_yoy: 0.12,
        replenish_items_90d: 30,
        replenish_items_ordered: 25,
        fill_rate_pct_90d: 0.83,
        avg_approve_to_order_hours: 4,
        last_price_file_at: "2026-05-01T00:00:00.000Z",
        days_since_last_price_file: 2,
        health_tier: "yellow",
      },
    ]);
  });

  test("normalizes supplier health summary collections", () => {
    expect(normalizeSupplierHealthSummary({
      generated_at: "2026-05-03T12:00:00.000Z",
      workspace_id: "default",
      counts: { green: "1", yellow: "2", red: "3", total: "6" },
      red_vendors: [validRow, { vendor_name: "Missing id" }],
      top_price_creep: [validRow],
      lowest_fill_rate: [validRow],
      rows: [validRow],
    })).toEqual({
      generated_at: "2026-05-03T12:00:00.000Z",
      workspace_id: "default",
      counts: { green: 1, yellow: 2, red: 3, total: 6 },
      red_vendors: [
        {
          vendor_id: "vendor-1",
          vendor_name: "Vendor One",
          price_change_pct_yoy: 0.12,
          fill_rate_pct_90d: 0.83,
          days_since_last_price_file: 2,
          health_tier: "red",
        },
      ],
      top_price_creep: [
        {
          vendor_id: "vendor-1",
          vendor_name: "Vendor One",
          price_change_pct_yoy: 0.12,
          parts_up_more_than_5pct: 10,
          parts_compared: 80,
        },
      ],
      lowest_fill_rate: [
        {
          vendor_id: "vendor-1",
          vendor_name: "Vendor One",
          fill_rate_pct_90d: 0.83,
          replenish_items_90d: 30,
          replenish_items_ordered: 25,
        },
      ],
      rows: normalizeSupplierHealthRows([validRow]),
    });
  });

  test("returns safe empty supplier health defaults for malformed inputs", () => {
    expect(normalizeSupplierHealthRows(null)).toEqual([]);
    expect(normalizeSupplierHealthSummary(null)).toEqual({
      generated_at: "",
      workspace_id: "default",
      counts: { green: 0, yellow: 0, red: 0, total: 0 },
      red_vendors: [],
      top_price_creep: [],
      lowest_fill_rate: [],
      rows: [],
    });
  });
});
