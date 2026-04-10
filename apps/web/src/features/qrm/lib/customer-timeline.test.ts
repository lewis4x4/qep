import { describe, expect, it } from "bun:test";
import { eventLabel, summarizeCustomerTimeline } from "./customer-timeline";

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
