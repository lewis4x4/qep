import { describe, expect, it } from "bun:test";
import { projectAllHorizons, projectFutureState } from "./decision-room-future";
import type { DecisionRoomBoard } from "./decision-room-simulator";
import type { DecisionRoomSeat } from "./decision-room-archetype";

function seat(overrides: Partial<DecisionRoomSeat>): DecisionRoomSeat {
  return {
    id: "contact:test",
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

function board(overrides: Partial<DecisionRoomBoard>): DecisionRoomBoard {
  return {
    dealId: "deal",
    dealName: "Test",
    companyName: "Co",
    seats: [],
    expectedArchetypes: ["champion", "economic_buyer", "operations"],
    scores: {
      decisionVelocity: { days: 30, confidence: "medium", trace: [] },
      coverage: { value: 1, filled: 3, expected: 3, missingArchetypes: [], trace: [] },
      consensusRisk: { level: "low", trace: [] },
      latentVeto: { level: "low", topGhostArchetype: null, trace: [] },
    },
    snapshotAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("projectFutureState", () => {
  it("returns zero drift when the room is stable", () => {
    const b = board({
      seats: [seat({ stance: "champion" })],
    });
    const result = projectFutureState(b, "7d");
    expect(result.velocityDrift).toBe(0);
    expect(result.headline).toContain("Holds steady");
  });

  it("accumulates drift per high-veto ghost per week", () => {
    const b = board({
      seats: [
        seat({
          id: "ghost:economic_buyer",
          status: "ghost",
          archetype: "economic_buyer",
          archetypeLabel: "Economic Buyer",
          vetoWeight: 1.0,
          powerWeight: 1.0,
        }),
      ],
    });
    const result7 = projectFutureState(b, "7d");
    const result30 = projectFutureState(b, "30d");
    expect(result7.velocityDrift).toBeGreaterThan(0);
    expect(result30.velocityDrift).toBeGreaterThan(result7.velocityDrift);
  });

  it("adds competitor re-quote drag when consensus risk is high and horizon is 14d+", () => {
    const b = board({
      scores: {
        decisionVelocity: { days: 30, confidence: "medium", trace: [] },
        coverage: { value: 0.8, filled: 3, expected: 3, missingArchetypes: [], trace: [] },
        consensusRisk: { level: "high", trace: [] },
        latentVeto: { level: "medium", topGhostArchetype: null, trace: [] },
      },
    });
    const result14 = projectFutureState(b, "14d");
    const result7 = projectFutureState(b, "7d");
    expect(result14.velocityDrift).toBeGreaterThan(result7.velocityDrift);
    expect(result14.trace.some((t) => t.includes("competitor"))).toBe(true);
  });

  it("adds budget-cycle drag at 30d+ when latent veto is high", () => {
    const b = board({
      scores: {
        decisionVelocity: { days: 30, confidence: "medium", trace: [] },
        coverage: { value: 1, filled: 3, expected: 3, missingArchetypes: [], trace: [] },
        consensusRisk: { level: "low", trace: [] },
        latentVeto: { level: "high", topGhostArchetype: "economic_buyer", trace: [] },
      },
    });
    const result = projectFutureState(b, "30d");
    expect(result.trace.some((t) => t.includes("budget cycle"))).toBe(true);
  });

  it("projectAllHorizons returns exactly three horizon ticks in ascending order", () => {
    const ticks = projectAllHorizons(
      board({
        seats: [
          seat({ stance: "blocker" }),
          seat({
            id: "ghost:operations",
            status: "ghost",
            archetype: "operations",
            archetypeLabel: "Operations",
            vetoWeight: 0.7,
            powerWeight: 0.8,
          }),
        ],
      }),
    );
    expect(ticks.map((t) => t.horizon)).toEqual(["7d", "14d", "30d"]);
    expect(ticks[0].velocityDrift).toBeLessThanOrEqual(ticks[2].velocityDrift);
  });
});
