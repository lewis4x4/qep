import { describe, expect, test } from "bun:test";
import {
  normalizeEquipmentDocuments,
  normalizeMachineHistoryRows,
  normalizePortalFleetDetailItems,
  normalizePortalFleetItems,
} from "./portal-row-normalizers";

describe("portal row normalizers", () => {
  test("normalizes portal fleet map rows", () => {
    expect(normalizePortalFleetItems([
      {
        id: "fleet-1",
        name: "Loader",
        make: "John Deere",
        model: "644",
        year: "2024",
        engine_hours: "123.5",
        stage_label: "In service",
        last_lat: "38.2527",
        last_lng: "-85.7585",
      },
      { id: "", name: "bad" },
      null,
    ])).toEqual([
      {
        id: "fleet-1",
        name: "Loader",
        make: "John Deere",
        model: "644",
        year: 2024,
        engine_hours: 123.5,
        stage_label: "In service",
        last_lat: 38.2527,
        last_lng: -85.7585,
      },
    ]);
  });

  test("normalizes portal equipment detail rows with nested status and schedules", () => {
    expect(normalizePortalFleetDetailItems([
      {
        id: "fleet-1",
        equipment_id: "eq-1",
        make: "Deere",
        model: "333G",
        name: "Track loader",
        year: "2023",
        serial_number: "SN123",
        current_hours: "412.75",
        warranty_expiry: "2027-01-01",
        next_service_due: "2026-06-01",
        trade_in_interest: true,
        portal_status: [{
          label: "In shop",
          source_label: "Live shop status",
          eta: "2026-05-10",
          last_updated_at: "2026-05-03T12:00:00Z",
        }],
        maintenance_schedules: [
          { id: "maint-1", label: "500 hour service", next_due_date: "2026-06-01", next_due_hours: "500" },
          { id: null },
        ],
      },
      { make: "missing id" },
    ])).toEqual([
      {
        id: "fleet-1",
        equipment_id: "eq-1",
        make: "Deere",
        model: "333G",
        name: "Track loader",
        year: 2023,
        serial_number: "SN123",
        current_hours: 412.75,
        warranty_expiry: "2027-01-01",
        next_service_due: "2026-06-01",
        trade_in_interest: true,
        portal_status: {
          label: "In shop",
          source_label: "Live shop status",
          eta: "2026-05-10",
          last_updated_at: "2026-05-03T12:00:00Z",
        },
        maintenance_schedules: [
          {
            id: "maint-1",
            label: "500 hour service",
            next_due_date: "2026-06-01",
            next_due_hours: 500,
          },
        ],
      },
    ]);
  });

  test("normalizes equipment documents and falls back unknown document types", () => {
    expect(normalizeEquipmentDocuments([
      {
        id: "doc-1",
        fleet_id: "fleet-1",
        crm_equipment_id: "crm-1",
        document_type: "unexpected",
        title: "Warranty",
        description: "Coverage proof",
        file_url: "https://example.test/warranty.pdf",
        file_size_bytes: "2048",
        mime_type: "application/pdf",
        customer_visible: true,
        created_at: "2026-05-03T12:00:00Z",
        portal_visibility: {
          label: "Published",
          detail: "Visible to customer",
          released_at: "2026-05-03",
        },
      },
      { id: "doc-2", title: "missing file url", created_at: "2026-05-03" },
    ])).toEqual([
      {
        id: "doc-1",
        fleet_id: "fleet-1",
        crm_equipment_id: "crm-1",
        document_type: "other",
        title: "Warranty",
        description: "Coverage proof",
        file_url: "https://example.test/warranty.pdf",
        file_size_bytes: 2048,
        mime_type: "application/pdf",
        customer_visible: true,
        created_at: "2026-05-03T12:00:00Z",
        portal_visibility: {
          label: "Published",
          detail: "Visible to customer",
          released_at: "2026-05-03",
        },
      },
    ]);
  });

  test("normalizes machine history rows and recent line item shapes", () => {
    expect(normalizeMachineHistoryRows([
      {
        fleet_id: "fleet-1",
        make: "Deere",
        model: "8R",
        year: "2022",
        serial_number: "SN8R",
        last_ordered_at: "2026-04-01",
        total_orders: "3",
        recent_line_items: [
          {
            created_at: "2026-04-01",
            li: [
              { part_number: "P-100", quantity: "2", description: "Filter", unit_price: "10.5" },
              { description: "missing part" },
            ],
          },
          {
            created_at: "2026-03-01",
            li: { part_number: "P-200", quantity: "1" },
          },
          { created_at: "2026-02-01", li: "bad" },
        ],
      },
      { fleet_id: "", total_orders: "2" },
    ])).toEqual([
      {
        fleet_id: "fleet-1",
        make: "Deere",
        model: "8R",
        year: 2022,
        serial_number: "SN8R",
        last_ordered_at: "2026-04-01",
        total_orders: 3,
        recent_line_items: [
          {
            created_at: "2026-04-01",
            li: [
              {
                part_number: "P-100",
                quantity: 2,
                description: "Filter",
                unit_price: 10.5,
              },
            ],
          },
          {
            created_at: "2026-03-01",
            li: {
              part_number: "P-200",
              quantity: 1,
            },
          },
        ],
      },
    ]);
  });

  test("returns empty arrays for malformed non-array inputs", () => {
    expect(normalizePortalFleetItems({})).toEqual([]);
    expect(normalizePortalFleetDetailItems(null)).toEqual([]);
    expect(normalizeEquipmentDocuments("bad")).toEqual([]);
    expect(normalizeMachineHistoryRows(undefined)).toEqual([]);
  });
});
