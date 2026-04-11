import { describe, expect, it } from "bun:test";
import { buildReputationSurfaceBoard } from "./reputation-surface";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";

const extracted = (): ExtractedDealData => ({
  record: {
    contactName: "Casey Brown",
    contactRole: "Owner",
    companyName: "Oak Ridge",
    companyType: null,
    decisionMakerStatus: "decision_maker",
    preferredContactChannel: "call",
    locationContext: null,
    additionalStakeholders: [],
  },
  opportunity: {
    machineInterest: null,
    equipmentCategory: null,
    equipmentMake: null,
    equipmentModel: null,
    attachmentsDiscussed: [],
    applicationUseCase: null,
    dealStage: null,
    intentLevel: "medium",
    urgencyLevel: "medium",
    timelineToBuy: null,
    financingInterest: "finance",
    newVsUsedPreference: "new",
    tradeInLikelihood: "unknown",
    budgetRange: null,
    budgetConfidence: "medium",
    competitorsMentioned: ["CAT"],
    keyConcerns: "Service response time",
    objections: ["Lead time"],
    quoteReadiness: "medium",
    nextStep: null,
    nextStepDeadline: null,
    actionItems: [],
    followUpDate: null,
  },
  operations: {
    branchRelevance: null,
    territorySignal: null,
    serviceOpportunity: true,
    partsOpportunity: false,
    rentalOpportunity: false,
    crossSellOpportunity: [],
    existingFleetContext: null,
    replacementTrigger: null,
    availabilitySensitivity: "medium",
    uptimeSensitivity: "high",
    jobsiteConditions: [],
    operatorSkillLevel: "experienced",
  },
  guidance: {
    customerSentiment: "neutral",
    probabilitySignal: "medium",
    stalledRisk: "medium",
    buyerPersona: "relationship_loyal",
    managerAttentionFlag: false,
    recommendedNextAction: null,
    recommendedFollowUpMode: "call",
    summaryForRep: null,
    summaryForManager: null,
  },
  evidence: {
    snippets: [],
    confidence: {},
  },
});

describe("buildReputationSurfaceBoard", () => {
  it("combines customer, field, shop, and auction signals into one board", () => {
    const board = buildReputationSurfaceBoard({
      accountId: "company-1",
      voiceSignals: [
        {
          createdAt: "2026-04-11T00:00:00.000Z",
          transcript: "Customer said lead time and service response are what people talk about.",
          extractedData: extracted(),
        },
      ],
      feedbackSignals: [
        {
          createdAt: "2026-04-10T00:00:00.000Z",
          returnVisitRisk: "high",
          timeSaverNotes: "Tech found a faster startup sequence.",
          serialSpecificNote: "Operator complains about cab vibration.",
        },
      ],
      knowledgeNotes: [
        {
          createdAt: "2026-04-09T00:00:00.000Z",
          noteType: "technician_gossip",
          content: "Local shop techs say this unit is reliable but the resale buyers watch hours closely.",
        },
      ],
      lifecycleEvents: [
        { eventType: "nps_response", eventAt: "2026-04-01T00:00:00.000Z", metadata: {} },
        { eventType: "churn_risk_flag", eventAt: "2026-04-05T00:00:00.000Z", metadata: {} },
      ],
      portalReviews: [
        {
          createdAt: "2026-04-08T00:00:00.000Z",
          status: "countered",
          counterNotes: "Need better delivery timing.",
          viewedAt: "2026-04-09T00:00:00.000Z",
          signedAt: null,
        },
      ],
      auctionSignals: [
        {
          make: "CAT",
          model: "259D",
          year: 2021,
          auctionDate: "2026-03-15T00:00:00.000Z",
          hammerPrice: 64500,
          location: "Atlanta",
        },
      ],
    });

    expect(board.summary.customerSignals).toBeGreaterThanOrEqual(2);
    expect(board.summary.fieldSignals).toBe(1);
    expect(board.summary.shopSignals).toBeGreaterThanOrEqual(2);
    expect(board.summary.marketSignals).toBe(1);
    expect(board.customerVoice[0]?.title).toContain("Customer response");
    expect(board.fieldTalk[0]?.confidence).toBe("high");
    expect(board.shopTalk[0]?.trace.join(" ")).toContain("Return visit risk");
    expect(board.marketTalk[0]?.href).toBe("/price-intelligence");
  });

  it("falls back cleanly when reputation signals are sparse", () => {
    const board = buildReputationSurfaceBoard({
      accountId: "company-1",
      voiceSignals: [],
      feedbackSignals: [],
      knowledgeNotes: [],
      lifecycleEvents: [],
      portalReviews: [],
      auctionSignals: [],
    });

    expect(board.summary.customerSignals).toBe(0);
    expect(board.fieldTalk).toHaveLength(0);
    expect(board.shopTalk).toHaveLength(0);
    expect(board.marketTalk).toHaveLength(0);
  });
});
