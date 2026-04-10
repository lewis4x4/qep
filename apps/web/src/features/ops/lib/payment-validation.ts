export const PAYMENT_TYPES = [
  "business_check",
  "personal_check",
  "cashiers_check",
  "credit_card",
  "debit_card",
  "ach",
  "wire",
] as const;

export const TRANSACTION_TYPES = ["equipment_sale", "rental", "parts", "service"] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface ValidationResult {
  passed: boolean;
  rule_applied: string | null;
  reason: string | null;
  daily_check_total?: number | null;
}

export function canOverridePayment(profileRole: string | null | undefined): boolean {
  return profileRole === "admin" || profileRole === "manager" || profileRole === "owner";
}

export function requiredApproverRole(
  result: ValidationResult | null,
): string | null {
  if (!result || result.passed) return null;
  if (result.rule_applied === "delivery_day_cashiers_only") return "owner";
  return "manager";
}

export function attemptOutcome(
  result: ValidationResult | null,
  wasOverridden: boolean,
): string {
  if (wasOverridden) return "overridden";
  return result?.passed ? "approved" : "blocked";
}

export function paymentValidationSummary(result: ValidationResult | null): string {
  if (!result) return "No validation run yet.";
  if (result.passed) return "Payment approved under the current SOP rules.";
  return result.reason ?? "Payment blocked by SOP validation.";
}
