import { describe, expect, test } from "bun:test";
import {
  getCreatedPortalOrderId,
  getPortalErrorMessage,
  normalizePortalActiveDeals,
  normalizePortalCheckoutResponse,
  normalizeEquipmentDocuments,
  normalizeMachineHistoryRows,
  normalizePortalFleetPickerRows,
  normalizePortalFleetDetailItems,
  normalizePortalFleetItems,
  normalizePortalInvoiceRecord,
  normalizePortalPmKitSuggestion,
  normalizePortalServiceRequestsPayload,
  normalizePortalServiceTimelinePayload,
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

  test("normalizes active deals and portal statuses", () => {
    expect(normalizePortalActiveDeals([
      {
        deal_id: "deal-1",
        deal_name: "Compact loader",
        amount: "120000",
        portal_status: {
          label: "Quote review",
          source: "quote_review",
          source_label: "Quote",
          eta: "2026-05-10T00:00:00Z",
          next_action: "Review terms",
        },
      },
      { deal_id: "missing-name" },
    ])).toEqual([{
      deal_id: "deal-1",
      deal_name: "Compact loader",
      amount: 120000,
      expected_close_on: null,
      next_follow_up_at: null,
      quote_review_id: null,
      quote_review_status: null,
      portal_status: {
        label: "Quote review",
        source: "quote_review",
        source_label: "Quote",
        eta: "2026-05-10T00:00:00Z",
        last_updated_at: null,
        next_action: "Review terms",
      },
    }]);
  });

  test("normalizes invoice detail nested rows", () => {
    expect(normalizePortalInvoiceRecord({
      invoice_number: "INV-1",
      customer_invoice_line_items: [
        { id: "line-1", description: "Labor", quantity: "2", unit_price: "120", line_total: "240" },
        { line_total: "bad" },
      ],
      portal_payment_history: [{ label: "Payment", amount: "100", status: "paid", created_at: "2026-05-01T00:00:00Z" }],
      portal_invoice_timeline: [{ label: "Issued", detail: "Invoice sent", at: "2026-05-01T00:00:00Z", tone: "blue" }],
    })).toMatchObject({
      invoice_number: "INV-1",
      customer_invoice_line_items: [{ id: "line-1", description: "Labor", quantity: 2, unit_price: 120, line_total: 240 }],
      portal_payment_history: [{ label: "Payment", amount: 100, status: "paid", created_at: "2026-05-01T00:00:00Z", resolved_at: null }],
      portal_invoice_timeline: [{ label: "Issued", detail: "Invoice sent", at: "2026-05-01T00:00:00Z", tone: "blue" }],
    });
  });

  test("normalizes service request payloads and timeline events", () => {
    expect(normalizePortalServiceRequestsPayload({
      open_requests: [{
        id: "req-1",
        request_type: "",
        description: "Hydraulic leak",
        internal_job: [{ id: "job-1", current_stage: "in_progress" }],
        portal_status: { label: "In progress", source: "service_job", source_label: "Shop" },
        workspace_timeline: { branch_label: "Lake City", next_step: "Tech assigned" },
        photo_count: "2",
      }],
      workspace_summary: { open_count: "1", completed_count: "3", blocked_count: "0" },
    })).toMatchObject({
      open_requests: [{
        id: "req-1",
        request_type: "service",
        description: "Hydraulic leak",
        internal_job: { id: "job-1", current_stage: "in_progress" },
        photo_count: 2,
      }],
      workspace_summary: { open_count: 1, completed_count: 3, blocked_count: 0 },
    });

    expect(normalizePortalServiceTimelinePayload({
      ok: true,
      service_job_id: "job-1",
      events: [
        { id: "event-1", event_type: "stage_transition", created_at: "2026-05-01T00:00:00Z", customer_label: "In shop", new_stage: "in_progress" },
        { id: "bad" },
      ],
    })).toEqual({
      ok: true,
      service_job_id: "job-1",
      events: [{
        id: "event-1",
        event_type: "stage_transition",
        created_at: "2026-05-01T00:00:00Z",
        customer_label: "In shop",
        new_stage: "in_progress",
      }],
    });
  });

  test("normalizes fleet picker, PM kit, checkout, and generic portal helpers", () => {
    expect(normalizePortalFleetPickerRows([{ id: "fleet-1", make: "", model: "333G", year: "2024", serial_number: "SN" }])).toEqual([
      { id: "fleet-1", make: "Equipment", model: "333G", year: 2024, serial_number: "SN" },
    ]);

    expect(normalizePortalPmKitSuggestion({
      ok: true,
      ai_suggested_pm_kit: true,
      ai_suggestion_reason: "500 hour interval",
      line_items: [{ part_number: "P-1", quantity: "2" }, { quantity: 1 }],
      matched_job_code: { id: "job-code-1", job_name: "500 hour service", make: "Deere" },
    })).toMatchObject({
      ok: true,
      line_items: [{ part_number: "P-1", quantity: 2 }],
      matched_job_code: { id: "job-code-1", job_name: "500 hour service", make: "Deere" },
    });

    expect(getCreatedPortalOrderId({ order: { id: "order-1" } })).toBe("order-1");
    expect(normalizePortalCheckoutResponse({ url: "https://checkout.test", stripe_configured: true })).toEqual({
      url: "https://checkout.test",
      fallback: undefined,
      stripe_configured: true,
      stripe_error: undefined,
      message: undefined,
    });
    expect(getPortalErrorMessage({ error: "No access" })).toBe("No access");
  });
});
