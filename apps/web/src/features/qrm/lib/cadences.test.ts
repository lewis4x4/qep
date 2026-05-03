import { describe, expect, it } from "bun:test";
import { normalizeCadenceRows } from "./cadences";

describe("normalizeCadenceRows", () => {
  it("normalizes cadence rows and nested touchpoints", () => {
    expect(normalizeCadenceRows([
      {
        id: "cadence-1",
        cadence_type: "post_sale",
        status: "",
        started_at: "2026-04-01T00:00:00.000Z",
        follow_up_touchpoints: [
          {
            id: "touch-1",
            touchpoint_type: "",
            scheduled_date: "2026-04-03",
            purpose: "",
            suggested_message: "Check in",
            value_type: 42,
            status: "overdue",
            completed_at: null,
            delivery_method: "email",
          },
          { id: null, status: "pending" },
        ],
      },
      { id: null, cadence_type: "sales" },
      "bad",
    ])).toEqual([
      {
        id: "cadence-1",
        cadence_type: "post_sale",
        status: "active",
        started_at: "2026-04-01T00:00:00.000Z",
        follow_up_touchpoints: [
          {
            id: "touch-1",
            touchpoint_type: "follow_up",
            scheduled_date: "2026-04-03",
            purpose: "Follow up",
            suggested_message: "Check in",
            value_type: null,
            status: "overdue",
            completed_at: null,
            delivery_method: "email",
          },
        ],
      },
    ]);
  });

  it("accepts composite touchpoints aliases and defaults unknown enum values", () => {
    expect(normalizeCadenceRows([
      {
        id: "cadence-2",
        cadence_type: "bad",
        status: "active",
        started_at: "2026-04-01T00:00:00.000Z",
        touchpoints: [{ id: "touch-2", scheduled_date: "", status: "bad" }],
      },
    ])).toEqual([
      {
        id: "cadence-2",
        cadence_type: "sales",
        status: "active",
        started_at: "2026-04-01T00:00:00.000Z",
        follow_up_touchpoints: [
          {
            id: "touch-2",
            touchpoint_type: "follow_up",
            scheduled_date: "",
            purpose: "Follow up",
            suggested_message: null,
            value_type: null,
            status: "pending",
            completed_at: null,
            delivery_method: null,
          },
        ],
      },
    ]);
  });

  it("returns an empty list for non-array payloads", () => {
    expect(normalizeCadenceRows(null)).toEqual([]);
    expect(normalizeCadenceRows({ id: "cadence-1" })).toEqual([]);
  });
});
