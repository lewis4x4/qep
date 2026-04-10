import { describe, expect, it } from "bun:test";
import { buildOperatorIntelligenceBoard } from "./operator-intelligence";

describe("buildOperatorIntelligenceBoard", () => {
  it("aggregates operator complaints, preferences, and field learnings by account", () => {
    const board = buildOperatorIntelligenceBoard({
      voiceSignals: [
        {
          companyId: "company-1",
          companyName: "Acme",
          createdAt: "2026-04-10T10:00:00.000Z",
          transcript: "Operators hate the cab heat and prefer text follow-up.",
          extractedData: {
            record: {
              contactName: null,
              contactRole: null,
              companyName: "Acme",
              companyType: null,
              decisionMakerStatus: "operator",
              preferredContactChannel: "text",
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
              urgencyLevel: "normal",
              timelineToBuy: null,
              financingInterest: "unknown",
              newVsUsedPreference: "used",
              tradeInLikelihood: "unknown",
              budgetRange: null,
              budgetConfidence: "unknown",
              competitorsMentioned: [],
              keyConcerns: "cab heat and visibility",
              objections: [],
              quoteReadiness: "unknown",
              nextStep: null,
              nextStepDeadline: null,
              actionItems: [],
              followUpDate: null,
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
              availabilitySensitivity: "normal",
              uptimeSensitivity: "high",
              jobsiteConditions: [],
              operatorSkillLevel: "experienced",
            },
            guidance: {
              customerSentiment: "neutral",
              probabilitySignal: "medium",
              stalledRisk: "low",
              buyerPersona: "unknown",
              managerAttentionFlag: false,
              recommendedNextAction: null,
              recommendedFollowUpMode: "text",
              summaryForRep: null,
              summaryForManager: null,
            },
            evidence: { snippets: [], confidence: {} },
          },
        },
      ],
      feedbackSignals: [
        {
          companyId: "company-1",
          companyName: "Acme",
          createdAt: "2026-04-11T10:00:00.000Z",
          timeSaverNotes: "Bring the seal kit before opening the side panel.",
          serialSpecificNote: null,
          returnVisitRisk: "high",
        },
      ],
    });

    expect(board.summary.accounts).toBe(1);
    expect(board.summary.concerns).toBe(1);
    expect(board.summary.preferences).toBe(3);
    expect(board.summary.highRiskReturns).toBe(1);
    expect(board.summary.workarounds).toBe(1);
    expect(board.accounts[0]?.companyId).toBe("company-1");
    expect(board.accounts[0]?.highlights.join(" | ")).toContain("cab heat and visibility");
    expect(board.accounts[0]?.highlights.join(" | ")).toContain("text");
    expect(board.accounts[0]?.highlights.join(" | ")).toContain("Bring the seal kit");
  });
});
