import { describe, expect, test } from "bun:test";
import {
  normalizeCustomerActivityRows,
  normalizeCustomerEquipmentRows,
  normalizeDailyBriefing,
  normalizeDealStageOptions,
  normalizeTodayBriefing,
  normalizeRepCustomers,
  normalizeRepPipelineDeals,
} from "./sales-api-normalizers";

describe("sales API normalizers", () => {
  test("normalizes morning briefing rows with sales_today projection", () => {
    const briefing = normalizeTodayBriefing({
      id: "brief-1",
      briefing_date: "2026-05-03",
      content: "# Morning",
      data: {
        sales_today: {
          greeting: "Morning",
          priority_actions: [{ type: "call", customer_name: "ACME", deal_id: "deal-1", summary: "Call ACME" }],
          expiring_quotes: [{ quote_id: "quote-1", customer_name: "ACME", equipment: null, status: "open" }],
          opportunities: [{ type: "trade_up", summary: "Trade-up opportunity" }],
          prep_cards: [{ customer_id: "company-1", meeting_time: "2026-05-03T14:00:00Z", talking_points: ["Budget"] }],
          stats: { deals_in_pipeline: "4", quotes_sent_this_week: "2", total_pipeline_value: "125000" },
        },
      },
      created_at: "2026-05-03T12:00:00Z",
    });

    expect(briefing?.content).toBe("# Morning");
    expect(briefing?.briefing_content.stats).toEqual({
      deals_in_pipeline: 4,
      quotes_sent_this_week: 2,
      total_pipeline_value: 125000,
    });
    expect(briefing?.briefing_content.priority_actions).toHaveLength(1);
    expect(briefing?.briefing_content.prep_cards[0]?.talking_points).toEqual(["Budget"]);
  });

  test("derives safe stats for legacy morning briefing rows without sales_today", () => {
    const briefing = normalizeTodayBriefing({
      id: "brief-legacy",
      briefing_date: "2026-05-03",
      content: "# Legacy",
      data: { open_deal_count: "7", pipeline_total: "250000", quotes_sent_this_week: "3" },
      created_at: "2026-05-03T12:00:00Z",
    });

    expect(briefing?.briefing_content.priority_actions).toEqual([]);
    expect(briefing?.briefing_content.stats).toEqual({
      deals_in_pipeline: 7,
      quotes_sent_this_week: 3,
      total_pipeline_value: 250000,
    });
  });

  test("keeps deprecated daily briefing payload normalization", () => {
    const briefing = normalizeDailyBriefing({
      id: "brief-1",
      briefing_date: "2026-05-03",
      briefing_content: {
        greeting: "Morning",
        priority_actions: [{ type: "call", customer_name: "ACME", deal_id: "deal-1", summary: "Call ACME" }],
        expiring_quotes: [{ quote_id: "quote-1", customer_name: "ACME", equipment: null, status: "open" }],
        opportunities: [{ type: "trade_up", summary: "Trade-up opportunity" }],
        prep_cards: [{ customer_id: "company-1", meeting_time: "2026-05-03T14:00:00Z", talking_points: ["Budget"] }],
        stats: { deals_in_pipeline: "4", quotes_sent_this_week: "2", total_pipeline_value: "125000" },
      },
      created_at: "2026-05-03T12:00:00Z",
    });

    expect(briefing?.briefing_content.stats).toEqual({
      deals_in_pipeline: 4,
      quotes_sent_this_week: 2,
      total_pipeline_value: 125000,
    });
    expect(briefing?.briefing_content.priority_actions).toHaveLength(1);
    expect(briefing?.briefing_content.prep_cards[0]?.talking_points).toEqual(["Budget"]);
  });

  test("normalizes pipeline deals and filters malformed rows", () => {
    const rows = normalizeRepPipelineDeals([
      {
        deal_id: "deal-1",
        company_id: "company-1",
        customer_name: "ACME",
        primary_contact_name: "",
        primary_contact_phone: "555",
        stage: "",
        stage_sort: "2",
        amount: "10000",
        deal_name: "Excavator",
        created_at: "2026-05-03T12:00:00Z",
        updated_at: "2026-05-03T12:30:00Z",
        expected_close_on: "bad-date",
        last_activity_at: "2026-05-03T13:00:00Z",
        next_follow_up_at: null,
        days_since_activity: "3",
        heat_status: "bad",
        deal_score: "0.7",
      },
      { deal_id: "", company_id: "company-2" },
    ]);

    expect(rows).toEqual([{
      deal_id: "deal-1",
      company_id: "company-1",
      customer_name: "ACME",
      primary_contact_name: null,
      primary_contact_phone: "555",
      stage: "Unknown",
      stage_sort: 2,
      amount: 10000,
      deal_name: "Excavator",
      created_at: "2026-05-03T12:00:00Z",
      updated_at: "2026-05-03T12:30:00Z",
      expected_close_on: null,
      last_activity_at: "2026-05-03T13:00:00Z",
      next_follow_up_at: null,
      days_since_activity: 3,
      heat_status: "cold",
      deal_score: 0.7,
    }]);
  });

  test("normalizes customers, equipment, activities, and stage options", () => {
    expect(normalizeRepCustomers([
      { customer_id: "company-1", company_name: "ACME", open_deals: "2", active_quotes: "1", opportunity_score: "0.8" },
      { customer_id: "", company_name: "Bad" },
    ])).toMatchObject([{ customer_id: "company-1", open_deals: 2, active_quotes: 1, opportunity_score: 0.8 }]);

    expect(normalizeCustomerEquipmentRows([
      { id: "eq-1", make: "Deere", model: "333G", year: "2022", engine_hours: "410.5" },
      { id: "" },
    ])).toEqual([{
      id: "eq-1",
      make: "Deere",
      model: "333G",
      year: 2022,
      serial_number: null,
      engine_hours: 410.5,
      condition: null,
      name: null,
    }]);

    expect(normalizeCustomerActivityRows([
      { id: "act-1", activity_type: "call", body: "", occurred_at: "2026-05-03T12:00:00Z", metadata: { source: "test" } },
      { id: "act-2", activity_type: "", occurred_at: "2026-05-03T12:00:00Z" },
    ])).toEqual([{
      id: "act-1",
      activity_type: "call",
      body: null,
      occurred_at: "2026-05-03T12:00:00Z",
      metadata: { source: "test" },
    }]);

    expect(normalizeDealStageOptions([
      { id: "stage-1", name: "Quote", sort_order: "3" },
      { id: "stage-2", name: "" },
    ])).toEqual([{ id: "stage-1", name: "Quote", sort_order: 3 }]);
  });

  test("deduplicates multi-contact customer rows by customer_id", () => {
    const out = normalizeRepCustomers([
      { customer_id: "company-1", company_name: "ACME", primary_contact_name: "First Contact" },
      { customer_id: "company-1", company_name: "ACME", primary_contact_name: "Second Contact" },
      { customer_id: "company-2", company_name: "Bravo" },
    ]);

    expect(out).toHaveLength(2);
    expect(out.map((row) => row.customer_id)).toEqual(["company-1", "company-2"]);
    expect(out[0]?.primary_contact_name).toBe("First Contact");
  });

  test("returns safe empty values for malformed inputs", () => {
    expect(normalizeDailyBriefing({})).toBeNull();
    expect(normalizeTodayBriefing({})).toBeNull();
    expect(normalizeRepPipelineDeals(null)).toEqual([]);
    expect(normalizeRepCustomers(null)).toEqual([]);
    expect(normalizeCustomerEquipmentRows(null)).toEqual([]);
    expect(normalizeCustomerActivityRows(null)).toEqual([]);
    expect(normalizeDealStageOptions(null)).toEqual([]);
  });
});
