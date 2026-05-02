import { describe, expect, it } from "bun:test";
import {
  eventLabel,
  isCustomerLifecycleEventType,
  normalizeCustomerLifecycleEventRows,
  summarizeCustomerTimeline,
  toCustomerTimelineEvent,
} from "./customer-timeline";

describe("customer timeline helpers", () => {
  it("builds a summary and readable labels", () => {
    const summary = summarizeCustomerTimeline([
      {
        id: "1",
        eventType: "first_contact",
        eventAt: "2026-03-01T10:00:00.000Z",
        sourceTable: "crm_activities",
        metadata: {},
      },
      {
        id: "2",
        eventType: "churn_risk_flag",
        eventAt: "2026-04-01T10:00:00.000Z",
        sourceTable: "customer_profiles_extended",
        metadata: {},
      },
    ]);

    expect(summary.milestoneCount).toBe(2);
    expect(summary.riskCount).toBe(1);
    expect(summary.latestEventLabel).toBe("Churn risk flagged");
    expect(eventLabel("first_quote")).toBe("First quote");
    expect(eventLabel("custom_event")).toBe("custom event");
  });
});

describe("customer lifecycle normalizers", () => {
  it("filters malformed lifecycle rows and normalizes optional metadata", () => {
    const rows = normalizeCustomerLifecycleEventRows([
      {
        id: "event-1",
        company_id: "company-1",
        event_type: "first_quote",
        event_at: "2026-04-01T10:00:00.000Z",
        source_table: "crm_deals",
        metadata: { quoteId: "quote-1" },
      },
      {
        id: "event-2",
        company_id: "company-1",
        event_type: "unknown_event",
        event_at: "2026-04-02T10:00:00.000Z",
      },
      {
        id: "event-3",
        company_id: "company-1",
        event_type: "lost",
        event_at: "2026-04-03T10:00:00.000Z",
        metadata: ["not", "a", "record"],
      },
      { company_id: "company-1", event_type: "first_contact" },
    ]);

    expect(rows).toEqual([
      {
        id: "event-1",
        company_id: "company-1",
        event_type: "first_quote",
        event_at: "2026-04-01T10:00:00.000Z",
        source_table: "crm_deals",
        metadata: { quoteId: "quote-1" },
      },
      {
        id: "event-3",
        company_id: "company-1",
        event_type: "lost",
        event_at: "2026-04-03T10:00:00.000Z",
        source_table: null,
        metadata: {},
      },
    ]);
  });

  it("maps normalized lifecycle rows to timeline events", () => {
    expect(isCustomerLifecycleEventType("won_back")).toBe(true);
    expect(isCustomerLifecycleEventType("bad_event")).toBe(false);

    expect(toCustomerTimelineEvent({
      id: "event-1",
      company_id: "company-1",
      event_type: "won_back",
      event_at: "2026-04-01T10:00:00.000Z",
      source_table: null,
      metadata: { source: "manual" },
    })).toEqual({
      id: "event-1",
      eventType: "won_back",
      eventAt: "2026-04-01T10:00:00.000Z",
      sourceTable: null,
      metadata: { source: "manual" },
    });
  });
});
