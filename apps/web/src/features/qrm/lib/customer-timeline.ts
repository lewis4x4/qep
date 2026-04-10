export interface CustomerTimelineEvent {
  id: string;
  eventType: string;
  eventAt: string;
  sourceTable: string | null;
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
