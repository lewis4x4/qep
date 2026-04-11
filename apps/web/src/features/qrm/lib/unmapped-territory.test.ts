import { describe, expect, it } from "bun:test";
import { buildUnmappedTerritoryBoard } from "./unmapped-territory";

describe("buildUnmappedTerritoryBoard", () => {
  it("surfaces mapped accounts where coverage is provably absent", () => {
    const board = buildUnmappedTerritoryBoard({
      equipment: [
        { companyId: "c1", companyName: "Oak Ridge", lat: 34.1, lng: -84.2 },
        { companyId: "c2", companyName: "Pine Hill", lat: 35.1, lng: -85.2 },
      ],
      companies: [
        { companyId: "c1", assignedRepId: null },
        { companyId: "c2", assignedRepId: "rep-1" },
      ],
      deals: [{ companyId: "c2" }],
      activities: [],
      voiceSignals: [],
      visitSignals: [{ companyId: "c2" }],
    });

    expect(board.summary.mappedAccounts).toBe(2);
    expect(board.summary.absenceAccounts).toBe(2);
    expect(board.summary.noRepAccounts).toBe(1);
    expect(board.rows[0]?.companyId).toBe("c1");
    expect(board.rows[0]?.reasons).toContain("No assigned rep");
    expect(board.rows[1]?.reasons).toContain("No recent voice signal");
  });

  it("skips accounts that do not have enough absence evidence", () => {
    const board = buildUnmappedTerritoryBoard({
      equipment: [{ companyId: "c1", companyName: "Oak Ridge", lat: 34.1, lng: -84.2 }],
      companies: [{ companyId: "c1", assignedRepId: "rep-1" }],
      deals: [{ companyId: "c1" }],
      activities: [{ companyId: "c1" }],
      voiceSignals: [{ companyId: "c1" }],
      visitSignals: [],
    });

    expect(board.summary.mappedAccounts).toBe(1);
    expect(board.summary.absenceAccounts).toBe(0);
    expect(board.rows).toHaveLength(0);
  });
});
