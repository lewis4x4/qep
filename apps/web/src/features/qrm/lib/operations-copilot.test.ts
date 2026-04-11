import { describe, expect, it } from "bun:test";
import { buildOperationsCopilotBoard } from "./operations-copilot";
import type { QrmWeightedDeal } from "./types";

const deals: QrmWeightedDeal[] = [
  {
    id: "deal-1",
    workspaceId: "default",
    name: "CAT 320 Sale",
    stageId: "stage-1",
    stageName: "Quote",
    stageProbability: 0.6,
    primaryContactId: null,
    companyId: "company-1",
    assignedRepId: "rep-1",
    amount: 150000,
    weightedAmount: 90000,
    expectedCloseOn: null,
    nextFollowUpAt: null,
    lastActivityAt: null,
    closedAt: null,
    hubspotDealId: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
  },
];

describe("buildOperationsCopilotBoard", () => {
  it("turns incomplete deals, delayed deposits, and billing issues into recommendations", () => {
    const board = buildOperationsCopilotBoard({
      deals,
      deposits: [
        {
          id: "dep-1",
          dealId: "deal-1",
          status: "received",
          requiredAmount: 10000,
          createdAt: "2026-04-05T00:00:00.000Z",
          receivedAt: "2026-04-07T00:00:00.000Z",
          verificationCycleHours: 72,
        },
      ],
      billingDrafts: [
        {
          id: "bill-1",
          serviceJobId: "job-1",
          createdAt: "2026-04-07T00:00:00.000Z",
          lineTotal: 2400,
          description: "Hydraulic hose",
          status: "draft",
        },
      ],
      invoicesMissingBranch: [
        {
          id: "inv-1",
          invoiceNumber: "INV-100",
          serviceJobId: "job-1",
          status: "pending",
        },
      ],
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.recommendationCount).toBe(3);
    expect(board.summary.incompleteDeals).toBe(1);
    expect(board.summary.delayedDeposits).toBe(1);
    expect(board.summary.billingIssues).toBe(2);
    expect(board.recommendations[0]?.confidence).toBe("medium");
    expect(board.recommendations.some((item) => item.category === "billing_handoff")).toBe(true);
  });

  it("falls back to steady-state guidance when no ops issue is elevated", () => {
    const board = buildOperationsCopilotBoard({
      deals: [],
      deposits: [],
      billingDrafts: [],
      invoicesMissingBranch: [],
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.recommendationCount).toBe(1);
    expect(board.recommendations[0]?.confidence).toBe("low");
    expect(board.recommendations[0]?.headline).toContain("steady");
  });
});
