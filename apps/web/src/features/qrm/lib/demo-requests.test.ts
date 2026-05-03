import { describe, expect, it } from "bun:test";
import { normalizeDemoRequestRows } from "./demo-requests";

describe("normalizeDemoRequestRows", () => {
  it("normalizes fetched demo request rows and filters malformed records", () => {
    expect(normalizeDemoRequestRows([
      {
        id: "demo-1",
        status: "",
        equipment_category: "construction",
        max_hours: Number.NaN,
        starting_hours: 10,
        ending_hours: null,
        hours_used: 2.5,
        total_demo_cost: 250,
        scheduled_date: 42,
        followup_due_at: "2026-04-10T00:00:00.000Z",
        followup_completed: true,
        customer_decision: "pending",
        needs_assessment_complete: true,
        quote_presented: false,
        buying_intent_confirmed: true,
        created_at: "2026-04-01T00:00:00.000Z",
      },
      { id: null, status: "requested" },
      "bad",
    ])).toEqual([
      {
        id: "demo-1",
        status: "requested",
        equipment_category: "construction",
        max_hours: 0,
        starting_hours: 10,
        ending_hours: null,
        hours_used: 2.5,
        total_demo_cost: 250,
        scheduled_date: null,
        followup_due_at: "2026-04-10T00:00:00.000Z",
        followup_completed: true,
        customer_decision: "pending",
        needs_assessment_complete: true,
        quote_presented: false,
        buying_intent_confirmed: true,
        created_at: "2026-04-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list for non-array payloads", () => {
    expect(normalizeDemoRequestRows(null)).toEqual([]);
    expect(normalizeDemoRequestRows({ id: "demo-1" })).toEqual([]);
  });
});
