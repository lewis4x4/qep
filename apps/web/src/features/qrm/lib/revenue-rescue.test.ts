import { describe, expect, it } from "bun:test";
import { buildRevenueRescueBoard } from "./revenue-rescue";

describe("buildRevenueRescueBoard", () => {
  it("prioritizes rescue candidates using blockers, quote risk, and time pressure", () => {
    const board = buildRevenueRescueBoard({
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
      timeBankRows: [
        {
          deal_id: "deal-1",
          deal_name: "Acme loader",
          company_id: "company-1",
          company_name: "Acme",
          assigned_rep_id: null,
          assigned_rep_name: null,
          stage_id: "s1",
          stage_name: "Negotiation",
          days_in_stage: 20,
          stage_age_days: 20,
          budget_days: 14,
          has_explicit_budget: false,
          remaining_days: -6,
          pct_used: 1.4,
          is_over: true,
        },
      ],
      quoteRows: [
        {
          id: "quote-1",
          dealId: "deal-1",
          dealName: "Acme loader",
          contactName: "Ryan Smith",
          status: "sent",
          effectiveStatus: "sent",
          netTotal: 120000,
          marginPct: 11,
          ageDays: 18,
          daysUntilExpiry: 3,
          isSigned: false,
          isAging: true,
          isExpiringSoon: false,
          requiresRequote: false,
          entryMode: "guided",
        },
      ],
      blockedDeals: [
        {
          id: "block-1",
          dealId: "deal-1",
          dealName: "Acme loader",
          companyName: "Acme",
          contactName: "Ryan Smith",
          amount: 120000,
          stageName: "Negotiation",
          stageOrder: 10,
          category: "deposit_missing",
          detail: "Deposit missing",
          daysBlocked: 4,
          expectedClose: null,
        },
      ],
    });

    expect(board.summary.candidateCount).toBe(1);
    expect(board.summary.saveableWeightedRevenue).toBe(84000);
    expect(board.summary.blockedCount).toBe(1);
    expect(board.summary.quoteAtRiskCount).toBe(1);
    expect(board.summary.overTimeCount).toBe(1);
    expect(board.candidates[0]?.reasons.join(" | ")).toContain("Deposit missing");
    expect(board.candidates[0]?.reasons.join(" | ")).toContain("quote aging");
  });
});
