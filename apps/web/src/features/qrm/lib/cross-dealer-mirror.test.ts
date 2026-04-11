import { describe, expect, it } from "bun:test";
import { buildCrossDealerMirrorBoard } from "./cross-dealer-mirror";
import type { CustomerOperatingProfileBoard } from "./customer-operating-profile";
import type { WhiteSpaceMapBoard } from "./white-space-map";
import type { RelationshipMapBoard } from "./relationship-map";
import type { FleetIntelligenceBoard } from "./fleet-intelligence";

const operatingProfile: CustomerOperatingProfileBoard = {
  summary: {
    assessments: 4,
    latestAssessmentAt: "2026-04-11T00:00:00.000Z",
    monthlyTargetAssessments: 2,
    financingTaggedAssessments: 3,
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
    total: 4,
    replacement: 1,
    attachment: 1,
    serviceCoverage: 1,
    partsPenetration: 1,
  },
  opportunities: [
    {
      id: "replacement:eq-1",
      type: "replacement",
      title: "CAT 320 replacement whitespace",
      detail: "This unit enters a modeled replacement window in 45 days.",
      confidence: "high",
      estimatedRevenue: 180000,
      equipmentId: "eq-1",
      evidence: ["Predicted replacement date 2026-06-01.", "82% replacement confidence."],
    },
    {
      id: "service-coverage",
      type: "service_coverage",
      title: "Service coverage whitespace",
      detail: "Fleet size and service behavior suggest room to capture more planned service revenue.",
      confidence: "medium",
      estimatedRevenue: null,
      equipmentId: null,
      evidence: ["Service contract rate 25%.", "3 service jobs currently attached to the account."],
    },
    {
      id: "attachment:eq-2",
      type: "attachment",
      title: "Attachment whitespace",
      detail: "No registered attachments are tied to this machine.",
      confidence: "medium",
      estimatedRevenue: null,
      equipmentId: "eq-2",
      evidence: ["Attachment inventory count is zero."],
    },
    {
      id: "parts-penetration",
      type: "parts_penetration",
      title: "Parts penetration whitespace",
      detail: "Recurring parts revenue is under-captured.",
      confidence: "medium",
      estimatedRevenue: null,
      equipmentId: null,
      evidence: ["1 parts order against 4 owned machines."],
    },
  ],
};

const relationships: RelationshipMapBoard = {
  summary: {
    contacts: 3,
    signers: 1,
    deciders: 0,
    influencers: 2,
    operators: 1,
    blockers: 1,
  },
  contacts: [],
  unmatchedStakeholders: ["Pat Gate"],
};

const fleet: FleetIntelligenceBoard = {
  summary: {
    ownedMachines: 4,
    avgAgeYears: 7,
    avgHours: 4200,
    attachmentGaps: 2,
    replacementWindowMachines: 2,
  },
  machines: [],
};

describe("buildCrossDealerMirrorBoard", () => {
  it("projects a competitor view with attack paths and counter-moves", () => {
    const board = buildCrossDealerMirrorBoard({
      accountId: "company-1",
      operatingProfile,
      whiteSpace,
      relationships,
      fleet,
      openServiceJobs: 3,
      openQuoteCount: 2,
      expiringQuoteCount: 1,
      competitorMentionCount: 2,
      matchingListings: 3,
      staleListings: 1,
    });

    expect(board.summary.visibleSignals).toBeGreaterThanOrEqual(4);
    expect(board.summary.attackPaths).toBeGreaterThanOrEqual(4);
    expect(board.summary.buyerGaps).toBe(3);
    expect(board.summary.urgencyScore).toBeGreaterThan(60);
    expect(board.theirView[0]?.title).toContain("replacement");
    expect(board.likelyPlays.some((row) => row.title.includes("trade-up ROI"))).toBe(true);
    expect(board.counterMoves.some((row) => row.href.endsWith("/strategist"))).toBe(true);
  });
});
