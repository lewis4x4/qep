import { describe, expect, it } from "bun:test";
import { buildRelationshipMapBoard } from "./relationship-map";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";

const extracted = (status: string, name: string, stakeholders: string[] = []): ExtractedDealData => ({
  record: {
    contactName: name,
    contactRole: "Operations",
    companyName: "Oak Ridge Construction",
    companyType: null,
    decisionMakerStatus: status,
    preferredContactChannel: "call",
    locationContext: null,
    additionalStakeholders: stakeholders,
  },
  opportunity: {
    machineInterest: null,
    equipmentCategory: null,
    equipmentMake: null,
    equipmentModel: null,
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
    operatorSkillLevel: "experienced",
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
  },
  evidence: {
    snippets: [],
    confidence: {},
  },
});

describe("buildRelationshipMapBoard", () => {
  it("maps known contacts into signer, decider, influencer, operator, and blocker roles", () => {
    const board = buildRelationshipMapBoard({
      contacts: [
        { id: "c1", firstName: "Casey", lastName: "Brown", title: "Owner", email: "casey@example.com", phone: null },
        { id: "c2", firstName: "Alex", lastName: "Stone", title: "Foreman", email: "alex@example.com", phone: null },
      ],
      deals: [{ id: "d1", name: "Wheel Loader", primaryContactId: "c1" }],
      assessments: [
        { contactId: "c1", decisionMakerName: "Casey Brown", isDecisionMaker: true, createdAt: "2026-04-10T12:00:00.000Z" },
      ],
      voiceSignals: [
        { linkedContactId: "c2", createdAt: "2026-04-09T12:00:00.000Z", extractedData: extracted("operator", "Alex Stone", ["Pat Gate"]) },
        { linkedContactId: "c1", createdAt: "2026-04-08T12:00:00.000Z", extractedData: extracted("gatekeeper", "Casey Brown") },
      ],
      signatures: [{ dealId: "d1", signerName: "Casey Brown", signerEmail: "casey@example.com", signedAt: "2026-04-07T12:00:00.000Z" }],
    });

    expect(board.summary.contacts).toBe(2);
    expect(board.summary.signers).toBe(1);
    expect(board.summary.deciders).toBe(1);
    expect(board.summary.influencers).toBe(1);
    expect(board.summary.operators).toBe(1);
    expect(board.summary.blockers).toBe(1);
    expect(board.contacts[0]?.name).toBe("Casey Brown");
    expect(board.contacts[0]?.roles).toContain("signer");
    expect(board.contacts[0]?.roles).toContain("decider");
    expect(board.contacts[0]?.roles).toContain("blocker");
    expect(board.unmatchedStakeholders).toContain("Pat Gate");
  });

  it("captures unmatched signer and decision-maker names when they do not resolve to contacts", () => {
    const board = buildRelationshipMapBoard({
      contacts: [{ id: "c1", firstName: "Dana", lastName: "Mills", title: null, email: "dana@example.com", phone: null }],
      deals: [],
      assessments: [{ contactId: null, decisionMakerName: "Jordan Vale", isDecisionMaker: null, createdAt: "2026-04-10T12:00:00.000Z" }],
      voiceSignals: [],
      signatures: [{ dealId: null, signerName: "Morgan Reed", signerEmail: null, signedAt: "2026-04-07T12:00:00.000Z" }],
    });

    expect(board.summary.contacts).toBe(0);
    expect(board.unmatchedStakeholders).toContain("Jordan Vale");
    expect(board.unmatchedStakeholders).toContain("Morgan Reed");
  });
});
