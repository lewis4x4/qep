import { describe, expect, test } from "bun:test";
import { normalizeValidationHistoryRow, normalizeValidationHistoryRows } from "./payment-validation-history";

describe("payment validation history normalizers", () => {
  test("normalizes valid Supabase rows and numeric strings", () => {
    expect(normalizeValidationHistoryRow({
      id: "validation-1",
      amount: "1250.50",
      attempt_outcome: "blocked",
      created_at: "2026-05-03T12:00:00.000Z",
      daily_check_total: "2500",
      invoice_reference: "INV-123",
      is_delivery_day: true,
      override_reason: null,
      passed: false,
      payment_type: "credit_card",
      rule_applied: "no_cards_over_threshold",
      transaction_type: "parts",
    })).toEqual({
      id: "validation-1",
      amount: 1250.5,
      attempt_outcome: "blocked",
      created_at: "2026-05-03T12:00:00.000Z",
      daily_check_total: 2500,
      invoice_reference: "INV-123",
      is_delivery_day: true,
      override_reason: null,
      passed: false,
      payment_type: "credit_card",
      rule_applied: "no_cards_over_threshold",
      transaction_type: "parts",
    });
  });

  test("filters malformed rows before they reach the UI", () => {
    expect(normalizeValidationHistoryRows([
      {
        id: "valid",
        amount: 100,
        created_at: "2026-05-03T12:00:00.000Z",
        passed: true,
        payment_type: "check",
      },
      { id: "", amount: 100, created_at: "2026-05-03T12:00:00.000Z", passed: true, payment_type: "check" },
      { id: "bad-amount", amount: "not money", created_at: "2026-05-03T12:00:00.000Z", passed: true, payment_type: "check" },
      { id: "bad-date", amount: 100, created_at: "not a date", passed: true, payment_type: "check" },
      { id: "bad-passed", amount: 100, created_at: "2026-05-03T12:00:00.000Z", passed: "true", payment_type: "check" },
      { id: "bad-type", amount: 100, created_at: "2026-05-03T12:00:00.000Z", passed: true, payment_type: "" },
    ])).toEqual([
      {
        id: "valid",
        amount: 100,
        attempt_outcome: null,
        created_at: "2026-05-03T12:00:00.000Z",
        daily_check_total: null,
        invoice_reference: null,
        is_delivery_day: null,
        override_reason: null,
        passed: true,
        payment_type: "check",
        rule_applied: null,
        transaction_type: null,
      },
    ]);
  });

  test("returns an empty list for non-array inputs", () => {
    expect(normalizeValidationHistoryRows(null)).toEqual([]);
    expect(normalizeValidationHistoryRows({ id: "validation-1" })).toEqual([]);
  });
});
