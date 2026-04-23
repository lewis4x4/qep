import { describe, expect, it } from "bun:test";
import { buildScores } from "./decision-room-scoring";
import type { DecisionRoomSeat, SeatArchetype } from "./decision-room-archetype";

function seat(overrides: Partial<DecisionRoomSeat>): DecisionRoomSeat {
  return {
    id: "seat:test",
    status: "named",
    archetype: "champion",
    archetypeLabel: "Champion",
    name: "Test Seat",
    title: null,
    email: null,
    phone: null,
    confidence: "medium",
    stance: "neutral",
    powerWeight: 0.5,
    vetoWeight: 0.3,
    evidence: [],
    lastSignalAt: null,
    findGuidance: null,
    ...overrides,
  };
}

const NOW = new Date("2026-04-22T12:00:00Z");
const EXPECTED: SeatArchetype[] = ["economic_buyer", "operations", "champion"];

describe("buildScores", () => {
  it("computes a positive velocity offset from expected close date", () => {
    const scores = buildScores({
      seats: [seat({ id: "s1", archetype: "champion", stance: "champion" })],
      expectedArchetypes: EXPECTED,
      expectedCloseOn: "2026-05-22",
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      blockerPresent: false,
      now: NOW,
    });
    expect(scores.decisionVelocity.days).toBe(30);
  });

  it("slows velocity per seated blocker", () => {
    const scores = buildScores({
      seats: [
        seat({ id: "s1", stance: "champion" }),
        seat({ id: "s2", stance: "blocker", archetype: "operations", archetypeLabel: "Operations" }),
      ],
      expectedArchetypes: EXPECTED,
      expectedCloseOn: "2026-05-22",
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      blockerPresent: true,
      now: NOW,
    });
    expect(scores.decisionVelocity.days).toBeGreaterThan(30);
    expect(scores.decisionVelocity.trace.some((t) => t.includes("blocker"))).toBe(true);
  });

  it("speeds velocity when a quote is already out", () => {
    const base = buildScores({
      seats: [seat({ stance: "champion" })],
      expectedArchetypes: EXPECTED,
      expectedCloseOn: "2026-05-22",
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      blockerPresent: false,
      now: NOW,
    });
    const withQuote = buildScores({
      seats: [seat({ stance: "champion" })],
      expectedArchetypes: EXPECTED,
      expectedCloseOn: "2026-05-22",
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: true,
      blockerPresent: false,
      now: NOW,
    });
    expect(withQuote.decisionVelocity.days).toBeLessThan(base.decisionVelocity.days ?? 0);
  });

  it("reports 100% coverage when every expected archetype is named", () => {
    const scores = buildScores({
      seats: [
        seat({ id: "s1", archetype: "economic_buyer", archetypeLabel: "Economic Buyer" }),
        seat({ id: "s2", archetype: "operations", archetypeLabel: "Operations" }),
        seat({ id: "s3", archetype: "champion", archetypeLabel: "Champion" }),
      ],
      expectedArchetypes: EXPECTED,
      expectedCloseOn: null,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      blockerPresent: false,
      now: NOW,
    });
    expect(scores.coverage.value).toBe(1);
    expect(scores.coverage.missingArchetypes).toHaveLength(0);
  });

  it("reports missing archetypes by name when partial", () => {
    const scores = buildScores({
      seats: [
        seat({ id: "s1", archetype: "champion", archetypeLabel: "Champion" }),
      ],
      expectedArchetypes: EXPECTED,
      expectedCloseOn: null,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      blockerPresent: false,
      now: NOW,
    });
    expect(scores.coverage.missingArchetypes).toContain("economic_buyer");
    expect(scores.coverage.missingArchetypes).toContain("operations");
    expect(scores.coverage.trace.some((t) => t.includes("Missing"))).toBe(true);
  });

  it("raises consensus risk to high when a named blocker exists", () => {
    const scores = buildScores({
      seats: [
        seat({ id: "s1", stance: "blocker", name: "Dana Blocker" }),
        seat({ id: "s2", stance: "champion" }),
      ],
      expectedArchetypes: EXPECTED,
      expectedCloseOn: null,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      blockerPresent: true,
      now: NOW,
    });
    expect(scores.consensusRisk.level).toBe("high");
  });

  it("raises latent veto to high when the economic buyer is a ghost", () => {
    const scores = buildScores({
      seats: [
        seat({ id: "s1", archetype: "operator", archetypeLabel: "Operator", powerWeight: 0.25, vetoWeight: 0.1 }),
        seat({
          id: "ghost:economic_buyer",
          status: "ghost",
          name: null,
          archetype: "economic_buyer",
          archetypeLabel: "Economic Buyer",
          powerWeight: 1.0,
          vetoWeight: 1.0,
        }),
      ],
      expectedArchetypes: EXPECTED,
      expectedCloseOn: null,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      blockerPresent: false,
      now: NOW,
    });
    expect(scores.latentVeto.level).toBe("high");
    expect(scores.latentVeto.topGhostArchetype).toBe("economic_buyer");
  });

  it("returns low latent veto when the room has no ghost seats", () => {
    const scores = buildScores({
      seats: [seat({ archetype: "champion" })],
      expectedArchetypes: ["champion"],
      expectedCloseOn: null,
      openTaskCount: 0,
      overdueTaskCount: 0,
      pendingApprovalCount: 0,
      quotePresented: false,
      blockerPresent: false,
      now: NOW,
    });
    expect(scores.latentVeto.level).toBe("low");
    expect(scores.latentVeto.topGhostArchetype).toBeNull();
  });
});
