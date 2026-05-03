import { describe, expect, test } from "bun:test";
import {
  normalizeIntakeResult,
  normalizePortalPartsOrderRows,
  normalizeShopInvoiceRow,
  normalizeShopInvoiceSummary,
} from "./service-page-normalizers";

describe("service page normalizers", () => {
  test("normalizes shop invoice rows and filters malformed line items", () => {
    expect(normalizeShopInvoiceRow({
      id: "inv-1",
      invoice_number: "SI-100",
      invoice_date: "2026-05-03",
      due_date: "2026-05-17",
      description: "Shop invoice",
      amount: "100",
      tax: "7.25",
      total: "107.25",
      status: "open",
      service_job_id: "job-1",
      crm_company_id: "cust-1",
      branch_id: "OCALA",
      customer_invoice_line_items: [
        {
          id: "line-1",
          line_number: "1",
          description: "Labor",
          quantity: "2",
          unit_price: "50",
          line_total: "100",
        },
        { id: "bad", line_number: 2, description: "" },
      ],
    })).toEqual({
      id: "inv-1",
      invoice_number: "SI-100",
      invoice_date: "2026-05-03",
      due_date: "2026-05-17",
      description: "Shop invoice",
      amount: 100,
      tax: 7.25,
      total: 107.25,
      status: "open",
      service_job_id: "job-1",
      crm_company_id: "cust-1",
      branch_id: "OCALA",
      customer_invoice_line_items: [
        {
          id: "line-1",
          line_number: 1,
          description: "Labor",
          quantity: 2,
          unit_price: 50,
          line_total: 100,
        },
      ],
    });
  });

  test("rejects malformed shop invoice rows", () => {
    expect(normalizeShopInvoiceRow(null)).toBeNull();
    expect(normalizeShopInvoiceRow({ id: "inv-1", invoice_number: "SI-100" })).toBeNull();
  });

  test("normalizes shop invoice summaries", () => {
    expect(normalizeShopInvoiceSummary({
      id: "inv-1",
      invoice_number: "SI-100",
      status: "pending",
    })).toEqual({
      id: "inv-1",
      invoice_number: "SI-100",
      status: "pending",
    });
    expect(normalizeShopInvoiceSummary({ id: "inv-1", invoice_number: "" })).toBeNull();
  });

  test("normalizes service intake edge responses with safe defaults", () => {
    expect(normalizeIntakeResult({
      machine: { id: "eq-1" },
      service_history: [{ id: "hist-1" }],
      suggested_job_codes: [
        {
          id: "code-1",
          job_name: "Hydraulic inspection",
          make: "Kubota",
          model_family: null,
          manufacturer_estimated_hours: "2.5",
          shop_average_hours: "3",
          parts_template: [{ part_number: "P-1" }],
          confidence_score: "0.87",
        },
        { id: "bad", job_name: "", make: "Kubota" },
      ],
      likely_parts: [{ part_number: "P-1" }],
      estimated_hours: "3",
      haul_required: true,
      confidence: "0.8",
      suggested_next_step: "Quote repair",
    })).toEqual({
      machine: { id: "eq-1" },
      service_history: [{ id: "hist-1" }],
      suggested_job_codes: [
        {
          id: "code-1",
          job_name: "Hydraulic inspection",
          make: "Kubota",
          model_family: null,
          manufacturer_estimated_hours: 2.5,
          shop_average_hours: 3,
          parts_template: [{ part_number: "P-1" }],
          confidence_score: 0.87,
        },
      ],
      likely_parts: [{ part_number: "P-1" }],
      estimated_hours: 3,
      haul_required: true,
      confidence: 0.8,
      suggested_next_step: "Quote repair",
    });
  });

  test("returns safe service intake defaults for malformed payloads", () => {
    expect(normalizeIntakeResult("bad")).toEqual({
      machine: null,
      service_history: [],
      suggested_job_codes: [],
      likely_parts: [],
      estimated_hours: null,
      haul_required: false,
      confidence: 0,
      suggested_next_step: "",
    });
  });

  test("normalizes portal parts order rows and joined portal/fleet relations", () => {
    expect(normalizePortalPartsOrderRows([
      {
        id: "order-1",
        status: "submitted",
        fulfillment_run_id: "run-1",
        line_items: [{ part_number: "P-100" }],
        ai_suggested_pm_kit: true,
        ai_suggestion_reason: "PM due",
        tracking_number: null,
        estimated_delivery: "2026-05-05",
        shipping_address: { city: "Ocala" },
        created_at: "2026-05-03T10:00:00.000Z",
        updated_at: "2026-05-03T11:00:00.000Z",
        portal_customers: [{ first_name: "Avery", last_name: "Lane", email: "avery@example.com" }],
        customer_fleet: { make: "Kubota", model: "KX080", serial_number: "SER-1" },
      },
      { id: "bad", status: "", created_at: "2026-05-03T10:00:00.000Z", updated_at: "2026-05-03T11:00:00.000Z" },
    ])).toEqual([
      {
        id: "order-1",
        status: "submitted",
        fulfillment_run_id: "run-1",
        line_items: [{ part_number: "P-100" }],
        ai_suggested_pm_kit: true,
        ai_suggestion_reason: "PM due",
        tracking_number: null,
        estimated_delivery: "2026-05-05",
        shipping_address: { city: "Ocala" },
        created_at: "2026-05-03T10:00:00.000Z",
        updated_at: "2026-05-03T11:00:00.000Z",
        portal_customers: { first_name: "Avery", last_name: "Lane", email: "avery@example.com" },
        customer_fleet: { make: "Kubota", model: "KX080", serial_number: "SER-1" },
      },
    ]);
  });

  test("returns empty portal parts orders for malformed payloads", () => {
    expect(normalizePortalPartsOrderRows(null)).toEqual([]);
  });
});
