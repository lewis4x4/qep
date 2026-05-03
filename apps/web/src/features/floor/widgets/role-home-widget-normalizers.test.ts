import { describe, expect, test } from "bun:test";
import {
  normalizeApprovalDecisionRows,
  normalizeCounterInquiryRows,
  normalizeJoinedDealRows,
  normalizeMarginRows,
  normalizeQuoteRows,
  normalizeServiceJobRows,
  normalizeSlaApprovalRows,
} from "./role-home-widget-normalizers";

describe("role home widget normalizers", () => {
  test("normalizes quote rows and joined deal objects", () => {
    expect(normalizeQuoteRows([
      {
        id: "quote-1",
        deal_id: "deal-1",
        quote_number: "Q-100",
        customer_company: "Tigercat Logistics",
        customer_name: "Tiger Buyer",
        equipment: [{ make: "Deere", model: "333G" }],
        net_total: "125000",
        status: "sent",
        sent_at: "2026-05-03T12:00:00.000Z",
        viewed_at: null,
        updated_at: "2026-05-03T12:00:00.000Z",
        created_by: "user-1",
        deal: [{ id: "deal-1", assigned_rep_id: "rep-1", name: "Loader deal" }],
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "quote-1",
        deal_id: "deal-1",
        quote_number: "Q-100",
        customer_company: "Tigercat Logistics",
        customer_name: "Tiger Buyer",
        equipment: [{ make: "Deere", model: "333G" }],
        net_total: 125000,
        status: "sent",
        sent_at: "2026-05-03T12:00:00.000Z",
        viewed_at: null,
        updated_at: "2026-05-03T12:00:00.000Z",
        created_by: "user-1",
        deal: { id: "deal-1", assigned_rep_id: "rep-1", name: "Loader deal" },
      },
    ]);
  });

  test("normalizes counter inquiry and margin rows", () => {
    expect(normalizeCounterInquiryRows([
      {
        id: "inquiry-1",
        inquiry_type: "parts",
        query_text: "Need teeth",
        outcome: "quoted",
        result_parts: ["P1", 42, "P2"],
        match_type: "exact",
        machine_description: "Dozer",
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "inquiry-1",
        inquiry_type: "parts",
        query_text: "Need teeth",
        outcome: "quoted",
        result_parts: ["P1", "P2"],
        match_type: "exact",
        machine_description: "Dozer",
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);

    expect(normalizeMarginRows([
      {
        month_bucket: "2026-05-01",
        avg_margin_pct: "0.18",
        flagged_deal_count: "2",
        deal_count: "10",
        total_pipeline: "1000000",
        equipment_category: "construction",
      },
    ])).toEqual([
      {
        month_bucket: "2026-05-01",
        avg_margin_pct: 0.18,
        flagged_deal_count: 2,
        deal_count: 10,
        total_pipeline: 1000000,
        equipment_category: "construction",
      },
    ]);
  });

  test("normalizes approval SLA and decision rows", () => {
    expect(normalizeSlaApprovalRows([
      {
        id: "approval-1",
        status: "pending",
        requested_at: "2026-05-03T10:00:00.000Z",
        decided_at: null,
        due_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "approval-1",
        status: "pending",
        requested_at: "2026-05-03T10:00:00.000Z",
        decided_at: null,
        due_at: "2026-05-03T12:00:00.000Z",
      },
    ]);

    expect(normalizeApprovalDecisionRows([
      {
        id: "decision-1",
        subject: "Margin exception",
        status: "approved",
        decided_at: "2026-05-03T12:00:00.000Z",
        decision_reason: "OK",
        workflow_slug: "margin",
        decided_by_profile: [{ full_name: "Manager One" }],
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "decision-1",
        subject: "Margin exception",
        status: "approved",
        decided_at: "2026-05-03T12:00:00.000Z",
        decision_reason: "OK",
        workflow_slug: "margin",
        decided_by_profile: { full_name: "Manager One" },
      },
    ]);
  });

  test("normalizes service job rows and filters invalid stages", () => {
    expect(normalizeServiceJobRows([
      {
        id: "job-1",
        workspace_id: "default",
        current_stage: "scheduled",
        priority: "high",
        status_flags: ["blocked", 42, "customer_waiting"],
        customer_problem_summary: "Won't start",
        scheduled_start_at: "2026-05-03T10:00:00.000Z",
        scheduled_end_at: "2026-05-03T12:00:00.000Z",
        current_stage_entered_at: "2026-05-02T12:00:00.000Z",
        customer: [{ name: "Tigercat Logistics" }],
        machine: [{ make: "Deere", model: "333G", serial_number: "SN-1", year: "2024" }],
      },
      { id: "bad", workspace_id: "default", current_stage: "not_a_stage" },
    ])).toEqual([
      {
        id: "job-1",
        workspace_id: "default",
        current_stage: "scheduled",
        priority: "high",
        status_flags: ["blocked", "customer_waiting"],
        customer_problem_summary: "Won't start",
        scheduled_start_at: "2026-05-03T10:00:00.000Z",
        scheduled_end_at: "2026-05-03T12:00:00.000Z",
        current_stage_entered_at: "2026-05-02T12:00:00.000Z",
        customer: { name: "Tigercat Logistics" },
        machine: { make: "Deere", model: "333G", serial_number: "SN-1", year: 2024 },
      },
    ]);
  });

  test("normalizes joined deal rows and filters malformed rows", () => {
    expect(normalizeJoinedDealRows([
      {
        id: "deal-1",
        name: "Loader deal",
        amount: "275000",
        margin_pct: "0.14",
        stage_changed_at: "2026-05-01T00:00:00.000Z",
        expected_close_on: "2026-05-20",
        updated_at: "2026-05-03T12:00:00.000Z",
        company: [{ name: "Tigercat Logistics" }],
        stage: { name: "Proposal" },
        assigned_rep: [{ full_name: "Rep One" }],
      },
      { id: "bad", name: "Missing updated" },
    ])).toEqual([
      {
        id: "deal-1",
        name: "Loader deal",
        amount: 275000,
        margin_pct: 0.14,
        stage_changed_at: "2026-05-01T00:00:00.000Z",
        expected_close_on: "2026-05-20",
        updated_at: "2026-05-03T12:00:00.000Z",
        company: { name: "Tigercat Logistics" },
        stage: { name: "Proposal" },
        assigned_rep: { full_name: "Rep One" },
      },
    ]);
  });

  test("returns empty arrays for non-array inputs", () => {
    expect(normalizeQuoteRows(null)).toEqual([]);
    expect(normalizeCounterInquiryRows(undefined)).toEqual([]);
    expect(normalizeMarginRows({})).toEqual([]);
    expect(normalizeSlaApprovalRows(null)).toEqual([]);
    expect(normalizeApprovalDecisionRows(undefined)).toEqual([]);
    expect(normalizeServiceJobRows({})).toEqual([]);
    expect(normalizeJoinedDealRows(null)).toEqual([]);
  });
});
