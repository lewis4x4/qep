import { describe, expect, test } from "bun:test";

import { resolveApprovalBlockerMessage } from "../quote-builder-approval-blocker";

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
});
