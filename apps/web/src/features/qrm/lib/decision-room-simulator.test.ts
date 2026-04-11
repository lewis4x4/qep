import { describe, expect, it } from "bun:test";
import { buildDecisionRoomBoard } from "./decision-room-simulator";
import type { RelationshipMapBoard } from "./relationship-map";
import type { NeedsAssessment } from "./deal-composite-types";

const relationship: RelationshipMapBoard = {
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
      email: "casey@example.com",
      phone: null,
      roles: ["signer", "blocker"],
      evidence: ["Signed quote as Casey Brown", "Voice capture labeled blocker"],
      lastSignalAt: "2026-04-11T00:00:00.000Z",
    },
    {
      contactId: "c2",
      name: "Alex Stone",
      title: "Foreman",
      email: "alex@example.com",
      phone: null,
      roles: ["operator"],
      evidence: ["Voice capture labeled operator"],
      lastSignalAt: "2026-04-10T00:00:00.000Z",
    },
    {
      contactId: "c3",
      name: "Pat Hill",
      title: "Project Lead",
      email: "pat@example.com",
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
  it("projects literal humans and scenarios in the decision room", () => {
    const board = buildDecisionRoomBoard({
      dealId: "deal-1",
      relationship,
      needsAssessment,
      blockerPresent: true,
      openTaskCount: 3,
      overdueTaskCount: 1,
      pendingApprovalCount: 2,
      quotePresented: true,
    });

    expect(board.summary.namedParticipants).toBe(3);
    expect(board.summary.ghostParticipants).toBe(1);
    expect(board.summary.blockerCount).toBe(2);
    expect(board.summary.scenarioCount).toBeGreaterThanOrEqual(4);
    expect(board.seats[0]?.label).toBe("Casey Brown");
    expect(board.scenarios.some((row) => row.title.includes("hidden decider") || row.title.includes("outside the visible room"))).toBe(true);
    expect(board.scenarios.some((row) => row.title.includes("payment framing"))).toBe(true);
  });

  it("falls back cleanly when the room is stable", () => {
    const board = buildDecisionRoomBoard({
      dealId: "deal-1",
      relationship: {
        summary: { contacts: 1, signers: 0, deciders: 1, influencers: 0, operators: 0, blockers: 0 },
        contacts: [{
          contactId: "c1",
          name: "Dana Mills",
          title: "Owner",
          email: "dana@example.com",
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
    });

    expect(board.summary.scenarioCount).toBe(1);
    expect(board.scenarios[0]?.confidence).toBe("low");
  });
});
