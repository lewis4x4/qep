import { describe, expect, test } from "bun:test";
import {
  allowedQuoteVersionScopesForConditions,
  buildQuoteVersionSnapshot,
  diffQuoteVersionScopes,
  evaluateQuoteApprovalConditions,
  resolveQuoteApprovalAuthorityBand,
  type QuoteApprovalConditionDraft,
  type QuoteApprovalPolicy,
} from "../../../../../../../shared/qep-moonshot-contracts";

const policy: QuoteApprovalPolicy = {
  workspaceId: "default",
  branchManagerMinMarginPct: 8,
  standardMarginFloorPct: 10,
  branchManagerMaxQuoteAmount: 250000,
  submitSlaHours: 24,
  escalationSlaHours: 48,
  ownerEscalationRole: "owner",
  namedBranchSalesManagerPrimary: true,
  namedBranchGeneralManagerFallback: true,
  allowedConditionTypes: [
    "min_margin_pct",
    "max_trade_allowance",
    "required_cash_down",
    "required_finance_scenario",
    "remove_attachment",
    "expiry_hours",
  ],
  updatedAt: null,
  updatedBy: null,
};

describe("quote approval governance", () => {
  test("routes in-band exceptions to branch manager", () => {
    expect(resolveQuoteApprovalAuthorityBand({
      marginPct: 9.2,
      amount: 120000,
      policy,
    })).toBe("branch_manager");
  });

  test("routes out-of-band margin exceptions to owner/admin", () => {
    expect(resolveQuoteApprovalAuthorityBand({
      marginPct: 7.2,
      amount: 120000,
      policy,
    })).toBe("owner_admin");
  });

  test("routes oversized quotes to owner/admin", () => {
    expect(resolveQuoteApprovalAuthorityBand({
      marginPct: 9.2,
      amount: 300000,
      policy,
    })).toBe("owner_admin");
  });

  test("evaluates conditional approvals against the saved quote snapshot", () => {
    const snapshot = buildQuoteVersionSnapshot({
      quotePackageId: "pkg-1",
      dealId: "deal-1",
      branchSlug: "raleigh",
      customerName: "Thomas Sykes",
      customerCompany: "Sykes Earthworks",
      customerEmail: "thomas@example.com",
      customerPhone: "555-0100",
      commercialDiscountType: "flat",
      commercialDiscountValue: 1000,
      tradeAllowance: 15000,
      cashDown: 5000,
      selectedFinanceScenario: "Finance 48 mo",
      taxProfile: "standard",
      taxTotal: 3500,
      netTotal: 82000,
      customerTotal: 85500,
      amountFinanced: 80500,
      marginPct: 8.6,
      amount: 82000,
      equipment: [{ kind: "equipment", title: "Kubota KX040", quantity: 1, unitPrice: 72000 }],
      attachments: [{ kind: "attachment", title: "Hydraulic thumb", quantity: 1, unitPrice: 4000 }],
      quoteStatus: "approved_with_conditions",
      savedAt: "2026-04-22T15:00:00.000Z",
    });

    const conditions: QuoteApprovalConditionDraft[] = [
      { conditionType: "min_margin_pct", conditionPayload: { min_margin_pct: 8.5 } },
      { conditionType: "remove_attachment", conditionPayload: { attachment_title: "Hydraulic thumb" } },
    ];

    const result = evaluateQuoteApprovalConditions({
      snapshot,
      conditions,
      decidedAt: "2026-04-22T15:00:00.000Z",
      now: "2026-04-22T16:00:00.000Z",
    });

    expect(result.allSatisfied).toBe(false);
    expect(result.evaluations[0]?.satisfied).toBe(true);
    expect(result.evaluations[1]?.satisfied).toBe(false);
  });

  test("allowed condition scopes limit which edits preserve conditional approval", () => {
    const previous = buildQuoteVersionSnapshot({
      quotePackageId: "pkg-1",
      dealId: "deal-1",
      branchSlug: "raleigh",
      customerName: "Thomas Sykes",
      customerCompany: "Sykes Earthworks",
      customerEmail: "thomas@example.com",
      customerPhone: "555-0100",
      commercialDiscountType: "flat",
      commercialDiscountValue: 1000,
      tradeAllowance: 15000,
      cashDown: 5000,
      selectedFinanceScenario: "Finance 48 mo",
      taxProfile: "standard",
      taxTotal: 3500,
      netTotal: 82000,
      customerTotal: 85500,
      amountFinanced: 80500,
      marginPct: 8.6,
      amount: 82000,
      equipment: [{ kind: "equipment", title: "Kubota KX040", quantity: 1, unitPrice: 72000 }],
      attachments: [{ kind: "attachment", title: "Hydraulic thumb", quantity: 1, unitPrice: 4000 }],
      quoteStatus: "approved_with_conditions",
      savedAt: "2026-04-22T15:00:00.000Z",
    });

    const next = buildQuoteVersionSnapshot({
      ...previous,
      tradeAllowance: 12000,
      attachments: [],
      equipment: [{ kind: "equipment", title: "Kubota KX040", quantity: 1, unitPrice: 72000 }],
    });

    const changedScopes = diffQuoteVersionScopes(previous, next);
    expect(changedScopes).toContain("trade");
    expect(changedScopes).toContain("attachments");
    expect(changedScopes).not.toContain("equipment");

    const allowedScopes = allowedQuoteVersionScopesForConditions([
      { conditionType: "max_trade_allowance", conditionPayload: { max_trade_allowance: 12000 } },
      { conditionType: "remove_attachment", conditionPayload: { attachment_title: "Hydraulic thumb" } },
    ]);

    expect(changedScopes.every((scope) => allowedScopes.includes(scope))).toBe(true);
  });
});
