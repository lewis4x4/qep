import { describe, expect, test } from "bun:test";
import {
  getPrepHomeTransitionPlan,
  groupQuotesByHomeStatus,
  isUnquotedCounterInquiry,
  orderCounterInquiriesForHome,
} from "./role-home-utils";

describe("role-home-utils", () => {
  test("groups quote rows into home status buckets", () => {
    const grouped = groupQuotesByHomeStatus([
      { id: "draft-1", status: "draft" },
      { id: "approved-1", status: "approved" },
      { id: "accepted-1", status: "accepted" },
    ]);

    expect(grouped.get("draft")?.map((row) => row.id)).toEqual(["draft-1"]);
    expect(grouped.get("approved")?.map((row) => row.id)).toEqual([
      "approved-1",
      "accepted-1",
    ]);
  });

  test("orders unresolved counter inquiries before resolved rows", () => {
    const rows = [
      { id: "quoted", outcome: "quoted" },
      { id: "new", outcome: "no_match" },
      { id: "converted", outcome: "converted" },
      { id: "review", outcome: "needs_review" },
    ];

    expect(rows.filter(isUnquotedCounterInquiry).map((row) => row.id)).toEqual([
      "new",
      "review",
    ]);
    expect(orderCounterInquiriesForHome(rows).map((row) => row.id)).toEqual([
      "new",
      "review",
      "quoted",
      "converted",
    ]);
  });

  test("plans prep home transitions through router, blocker path, or ready shortcut", () => {
    expect(getPrepHomeTransitionPlan("scheduled", "in_progress")).toEqual({
      kind: "router",
      requiresBlocker: false,
    });
    expect(getPrepHomeTransitionPlan("in_progress", "blocked_waiting")).toEqual({
      kind: "router",
      requiresBlocker: true,
    });
    expect(getPrepHomeTransitionPlan("in_progress", "ready_for_pickup")).toEqual({
      kind: "ready_shortcut",
      requiresBlocker: false,
    });
    expect(getPrepHomeTransitionPlan("ready_for_pickup", "ready_for_pickup")).toEqual({
      kind: "noop",
      reason: "already_at_stage",
    });
  });
});
