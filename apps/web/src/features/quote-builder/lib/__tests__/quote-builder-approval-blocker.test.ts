import { describe, expect, test } from "bun:test";
import type { QuoteApprovalCaseSummary } from "../../../../../../../shared/qep-moonshot-contracts";

import { resolveApprovalBlockerMessage } from "../quote-builder-approval-blocker";

function approvalCase(overrides: Partial<QuoteApprovalCaseSummary>): QuoteApprovalCaseSummary {
  return {
    id: "case-1",
    quotePackageId: "pkg-1",
    quotePackageVersionId: "version-1",
    versionNumber: 1,
    dealId: null,
    branchSlug: null,
    branchName: null,
    submittedBy: null,
    submittedByName: null,
    submittedAt: null,
    assignedTo: null,
    assignedToName: null,
    assignedRole: null,
    routeMode: "owner_direct",
    policySnapshot: {},
    reasonSummary: {},
    status: "pending",
    submissionNote: null,
    decisionNote: null,
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    dueAt: null,
    escalateAt: null,
    flowApprovalId: null,
    conditions: [],
    evaluations: [],
    canSend: false,
    ...overrides,
  };
}

describe("resolveApprovalBlockerMessage", () => {
  test("requires saved package id", () => {
    expect(resolveApprovalBlockerMessage({
      activeQuotePackageId: null,
      activeApprovalCaseLoading: false,
      bypassApprovedWithoutCase: false,
      activeApprovalCase: null,
    })).toMatch(/Save the quote package/);
  });

  test("allows bypass without case row", () => {
    expect(resolveApprovalBlockerMessage({
      activeQuotePackageId: "pkg-1",
      activeApprovalCaseLoading: false,
      bypassApprovedWithoutCase: true,
      activeApprovalCase: null,
    })).toBeNull();
  });

  test("keeps pending approval locked to the assigned owner", () => {
    expect(resolveApprovalBlockerMessage({
      activeQuotePackageId: "pkg-1",
      activeApprovalCaseLoading: false,
      bypassApprovedWithoutCase: false,
      activeApprovalCase: approvalCase({
        status: "pending",
        assignedToName: "Ryan",
      }),
    })).toBe("Waiting on Ryan to approve this quote.");
  });

  test("lists unmet conditional approval labels before customer-facing send unlocks", () => {
    expect(resolveApprovalBlockerMessage({
      activeQuotePackageId: "pkg-1",
      activeApprovalCaseLoading: false,
      bypassApprovedWithoutCase: false,
      activeApprovalCase: approvalCase({
        status: "approved_with_conditions",
        evaluations: [
          {
            id: "eval-1",
            conditionType: "min_margin_pct",
            label: "Margin floor",
            satisfied: false,
            detail: "Below configured floor",
            blocking: true,
          },
          {
            id: "eval-2",
            conditionType: "remove_attachment",
            label: "Manager note",
            satisfied: true,
            detail: "Reviewed",
            blocking: false,
          },
        ],
      }),
    })).toBe("Approval has unmet conditions: Margin floor.");
  });
});
