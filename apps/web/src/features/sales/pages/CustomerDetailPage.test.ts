import { describe, expect, test } from "bun:test";
import { customerDetailQueryKey } from "../hooks/useCustomerDetail";
import { getCustomerQuickLogSubject } from "./CustomerDetailPage";

describe("CustomerDetailPage quick log subject routing", () => {
  test("routes customer quick logs to company subject only", () => {
    expect(getCustomerQuickLogSubject("company-123")).toEqual({
      companyId: "company-123",
    });
  });

  test("uses a stable customer detail query key for post-capture invalidation", () => {
    expect(customerDetailQueryKey("company-123")).toEqual([
      "sales",
      "customer-detail",
      "company-123",
    ]);
  });
});
