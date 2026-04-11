import { describe, expect, it } from "bun:test";
import { buildCustomerStrategistBoard } from "./customer-strategist";
import type { CustomerOperatingProfileBoard } from "./customer-operating-profile";
import type { WhiteSpaceMapBoard } from "./white-space-map";
import type { RelationshipMapBoard } from "./relationship-map";
import type { RentalConversionBoard } from "./rental-conversion";

const operatingProfile: CustomerOperatingProfileBoard = {
  summary: {
    assessments: 3,
    latestAssessmentAt: "2026-04-11T00:00:00.000Z",
    monthlyTargetAssessments: 1,
    financingTaggedAssessments: 2,
  },
  workType: { label: "Work Type", primary: "Site Prep", supporting: [] },
  terrain: { label: "Terrain", primary: "Rocky Clay", supporting: [] },
  brandPreference: { label: "Brand Preference", primary: "CAT", supporting: [] },
  budgetBehavior: { label: "Budget Behavior", primary: "September budget-cycle motion", supporting: [] },
  buyingStyle: { label: "Buying Style", primary: "Relationship-led buying style", supporting: [] },
  recentAssessments: [],
};

const whiteSpace: WhiteSpaceMapBoard = {
  summary: {
    total: 3,
    replacement: 1,
    attachment: 1,
    serviceCoverage: 1,
    partsPenetration: 0,
  },
  opportunities: [
    {
      id: "replacement:eq-1",
      type: "replacement",
      title: "CAT 320 replacement whitespace",
      detail: "Replacement window is opening.",
      confidence: "high",
      estimatedRevenue: 180000,
      equipmentId: "eq-1",
      evidence: ["Predicted replacement date 2026-06-01.", "82% replacement confidence."],
    },
    {
      id: "service-coverage",
      type: "service_coverage",
      title: "Service coverage whitespace",
      detail: "Room to capture more planned service revenue.",
      confidence: "medium",
      estimatedRevenue: null,
      equipmentId: null,
      evidence: ["Service contract rate 25%.", "2 owned machines on file."],
    },
    {
      id: "attachment:eq-2",
      type: "attachment",
      title: "Attachment whitespace",
      detail: "No registered attachments.",
      confidence: "medium",
      estimatedRevenue: null,
      equipmentId: "eq-2",
      evidence: ["Attachment inventory count is zero."],
    },
  ],
};

const relationships: RelationshipMapBoard = {
  summary: {
    contacts: 3,
    signers: 1,
    deciders: 1,
    influencers: 1,
    operators: 1,
    blockers: 1,
  },
  contacts: [],
  unmatchedStakeholders: ["Pat Gate"],
};

const rentalConversion: RentalConversionBoard = {
  summary: {
    candidates: 1,
    repeatRentalCandidates: 1,
    rentalIntentSignals: 2,
    purchaseReadySignals: 1,
    openQuotes: 1,
  },
  candidates: [
    {
      id: "cat:259d:2022",
      title: "CAT 259D",
      rentalDealCount: 2,
      rentalFirstSignals: 1,
      rentToOwnSignals: 1,
      purchaseReadySignals: 1,
      openQuoteCount: 1,
      confidence: "high",
      estimatedPurchaseValue: 78000,
      reasons: ["2 rental-linked deals on this account.", "1 purchase-ready signal."],
      equipmentIds: ["eq-rental-1"],
    },
  ],
};

describe("buildCustomerStrategistBoard", () => {
  it("turns account intelligence into 30/60/90 plays with confidence and trace", () => {
    const board = buildCustomerStrategistBoard({
      accountId: "company-1",
      operatingProfile,
      whiteSpace,
      relationships,
      rentalConversion,
    });

    expect(board.summary.totalPlays).toBeGreaterThanOrEqual(6);
    expect(board.summary.immediatePlays).toBeGreaterThanOrEqual(2);
    expect(board.plans[0]?.horizon).toBe("30d");
    expect(board.plans[0]?.confidence).toBe("high");
    expect(board.plans[1]?.headline).toContain("Expand");
    expect(board.plans[2]?.plays[0]?.trace.join(" ")).toContain("Work type");
  });

  it("falls back gracefully when the account intelligence is quiet", () => {
    const board = buildCustomerStrategistBoard({
      accountId: "company-1",
      operatingProfile,
      whiteSpace: { summary: { total: 0, replacement: 0, attachment: 0, serviceCoverage: 0, partsPenetration: 0 }, opportunities: [] },
      relationships: { summary: { contacts: 0, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 }, contacts: [], unmatchedStakeholders: [] },
      rentalConversion: { summary: { candidates: 0, repeatRentalCandidates: 0, rentalIntentSignals: 0, purchaseReadySignals: 0, openQuotes: 0 }, candidates: [] },
    });

    expect(board.plans).toHaveLength(3);
    expect(board.plans[0]?.plays[0]?.confidence).toBe("low");
    expect((board.plans[1]?.plays.length ?? 0) > 0).toBe(true);
    expect(board.plans[1]?.plays[0]?.confidence).toBe("low");
  });
});
