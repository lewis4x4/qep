import { describe, expect, test } from "bun:test";
import {
  attemptOutcome,
  canOverridePayment,
  paymentValidationSummary,
  requiredApproverRole,
} from "./payment-validation";

describe("payment-validation helpers", () => {
  test("allows override for elevated roles only", () => {
    expect(canOverridePayment("admin")).toBe(true);
    expect(canOverridePayment("manager")).toBe(true);
    expect(canOverridePayment("owner")).toBe(true);
    expect(canOverridePayment("rep")).toBe(false);
  });

  test("maps delivery day equipment-sale failures to owner approval", () => {
    expect(
      requiredApproverRole({
        passed: false,
        rule_applied: "delivery_day_cashiers_only",
        reason: "blocked",
      }),
    ).toBe("owner");
  });

  test("maps other blocked cases to manager approval", () => {
    expect(
      requiredApproverRole({
        passed: false,
        rule_applied: "business_check_limit",
        reason: "blocked",
      }),
    ).toBe("manager");
  });

  test("labels attempt outcomes correctly", () => {
    expect(attemptOutcome({ passed: true, rule_applied: null, reason: null }, false)).toBe("approved");
    expect(attemptOutcome({ passed: false, rule_applied: "x", reason: "blocked" }, false)).toBe("blocked");
    expect(attemptOutcome({ passed: false, rule_applied: "x", reason: "blocked" }, true)).toBe("overridden");
  });

  test("produces a readable validation summary", () => {
    expect(paymentValidationSummary(null)).toBe("No validation run yet.");
    expect(paymentValidationSummary({ passed: true, rule_applied: null, reason: null })).toContain("approved");
    expect(paymentValidationSummary({ passed: false, rule_applied: "x", reason: "Rental checks blocked" })).toBe("Rental checks blocked");
  });
});
