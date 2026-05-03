import { describe, expect, test } from "bun:test";
import {
  normalizeEligibleDeals,
  normalizeGenerationResult,
  normalizePlaybookDetail,
  normalizePlaybookPayload,
  normalizePlaybookRows,
  normalizePlaybookSummary,
} from "./post-sale-api-normalizers";

const validRow = {
  id: "playbook-1",
  deal_id: "deal-1",
  equipment_id: "equipment-1",
  status: "sent",
  total_revenue: "1500",
  generated_by: "user-1",
  created_at: "2026-05-03T12:00:00.000Z",
  sent_at: "2026-05-03T13:00:00.000Z",
  deal_name: "Loader deal",
  company_name: "Tigercat Logistics",
  make: "Deere",
  model: "333G",
  year: "2024",
  rep_name: "Rep One",
};

const validPayload = {
  windows: [
    {
      window: "60d",
      narrative: "Service kit likely",
      service_description: "Upcoming maintenance",
      total_revenue: "750",
      parts: [
        {
          part_number: "P-100",
          description: "Filter",
          qty: "2",
          unit_price: "50",
          total: "100",
          on_hand: "5",
          probability: "0.8",
          reason: "PM interval",
          match_score: "0.9",
        },
        { description: "Missing part number" },
      ],
    },
  ],
  grand_total_revenue: "1500",
  assumptions: { source: "test" },
  generated_at: "2026-05-03T12:00:00.000Z",
  machine_profile_id: "machine-1",
  model_family: "333",
  customer_name: "Tigercat Logistics",
};

describe("post-sale playbook API normalizers", () => {
  test("normalizes playbook summary rows and counts", () => {
    expect(normalizePlaybookSummary({
      counts: { draft: "2", sent: "3", bad: "not numeric" },
      open_revenue_usd: "12500",
      recent: [validRow, { id: "bad", deal_id: "deal-2" }],
      generated_at: "2026-05-03T12:00:00.000Z",
    })).toEqual({
      counts: { draft: 2, sent: 3 },
      open_revenue_usd: 12500,
      recent: [
        {
          id: "playbook-1",
          deal_id: "deal-1",
          equipment_id: "equipment-1",
          status: "sent",
          total_revenue: 1500,
          generated_by: "user-1",
          created_at: "2026-05-03T12:00:00.000Z",
          sent_at: "2026-05-03T13:00:00.000Z",
          deal_name: "Loader deal",
          company_name: "Tigercat Logistics",
          make: "Deere",
          model: "333G",
          year: 2024,
          rep_name: "Rep One",
        },
      ],
      generated_at: "2026-05-03T12:00:00.000Z",
    });

    expect(normalizePlaybookRows([{ ...validRow, id: "playbook-2", status: "bad" }])[0]?.status).toBe("draft");
  });

  test("normalizes eligible deals and filters malformed rows", () => {
    expect(normalizeEligibleDeals([
      {
        deal_id: "deal-1",
        company_id: "company-1",
        assigned_rep_id: "rep-1",
        equipment_id: "equipment-1",
        make: "Deere",
        model: "333G",
        closed_at: "2026-05-03T12:00:00.000Z",
      },
      { deal_id: "bad", closed_at: "2026-05-03T12:00:00.000Z" },
    ])).toEqual([
      {
        deal_id: "deal-1",
        company_id: "company-1",
        assigned_rep_id: "rep-1",
        equipment_id: "equipment-1",
        make: "Deere",
        model: "333G",
        closed_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes generation results", () => {
    expect(normalizeGenerationResult({
      ok: true,
      playbook_id: "playbook-1",
      status: "draft",
      total_revenue: "1500",
      window_count: "3",
      parts_count: "12",
      cached: true,
      elapsed_ms: "42",
    })).toEqual({
      ok: true,
      playbook_id: "playbook-1",
      status: "draft",
      total_revenue: 1500,
      window_count: 3,
      parts_count: 12,
      cached: true,
      elapsed_ms: 42,
    });
  });

  test("normalizes playbook payloads and detail rows", () => {
    expect(normalizePlaybookPayload(validPayload)).toEqual({
      windows: [
        {
          window: "60d",
          narrative: "Service kit likely",
          service_description: "Upcoming maintenance",
          total_revenue: 750,
          parts: [
            {
              part_number: "P-100",
              description: "Filter",
              qty: 2,
              unit_price: 50,
              total: 100,
              on_hand: 5,
              probability: 0.8,
              reason: "PM interval",
              match_score: 0.9,
            },
          ],
        },
      ],
      grand_total_revenue: 1500,
      assumptions: { source: "test" },
      generated_at: "2026-05-03T12:00:00.000Z",
      machine_profile_id: "machine-1",
      model_family: "333",
      customer_name: "Tigercat Logistics",
    });

    expect(normalizePlaybookDetail({
      id: "playbook-1",
      status: "draft",
      payload: validPayload,
      total_revenue: "1500",
      created_at: "2026-05-03T12:00:00.000Z",
      sent_at: null,
      deal_id: "deal-1",
      equipment_id: "equipment-1",
    })).toEqual({
      id: "playbook-1",
      status: "draft",
      payload: normalizePlaybookPayload(validPayload),
      total_revenue: 1500,
      created_at: "2026-05-03T12:00:00.000Z",
      sent_at: null,
      deal_id: "deal-1",
      equipment_id: "equipment-1",
    });
  });

  test("returns safe post-sale defaults for malformed inputs", () => {
    expect(normalizePlaybookRows(null)).toEqual([]);
    expect(normalizeEligibleDeals(undefined)).toEqual([]);
    expect(normalizePlaybookDetail({ id: "bad" })).toBeNull();
    expect(normalizePlaybookSummary(null)).toEqual({
      counts: {},
      open_revenue_usd: 0,
      recent: [],
      generated_at: "",
    });
  });
});
