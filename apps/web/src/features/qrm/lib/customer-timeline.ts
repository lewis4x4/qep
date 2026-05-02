export interface CustomerTimelineEvent {
  id: string;
  eventType: string;
  eventAt: string;
  sourceTable: string | null;
  metadata: Record<string, unknown>;
}

export type CustomerLifecycleEventType =
  | "first_contact"
  | "first_quote"
  | "first_purchase"
  | "first_service"
  | "first_warranty_claim"
  | "nps_response"
  | "churn_risk_flag"
  | "won_back"
  | "lost";

export interface CustomerLifecycleEventRow {
  id: string;
  company_id: string;
  event_type: CustomerLifecycleEventType;
  event_at: string;
  source_table: string | null;
  metadata: Record<string, unknown>;
}

export interface CustomerTimelineSummary {
  milestoneCount: number;
  riskCount: number;
  latestEventLabel: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  first_contact: "First contact",
  first_quote: "First quote",
  first_purchase: "First purchase",
  first_service: "First service",
  first_warranty_claim: "First warranty claim",
  nps_response: "NPS response",
  churn_risk_flag: "Churn risk flagged",
  won_back: "Won back",
  lost: "Lost",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function isCustomerLifecycleEventType(value: unknown): value is CustomerLifecycleEventType {
  return typeof value === "string" && value in EVENT_LABELS;
}

export function normalizeCustomerLifecycleEventRows(rows: unknown): CustomerLifecycleEventRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.company_id !== "string" ||
      !isCustomerLifecycleEventType(row.event_type) ||
      typeof row.event_at !== "string"
    ) {
      return [];
    }

    return [{
      id: row.id,
      company_id: row.company_id,
      event_type: row.event_type,
      event_at: row.event_at,
      source_table: nullableString(row.source_table),
      metadata: isRecord(row.metadata) ? row.metadata : {},
    }];
  });
}

export function toCustomerTimelineEvent(row: CustomerLifecycleEventRow): CustomerTimelineEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    eventAt: row.event_at,
    sourceTable: row.source_table,
    metadata: row.metadata,
  };
}

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ");
}

export function summarizeCustomerTimeline(events: CustomerTimelineEvent[]): CustomerTimelineSummary {
  const sorted = [...events].sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt));
  const riskCount = events.filter((event) => event.eventType === "churn_risk_flag" || event.eventType === "lost").length;
  return {
    milestoneCount: events.length,
    riskCount,
    latestEventLabel: sorted[0] ? eventLabel(sorted[0].eventType) : null,
  };
}
