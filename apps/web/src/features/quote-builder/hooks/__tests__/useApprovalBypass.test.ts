import { describe, expect, test } from "bun:test";

import { isBypassApprovedWithoutCase } from "../useApprovalBypass";

describe("isBypassApprovedWithoutCase", () => {
  test("true when no approval case and quote is approved", () => {
    expect(isBypassApprovedWithoutCase(null, "approved")).toBe(true);
  });

  test("true when no approval case and quote is approved_with_conditions", () => {
    expect(isBypassApprovedWithoutCase(null, "approved_with_conditions")).toBe(true);
  });

  test("false when approval case exists", () => {
    expect(isBypassApprovedWithoutCase({ id: "case-1", canSend: false }, "approved")).toBe(false);
  });

  test("false when quote is still draft", () => {
    expect(isBypassApprovedWithoutCase(null, "draft")).toBe(false);
  });
});
