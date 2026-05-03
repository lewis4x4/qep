import { describe, expect, test } from "bun:test";
import {
  normalizeCustomerResults,
  normalizeEquipmentResults,
  normalizePartsQueueItems,
} from "./service-hook-normalizers";

describe("service hook normalizers", () => {
  test("normalizes customer search rows and filters malformed companies", () => {
    expect(normalizeCustomerResults([
      { id: "cust-1", name: "Evergreen Farms", phone: "555-0100", city: "Ocala", state: "FL" },
      { id: "bad", name: "" },
    ])).toEqual([
      { id: "cust-1", name: "Evergreen Farms", phone: "555-0100", city: "Ocala", state: "FL" },
    ]);
  });

  test("normalizes equipment rows with numeric year coercion", () => {
    expect(normalizeEquipmentResults([
      {
        id: "eq-1",
        make: "Kubota",
        model: "KX080",
        serial_number: "SER-1",
        year: "2024",
        company_id: "cust-1",
      },
      { id: "bad", make: "Kubota", model: "", serial_number: "SER-2" },
    ])).toEqual([
      {
        id: "eq-1",
        make: "Kubota",
        model: "KX080",
        serial_number: "SER-1",
        year: 2024,
        customer_id: "cust-1",
      },
    ]);
  });

  test("normalizes parts queue rows and excludes suggested intake lines", () => {
    const rows = normalizePartsQueueItems([
      {
        id: "req-1",
        job_id: "job-1",
        part_number: "P-100",
        description: "Filter",
        quantity: "2",
        status: "ordered",
        need_by_date: "2026-05-04",
        confidence: "high",
        vendor_id: "vendor-1",
        intake_line_status: "accepted",
        job: {
          id: "job-1",
          fulfillment_run_id: null,
          customer_problem_summary: "Hydraulic leak",
          priority: "urgent",
          status_flags: ["machine_down", 42],
          customer: [{ id: "cust-1", name: "Evergreen Farms" }],
          machine: { id: "eq-1", make: "Kubota", model: "KX080", serial_number: "SER-1" },
        },
        actions: [
          { id: "act-1", action_type: "order", completed_at: null, expected_date: "2026-05-04", po_reference: "PO-1" },
          { id: "bad-action", action_type: "" },
        ],
        staging: [
          { bin_location: "A1", staged_at: "2026-05-03T10:00:00.000Z" },
          { bin_location: "B1" },
        ],
      },
      {
        id: "req-2",
        job_id: "job-2",
        part_number: "P-200",
        quantity: 1,
        status: "requested",
        confidence: "medium",
        intake_line_status: "suggested",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(2);
    expect(rows[0].job?.status_flags).toEqual(["machine_down"]);
    expect(rows[0].job?.customer?.name).toBe("Evergreen Farms");
    expect(rows[0].actions).toEqual([
      { id: "act-1", action_type: "order", completed_at: null, expected_date: "2026-05-04", po_reference: "PO-1" },
    ]);
    expect(rows[0].staging).toEqual([
      { bin_location: "A1", staged_at: "2026-05-03T10:00:00.000Z" },
    ]);
  });

  test("returns empty arrays for malformed payloads", () => {
    expect(normalizeCustomerResults(null)).toEqual([]);
    expect(normalizeEquipmentResults({})).toEqual([]);
    expect(normalizePartsQueueItems("bad")).toEqual([]);
  });
});
