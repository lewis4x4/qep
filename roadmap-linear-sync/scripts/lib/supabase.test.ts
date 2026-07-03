import { describe, expect, it } from "bun:test";
import { buildPendingLinearSyncQuery } from "./supabase.mjs";

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
