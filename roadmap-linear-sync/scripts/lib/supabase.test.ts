import { describe, expect, it } from "bun:test";
import {
  buildPendingLinearSyncQuery,
  buildTargetedRoadmapTasksQuery,
  hasLinearSyncScope,
} from "./supabase.mjs";

function decodeQuery(query: string) {
  return Object.fromEntries(new URLSearchParams(query).entries());
}

describe("buildPendingLinearSyncQuery", () => {
  it("defaults to the pending sync view without scope filters", () => {
    expect(decodeQuery(buildPendingLinearSyncQuery())).toEqual({
      select: "*",
    });
  });

  it("scopes by task IDs without widening to unrelated mirrors", () => {
    expect(decodeQuery(buildPendingLinearSyncQuery({
      taskIds: ["G1.1", "G3.1", "G1.1", " "],
    }))).toEqual({
      select: "*",
      task_id: 'in.("G1.1","G3.1")',
    });
  });

  it("scopes by Linear identifiers for targeted closeout pushes", () => {
    expect(decodeQuery(buildPendingLinearSyncQuery({
      linearIssueIdentifiers: ["QEP-175", "QEP-176"],
    }))).toEqual({
      select: "*",
      linear_issue_identifier: 'in.("QEP-175","QEP-176")',
    });
  });
});

describe("buildTargetedRoadmapTasksQuery", () => {
  it("selects explicit July 3 reconciliation rows even when they are not pending", () => {
    expect(decodeQuery(buildTargetedRoadmapTasksQuery({
      taskIds: ["D3.7", "K1.1", "K4.1", "D3.7"],
    }))).toEqual({
      select: "*",
      task_id: 'in.("D3.7","K1.1","K4.1")',
      order: "updated_at.asc,task_id.asc",
    });
  });

  it("can target the stale Linear mirrors without selecting still-gated K rows", () => {
    const query = decodeQuery(buildTargetedRoadmapTasksQuery({
      linearIssueIdentifiers: ["QEP-101", "QEP-221", "QEP-224"],
    }));

    expect(query).toEqual({
      select: "*",
      linear_issue_identifier: 'in.("QEP-101","QEP-221","QEP-224")',
      order: "updated_at.asc,task_id.asc",
    });
    expect(query.linear_issue_identifier).not.toContain("QEP-223");
  });
});

describe("hasLinearSyncScope", () => {
  it("requires an explicit scope before forced sync can bypass the pending queue", () => {
    expect(hasLinearSyncScope()).toBe(false);
    expect(hasLinearSyncScope({ taskIds: [" "] })).toBe(false);
    expect(hasLinearSyncScope({ taskIds: ["D3.7"] })).toBe(true);
    expect(hasLinearSyncScope({ linearIssueIdentifiers: ["QEP-101"] })).toBe(true);
  });
});
