import { describe, expect, it } from "bun:test";
import { buildRentalConversionBoard } from "./rental-conversion";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";

function signal(overrides?: Partial<ExtractedDealData>): ExtractedDealData {
  return {
    record: {
      contactName: null,
      contactRole: null,
      companyName: "Oak Ridge Construction",
      companyType: null,
      decisionMakerStatus: "unknown",
      preferredContactChannel: "call",
      locationContext: null,
      additionalStakeholders: [],
    },
    opportunity: {
      machineInterest: null,
      equipmentCategory: null,
      equipmentMake: "CAT",
      equipmentModel: "259D",
      attachmentsDiscussed: [],
      applicationUseCase: null,
      dealStage: null,
      intentLevel: "unknown",
      urgencyLevel: "unknown",
      timelineToBuy: null,
      financingInterest: "unknown",
      newVsUsedPreference: "unknown",
      tradeInLikelihood: "unknown",
      budgetRange: null,
      budgetConfidence: "unknown",
      competitorsMentioned: [],
      keyConcerns: null,
      objections: [],
      quoteReadiness: "unknown",
      nextStep: null,
      nextStepDeadline: null,
      actionItems: [],
      followUpDate: null,
      ...overrides?.opportunity,
    },
    operations: {
      branchRelevance: null,
      territorySignal: null,
      serviceOpportunity: false,
      partsOpportunity: false,
      rentalOpportunity: false,
      crossSellOpportunity: [],
      existingFleetContext: null,
      replacementTrigger: null,
      availabilitySensitivity: "unknown",
      uptimeSensitivity: "unknown",
      jobsiteConditions: [],
      operatorSkillLevel: "unknown",
      ...overrides?.operations,
    },
    guidance: {
      customerSentiment: "neutral",
      probabilitySignal: "unknown",
      stalledRisk: "unknown",
      buyerPersona: "unknown",
      managerAttentionFlag: false,
      recommendedNextAction: null,
      recommendedFollowUpMode: "unknown",
      summaryForRep: null,
      summaryForManager: null,
      ...overrides?.guidance,
    },
    evidence: {
      snippets: [],
      confidence: {},
      ...overrides?.evidence,
    },
  };
}

describe("buildRentalConversionBoard", () => {
  it("promotes repeat rental motion with rental-first and purchase-ready signals", () => {
    const board = buildRentalConversionBoard({
      deals: [
        { id: "d1", name: "Rental 1", createdAt: "2026-04-01T00:00:00.000Z" },
        { id: "d2", name: "Rental 2", createdAt: "2026-04-05T00:00:00.000Z" },
      ],
      rentalLinks: [
        { dealId: "d1", equipmentId: "eq-1", make: "CAT", model: "259D", year: 2022, name: "CAT 259D", dailyRentalRate: 425, currentMarketValue: 78000 },
        { dealId: "d2", equipmentId: "eq-2", make: "CAT", model: "259D", year: 2022, name: "CAT 259D", dailyRentalRate: 425, currentMarketValue: 80000 },
      ],
      voiceSignals: [
        { createdAt: "2026-04-03T00:00:00.000Z", extractedData: signal({ guidance: { buyerPersona: "rental_first" }, operations: { rentalOpportunity: true } }) },
        { createdAt: "2026-04-06T00:00:00.000Z", extractedData: signal({ opportunity: { financingInterest: "rent_to_own", intentLevel: "quote_ready" } }) },
      ],
      openQuoteCount: 1,
    });

    expect(board.summary.candidates).toBe(1);
    expect(board.summary.repeatRentalCandidates).toBe(1);
    expect(board.summary.rentalIntentSignals).toBe(3);
    expect(board.summary.purchaseReadySignals).toBe(1);
    expect(board.candidates[0]?.confidence).toBe("high");
    expect(board.candidates[0]?.estimatedPurchaseValue).toBe(78000);
    expect(board.candidates[0]?.reasons.join(" ")).toContain("2 rental-linked deals");
  });

  it("stays quiet when there is no rental behavior or rental-first signal", () => {
    const board = buildRentalConversionBoard({
      deals: [],
      rentalLinks: [],
      voiceSignals: [],
      openQuoteCount: 0,
    });

    expect(board.summary.candidates).toBe(0);
    expect(board.candidates).toHaveLength(0);
  });
});
