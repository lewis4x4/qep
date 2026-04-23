import { describe, expect, it } from "bun:test";
import { buildDecisionRoomBoard } from "./decision-room-simulator";
import type { RelationshipMapBoard } from "./relationship-map";
import type { NeedsAssessment } from "./deal-composite-types";

const richRelationship: RelationshipMapBoard = {
  summary: {
    contacts: 3,
    signers: 1,
    deciders: 0,
    influencers: 1,
    operators: 1,
    blockers: 1,
  },
  contacts: [
    {
      contactId: "c1",
      name: "Casey Brown",
      title: "Owner",
      email: "casey@acme.com",
      phone: null,
      roles: ["signer", "blocker"],
      evidence: ["Signed quote as Casey Brown", "Voice capture labeled blocker"],
      lastSignalAt: "2026-04-11T00:00:00.000Z",
    },
    {
      contactId: "c2",
      name: "Alex Stone",
      title: "Foreman",
      email: "alex@acme.com",
      phone: null,
      roles: ["operator"],
      evidence: ["Voice capture labeled operator"],
      lastSignalAt: "2026-04-10T00:00:00.000Z",
    },
    {
      contactId: "c3",
      name: "Pat Hill",
      title: "Project Lead",
      email: "pat@acme.com",
      phone: null,
      roles: ["influencer"],
      evidence: ["Primary contact on deal"],
      lastSignalAt: "2026-04-09T00:00:00.000Z",
    },
  ],
  unmatchedStakeholders: ["Jordan Vale"],
};

const needsAssessment: NeedsAssessment = {
  id: "na-1",
  application: "construction",
  work_type: "site_prep",
  terrain_material: "rock",
  current_equipment: "Old skid steer",
  current_equipment_issues: "Hydraulic downtime every week",
  machine_interest: "Compact track loader",
  attachments_needed: ["bucket"],
  brand_preference: "CAT",
  timeline_description: "Within 30 days",
  timeline_urgency: "high",
  budget_type: "monthly_payment",
  budget_amount: null,
  monthly_payment_target: 3200,
  financing_preference: "finance",
  has_trade_in: false,
  trade_in_details: null,
  is_decision_maker: false,
  decision_maker_name: "Jordan Vale",
  next_step: "Review quote",
  entry_method: "rep",
  qrm_narrative: null,
  completeness_pct: 82,
  fields_populated: 14,
  fields_total: 17,
};

