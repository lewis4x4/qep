import { describe, expect, it } from "bun:test";
import { buildCompetitiveThreatMapBoard } from "./competitive-threat-map";
import type { QrmWeightedDeal } from "./types";

const deals: QrmWeightedDeal[] = [
  {
    id: "deal-1",
    workspaceId: "default",
    name: "CAT 320",
    stageId: "stage-1",
    stageName: "Negotiation",
    stageProbability: 0.7,
    primaryContactId: null,
    companyId: "company-1",
    assignedRepId: "rep-1",
    amount: 120000,
    weightedAmount: 84000,
    expectedCloseOn: null,
    nextFollowUpAt: null,
    lastActivityAt: null,
    closedAt: null,
    hubspotDealId: null,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
  },
  {
    id: "deal-2",
    workspaceId: "default",
    name: "Deere 310",
    stageId: "stage-1",
    stageName: "Negotiation",
    stageProbability: 0.6,
    primaryContactId: null,
    companyId: "company-2",
    assignedRepId: "rep-1",
    amount: 90000,
    weightedAmount: 54000,
    expectedCloseOn: null,
    nextFollowUpAt: null,
    lastActivityAt: null,
    closedAt: null,
    hubspotDealId: null,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
  },
];

describe("buildCompetitiveThreatMapBoard", () => {
  it("rolls competitive pressure into account, rep, and branch threat rows", () => {
    const board = buildCompetitiveThreatMapBoard({
      defenseRows: [
        {
          companyId: "company-1",
          companyName: "Oak Ridge",
          weightedRevenue: 84000,
          competitorMentionCount: 2,
          matchingListings: 3,
          staleListings: 1,
          reasons: ["2 competitor mentions", "1 stale competitor listing"],
        },
        {
          companyId: "company-2",
          companyName: "River Dirt",
          weightedRevenue: 54000,
          competitorMentionCount: 1,
          matchingListings: 2,
          staleListings: 2,
          reasons: ["1 competitor mention", "2 stale competitor listings"],
        },
      ],
      takeShareRows: [
        {
          make: "CAT",
          model: "320",
          listingCount: 3,
          staleListingCount: 2,
          avgAsk: 110000,
          matchingAccounts: 2,
          weightedRevenue: 84000,
        },
      ],
      deals,
      repNameById: new Map([["rep-1", "Alex Rep"]]),
      branchNameById: new Map([["memphis", "Memphis Branch"]]),
      serviceLinks: [
        { branchId: "memphis", companyId: "company-1" },
        { branchId: "memphis", companyId: "company-2" },
      ],
    });

    expect(board.summary.threatenedAccounts).toBe(2);
    expect(board.summary.threatenedReps).toBe(1);
    expect(board.summary.threatenedBranches).toBe(1);
    expect(board.summary.takeShareWindows).toBe(1);
    expect(board.repRows[0]?.confidence).toBe("high");
    expect(board.branchRows[0]?.label).toBe("Memphis Branch");
  });
});
