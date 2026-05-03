export interface ValidationHistoryRow {
  id: string;
  amount: number;
  attempt_outcome: string | null;
  created_at: string;
  daily_check_total: number | null;
  invoice_reference: string | null;
  is_delivery_day: boolean | null;
  override_reason: string | null;
  passed: boolean;
  payment_type: string;
  rule_applied: string | null;
  transaction_type: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeValidationHistoryRow(value: unknown): ValidationHistoryRow | null {
  if (!isRecord(value)) return null;

  const id = stringOrNull(value.id)?.trim();
  const amount = numberOrNull(value.amount);
  const createdAt = stringOrNull(value.created_at)?.trim();
  const passed = booleanOrNull(value.passed);
  const paymentType = stringOrNull(value.payment_type)?.trim();

  if (!id || amount == null || !createdAt || Number.isNaN(Date.parse(createdAt)) || passed == null || !paymentType) {
    return null;
  }

  return {
    id,
    amount,
    attempt_outcome: stringOrNull(value.attempt_outcome),
    created_at: createdAt,
    daily_check_total: numberOrNull(value.daily_check_total),
    invoice_reference: stringOrNull(value.invoice_reference),
    is_delivery_day: booleanOrNull(value.is_delivery_day),
    override_reason: stringOrNull(value.override_reason),
    passed,
    payment_type: paymentType,
    rule_applied: stringOrNull(value.rule_applied),
    transaction_type: stringOrNull(value.transaction_type),
  };
}

export function normalizeValidationHistoryRows(rows: unknown): ValidationHistoryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeValidationHistoryRow).filter((row): row is ValidationHistoryRow => row !== null);
}
