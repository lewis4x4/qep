import { describe, expect, test } from "bun:test";
import type { DemoRow, DepositRow, MarginRow, QuoteApprovalRow, TradeRow } from "./approvalTypes";
import {
  normalizeApprovals,
  normalizeDemoRows,
  normalizeDepositRows,
  normalizeMarginRows,
  normalizeQuoteApprovalRows,
  normalizeTradeRows,
} from "./approvalTypes";

describe("normalizeApprovals", () => {
  test("includes quote approvals with a direct quote-builder link", () => {
    const approvals = normalizeApprovals(
      [] as MarginRow[],
      [] as DepositRow[],
      [] as TradeRow[],
      [] as DemoRow[],
      [{
        id: "approval-case-1",
        quote_package_id: "pkg-1",
        quote_package_version_id: "ver-1",
        version_number: 3,
        deal_id: "deal-1",
        quote_number: "Q-2026-0042",
        branch_slug: "raleigh",
        branch_name: "Raleigh",
        submitted_by_name: "Rylee Rep",
        assigned_to_name: "Morgan Manager",
        assigned_role: null,
        route_mode: "branch_sales_manager",
        policy_snapshot_json: {},
        reason_summary_json: { reasons: ["Margin below floor"] },
        decision_note: null,
        status: "pending",
        requested_at: "2026-04-20T12:00:00.000Z",
        due_at: "2026-04-21T12:00:00.000Z",
        escalate_at: "2026-04-22T12:00:00.000Z",
        customer_name: "Thomas Sykes",
        customer_company: "Sykes Earthworks",
        net_total: 82000,
        margin_pct: 7.4,
      }] as QuoteApprovalRow[],
      Date.parse("2026-04-22T12:00:00.000Z"),
    );

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: "approval-case-1",
      type: "quote",
      dealId: "deal-1",
      viewHref: "/quote-v2?package_id=pkg-1",
      dealName: "Sykes Earthworks",
      contactName: "Thomas Sykes",
      amount: 82000,
      meta: {
        approvalCaseId: "approval-case-1",
        quotePackageId: "pkg-1",
        quotePackageVersionId: "ver-1",
        routeMode: "branch_sales_manager",
        assignedToName: "Morgan Manager",
      },
    });
    expect(approvals[0]?.detail).toContain("Quote Q-2026-0042");
    expect(approvals[0]?.detail).toContain("Assigned to Morgan Manager");
    expect(approvals[0]?.detail).toContain("v3");
    expect(approvals[0]?.detail).toContain("Margin 7.4%");
    expect(approvals[0]?.meta).toMatchObject({
      quotePackageId: "pkg-1",
      approvalCaseId: "approval-case-1",
      assignedToName: "Morgan Manager",
      versionNumber: 3,
    });
  });

  test("normalizes approval query rows before merging", () => {
    expect(normalizeMarginRows([
      {
        id: "deal-1",
        name: "Low margin deal",
        amount: "82000",
        margin_pct: "7.4",
        margin_amount: "6068",
        margin_check_status: "flagged",
        updated_at: "2026-04-20T12:00:00.000Z",
        crm_contacts: [{ first_name: "Thomas", last_name: "Sykes" }],
      },
      { id: "bad-date", name: "Bad", updated_at: "not a date" },
    ])).toEqual([
      {
        id: "deal-1",
        name: "Low margin deal",
        amount: 82000,
        margin_pct: 7.4,
        margin_amount: 6068,
        margin_check_status: "flagged",
        updated_at: "2026-04-20T12:00:00.000Z",
        crm_contacts: { first_name: "Thomas", last_name: "Sykes" },
      },
    ]);

    expect(normalizeDepositRows([
      {
        id: "deposit-1",
        deal_id: "deal-1",
        amount: "1000",
        status: "pending",
        tier: "tier_2",
        created_at: "2026-04-20T12:00:00.000Z",
        crm_deals: [{ name: "Deposit deal", amount: "50000" }],
      },
    ])[0]).toMatchObject({
      id: "deposit-1",
      amount: 1000,
      crm_deals: { name: "Deposit deal", amount: 50000 },
    });

    expect(normalizeTradeRows([
      {
        id: "trade-1",
        deal_id: "deal-2",
        status: "manager_review",
        make: "Deere",
        model: "333G",
        year: "2021",
        preliminary_value: "42000",
        created_at: "2026-04-20T12:00:00.000Z",
        crm_deals: { name: "Trade deal" },
      },
    ])[0]).toMatchObject({
      id: "trade-1",
      year: 2021,
      preliminary_value: 42000,
      crm_deals: { name: "Trade deal", amount: null },
    });

    expect(normalizeDemoRows([
      {
        id: "demo-1",
        deal_id: "deal-3",
        status: "requested",
        equipment_category: "Compact track loader",
        scheduled_date: "2026-04-25",
        needs_assessment_complete: true,
        buying_intent_confirmed: false,
        created_at: "2026-04-20T12:00:00.000Z",
        crm_deals: [{ name: "Demo deal" }],
      },
    ])[0]).toMatchObject({
      id: "demo-1",
      needs_assessment_complete: true,
      buying_intent_confirmed: false,
      crm_deals: { name: "Demo deal", amount: null },
    });

    expect(normalizeQuoteApprovalRows([
      {
        id: "approval-case-1",
        quote_package_id: "pkg-1",
        quote_package_version_id: "ver-1",
        version_number: "3",
        deal_id: "deal-1",
        quote_number: "Q-2026-0042",
        route_mode: "branch_sales_manager",
        policy_snapshot_json: { rule: "margin" },
        reason_summary_json: { reasons: ["Margin below floor", 42] },
        status: "pending",
        created_at: "2026-04-20T12:00:00.000Z",
        net_total: "82000",
        margin_pct: "7.4",
      },
      {
        id: "bad-route",
        quote_package_id: "pkg-2",
        quote_package_version_id: "ver-2",
        version_number: 1,
        route_mode: "unknown",
        status: "pending",
        created_at: "2026-04-20T12:00:00.000Z",
      },
    ])).toEqual([
      expect.objectContaining({
        id: "approval-case-1",
        version_number: 3,
        route_mode: "branch_sales_manager",
        reason_summary_json: { reasons: ["Margin below floor"] },
        requested_at: "2026-04-20T12:00:00.000Z",
        net_total: 82000,
        margin_pct: 7.4,
      }),
    ]);
  });

  test("returns empty approval query row arrays for non-array inputs", () => {
    expect(normalizeMarginRows(null)).toEqual([]);
    expect(normalizeDepositRows({ id: "deposit-1" })).toEqual([]);
    expect(normalizeTradeRows(undefined)).toEqual([]);
    expect(normalizeDemoRows("bad")).toEqual([]);
    expect(normalizeQuoteApprovalRows(null)).toEqual([]);
  });
});
