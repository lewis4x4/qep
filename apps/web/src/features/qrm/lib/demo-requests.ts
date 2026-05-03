import type { QrmDealDemoSummary } from "./deal-composite-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeDemoRequestRows(rows: unknown): QrmDealDemoSummary[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      status: requiredString(row.status, "requested"),
      equipment_category: nullableString(row.equipment_category),
      max_hours: requiredNumber(row.max_hours, 0),
      starting_hours: nullableNumber(row.starting_hours),
      ending_hours: nullableNumber(row.ending_hours),
      hours_used: nullableNumber(row.hours_used),
      total_demo_cost: nullableNumber(row.total_demo_cost),
      scheduled_date: nullableString(row.scheduled_date),
      followup_due_at: nullableString(row.followup_due_at),
      followup_completed: requiredBoolean(row.followup_completed, false),
      customer_decision: nullableString(row.customer_decision),
      needs_assessment_complete: requiredBoolean(row.needs_assessment_complete, false),
      quote_presented: requiredBoolean(row.quote_presented, false),
      buying_intent_confirmed: requiredBoolean(row.buying_intent_confirmed, false),
      created_at: requiredString(row.created_at, ""),
    }];
  });
}
