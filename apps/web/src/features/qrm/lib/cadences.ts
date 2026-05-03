import type { Cadence, CadenceTouchpoint } from "./deal-composite-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function cadenceType(value: unknown): Cadence["cadence_type"] {
  return value === "post_sale" ? "post_sale" : "sales";
}

function touchpointStatus(value: unknown): CadenceTouchpoint["status"] {
  return value === "completed" || value === "skipped" || value === "overdue" ? value : "pending";
}

function normalizeTouchpointRows(rows: unknown): CadenceTouchpoint[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      touchpoint_type: requiredString(row.touchpoint_type, "follow_up"),
      scheduled_date: requiredString(row.scheduled_date, ""),
      purpose: requiredString(row.purpose, "Follow up"),
      suggested_message: nullableString(row.suggested_message),
      value_type: nullableString(row.value_type),
      status: touchpointStatus(row.status),
      completed_at: nullableString(row.completed_at),
      delivery_method: nullableString(row.delivery_method),
    }];
  });
}

export function normalizeCadenceRows(rows: unknown): Cadence[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      cadence_type: cadenceType(row.cadence_type),
      status: requiredString(row.status, "active"),
      started_at: requiredString(row.started_at, ""),
      follow_up_touchpoints: normalizeTouchpointRows(row.touchpoints ?? row.follow_up_touchpoints),
    }];
  });
}
