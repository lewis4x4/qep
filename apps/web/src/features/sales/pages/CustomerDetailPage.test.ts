import { describe, expect, test } from "bun:test";
import { getCustomerQuickLogSubject } from "./CustomerDetailPage";

describe("CustomerDetailPage quick log subject routing", () => {
  test("routes customer quick logs to company subject only", () => {
    expect(getCustomerQuickLogSubject("company-123")).toEqual({
      companyId: "company-123",
    });
  });
});