describe("buildDecisionRoomBoard", () => {
  it("classifies titled contacts into their canonical archetype", () => {
    const board = buildDecisionRoomBoard({
      dealId: "deal-1",
      dealName: "Acme CTL",
      dealAmount: 120_000,
      expectedCloseOn: "2026-05-30",
      companyName: "Acme Excavation",
      relationship: richRelationship,
      needsAssessment,
      blockerPresent: true,
      openTaskCount: 3,
      overdueTaskCount: 1,
      pendingApprovalCount: 2,
      quotePresented: true,
      now: new Date("2026-04-22T12:00:00Z"),
    });

    const owner = board.seats.find((s) => s.name === "Casey Brown");
    expect(owner?.archetype).toBe("economic_buyer");
    expect(owner?.stance).toBe("blocker");

    const operator = board.seats.find((s) => s.name === "Alex Stone");
    expect(operator?.archetype).toBe("operator");
  });

  it("lifts an assessment-named decision maker to an economic buyer ghost", () => {
    const board = buildDecisionRoomBoard({
      dealId: "deal-1",
      dealName: null,
      dealAmount: 90_000,
      expectedCloseOn: "2026-05-30",
      companyName: "Acme Excavation",
      relationship: richRelationship,
      needsAssessment,
      blockerPresent: true,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      now: new Date("2026-04-22T12:00:00Z"),
    });

    const jordan = board.seats.find((s) => s.name === "Jordan Vale");
    expect(jordan?.status).toBe("ghost");
    expect(jordan?.archetype).toBe("economic_buyer");
    expect(jordan?.findGuidance?.searchQuery).toContain("Economic Buyer");
  });

  it("creates archetype gap ghosts for seats the room always expects", () => {
    const board = buildDecisionRoomBoard({
      dealId: "deal-1",
      dealName: "Sparse Deal",
      dealAmount: 50_000,
      expectedCloseOn: null,
      companyName: "Sparse Co",
      relationship: {
        summary: { contacts: 0, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 },
        contacts: [],
        unmatchedStakeholders: [],
      },
      needsAssessment: null,
      blockerPresent: false,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      now: new Date("2026-04-22T12:00:00Z"),
    });

    const archetypes = new Set(board.seats.map((s) => s.archetype));
    expect(archetypes.has("champion")).toBe(true);
    expect(archetypes.has("economic_buyer")).toBe(true);
    expect(archetypes.has("operations")).toBe(true);
    expect(board.seats.every((s) => s.status === "ghost")).toBe(true);
  });

  it("scores coverage against expected archetypes and traces the missing ones", () => {
    const board = buildDecisionRoomBoard({
      dealId: "deal-1",
      dealName: "Half-covered",
      dealAmount: 180_000,
      expectedCloseOn: "2026-06-30",
      companyName: "Acme",
      relationship: {
        summary: { contacts: 1, signers: 0, deciders: 1, influencers: 0, operators: 0, blockers: 0 },
        contacts: [{
          contactId: "c1",
          name: "Dana Mills",
          title: "Owner",
          email: "dana@acme.com",
          phone: null,
          roles: ["decider"],
          evidence: ["Marked as decision maker in needs assessment"],
          lastSignalAt: "2026-04-11T00:00:00.000Z",
        }],
        unmatchedStakeholders: [],
      },
      needsAssessment: null,
      blockerPresent: false,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      now: new Date("2026-04-22T12:00:00Z"),
    });

    expect(board.scores.coverage.filled).toBe(1);
    expect(board.scores.coverage.expected).toBeGreaterThan(1);
    expect(board.scores.coverage.missingArchetypes.length).toBeGreaterThan(0);
    expect(board.scores.coverage.value).toBeLessThan(1);
  });

  it("flags high latent veto when the economic buyer is a ghost", () => {
    const board = buildDecisionRoomBoard({
      dealId: "deal-1",
      dealName: "No-EB Deal",
      dealAmount: 70_000,
      expectedCloseOn: "2026-05-30",
      companyName: "Acme",
      relationship: {
        summary: { contacts: 1, signers: 0, deciders: 0, influencers: 0, operators: 1, blockers: 0 },
        contacts: [{
          contactId: "c1",
          name: "Morgan Reed",
          title: "Foreman",
          email: "morgan@acme.com",
          phone: null,
          roles: ["operator"],
          evidence: ["Primary contact on deal"],
          lastSignalAt: "2026-04-11T00:00:00.000Z",
        }],
        unmatchedStakeholders: [],
      },
      needsAssessment: null,
      blockerPresent: false,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      now: new Date("2026-04-22T12:00:00Z"),
    });

    expect(board.scores.latentVeto.level).toBe("high");
    expect(board.scores.latentVeto.topGhostArchetype).toBe("economic_buyer");
  });

  it("raises consensus risk when a named blocker is in the room", () => {
    const board = buildDecisionRoomBoard({
      dealId: "deal-1",
      dealName: "Contentious",
      dealAmount: 100_000,
      expectedCloseOn: "2026-05-30",
      companyName: "Acme",
      relationship: richRelationship,
      needsAssessment,
      blockerPresent: true,
      openTaskCount: 1,
      overdueTaskCount: 1,
      pendingApprovalCount: 0,
      quotePresented: false,
      now: new Date("2026-04-22T12:00:00Z"),
    });

    expect(board.scores.consensusRisk.level).toBe("high");
    expect(board.scores.decisionVelocity.trace.some((line) => line.includes("blocker"))).toBe(true);
  });
});
