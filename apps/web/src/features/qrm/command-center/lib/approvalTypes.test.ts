import { describe, expect, test } from "bun:test";
import type { DemoRow, DepositRow, MarginRow, QuoteApprovalRow, TradeRow } from "./approvalTypes";
import { normalizeApprovals } from "./approvalTypes";

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
});
