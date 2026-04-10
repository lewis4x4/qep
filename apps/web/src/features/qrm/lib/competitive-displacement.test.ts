import { describe, expect, it } from "bun:test";
import { buildCompetitiveDisplacementBoard } from "./competitive-displacement";

describe("buildCompetitiveDisplacementBoard", () => {
  it("combines competitor mentions, listing age, and weighted revenue", () => {
    const board = buildCompetitiveDisplacementBoard({
      listings: [
        {
          id: "listing-1",
          make: "CAT",
          model: "320",
          askingPrice: 115000,
          firstSeenAt: "2026-03-01T00:00:00.000Z",
          lastSeenAt: "2026-04-10T00:00:00.000Z",
          source: "dealer-site",
          location: "Memphis",
        },
      ],
      equipment: [
        {
          companyId: "company-1",
          companyName: "Acme",
          make: "CAT",
          model: "320",
        },
      ],
      voiceSignals: [
        {
          companyId: "company-1",
          mentions: ["CAT", "CAT"],
        },
      ],
      deals: [
        {
          id: "deal-1",
          workspaceId: "default",
          name: "Acme loader",
          stageId: "s1",
          stageName: "Negotiation",
          stageProbability: 70,
          primaryContactId: null,
          companyId: "company-1",
          assignedRepId: null,
          amount: 120000,
          weightedAmount: 84000,
          expectedCloseOn: null,
          nextFollowUpAt: null,
          lastActivityAt: null,
          closedAt: null,
          hubspotDealId: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      nowTime: Date.parse("2026-04-10T12:00:00.000Z"),
    });

    expect(board.summary.threatenedAccounts).toBe(1);
    expect(board.summary.takeShareWindows).toBe(1);
    expect(board.summary.activeListings).toBe(1);
    expect(board.summary.staleListings).toBe(1);
    expect(board.defenseRows[0]?.companyId).toBe("company-1");
    expect(board.defenseRows[0]?.reasons.join(" | ")).toContain("2 competitor mentions");
    expect(board.takeShareRows[0]?.weightedRevenue).toBe(84000);
  });
});
