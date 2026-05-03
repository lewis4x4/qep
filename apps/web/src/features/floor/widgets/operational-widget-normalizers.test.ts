import { describe, expect, test } from "bun:test";
import {
  normalizeOperationalCustomerPartsIntelRows,
  normalizeOperationalInvoiceRows,
  normalizeOperationalMorningBriefData,
  normalizeOperationalVendorRows,
} from "./operational-widget-normalizers";

describe("operational floor widget normalizers", () => {
  test("normalizes morning brief RPC payloads", () => {
    expect(normalizeOperationalMorningBriefData({
      count: "5",
      events: [
        { type: "quote_won", summary: "Quote won", at: "2026-05-03T12:00:00.000Z" },
        { type: "bad", summary: "", at: "2026-05-03T12:00:00.000Z" },
      ],
    })).toEqual({
      count: 5,
      events: [
        { type: "quote_won", summary: "Quote won", at: "2026-05-03T12:00:00.000Z" },
      ],
    });
    expect(normalizeOperationalMorningBriefData(null)).toEqual({ count: 0, events: [] });
  });

  test("normalizes customer parts intelligence rows and joined companies", () => {
    expect(normalizeOperationalCustomerPartsIntelRows([
      {
        id: "intel-1",
        crm_company_id: "company-1",
        churn_risk: "high",
        spend_trend: "up",
        order_count_12m: "12",
        total_spend_12m: "12000",
        predicted_next_quarter_spend: "4500",
        opportunity_value: "2000",
        days_since_last_order: "33",
        recommended_outreach: "Call buyer",
        computed_at: "2026-05-03T12:00:00.000Z",
        crm_companies: [{ id: "company-1", name: "Tigercat Logistics" }],
      },
      { id: "missing-company", computed_at: "2026-05-03T12:00:00.000Z" },
    ])).toEqual([
      {
        id: "intel-1",
        crm_company_id: "company-1",
        churn_risk: "high",
        spend_trend: "up",
        order_count_12m: 12,
        total_spend_12m: 12000,
        predicted_next_quarter_spend: 4500,
        opportunity_value: 2000,
        days_since_last_order: 33,
        recommended_outreach: "Call buyer",
        computed_at: "2026-05-03T12:00:00.000Z",
        crm_companies: { id: "company-1", name: "Tigercat Logistics" },
      },
    ]);
  });

  test("normalizes pending invoice rows", () => {
    expect(normalizeOperationalInvoiceRows([
      {
        id: "invoice-1",
        invoice_number: "INV-100",
        status: "overdue",
        total: "1500",
        balance_due: "500",
        due_date: "2026-05-01",
        created_at: "2026-04-01T00:00:00.000Z",
        crm_companies: { name: "Tigercat Logistics" },
      },
      { id: "bad", invoice_number: "INV-101", status: "draft" },
    ])).toEqual([
      {
        id: "invoice-1",
        invoice_number: "INV-100",
        status: "overdue",
        total: 1500,
        balance_due: 500,
        due_date: "2026-05-01",
        created_at: "2026-04-01T00:00:00.000Z",
        crm_companies: { name: "Tigercat Logistics" },
      },
    ]);
  });

  test("normalizes supplier health rows", () => {
    expect(normalizeOperationalVendorRows([
      {
        id: "vendor-1",
        name: "Reliable Parts",
        avg_lead_time_hours: "24",
        responsiveness_score: "0.9",
        fill_rate: "0.95",
        composite_score: "0.92",
        machine_down_priority: true,
      },
      { id: "", name: "Bad vendor" },
    ])).toEqual([
      {
        id: "vendor-1",
        name: "Reliable Parts",
        avg_lead_time_hours: 24,
        responsiveness_score: 0.9,
        fill_rate: 0.95,
        composite_score: 0.92,
        machine_down_priority: true,
      },
    ]);
  });

  test("returns empty arrays for non-array row payloads", () => {
    expect(normalizeOperationalCustomerPartsIntelRows(null)).toEqual([]);
    expect(normalizeOperationalInvoiceRows({ id: "invoice-1" })).toEqual([]);
    expect(normalizeOperationalVendorRows(undefined)).toEqual([]);
  });
});
