import { describe, expect, it } from "bun:test";
import { buildRecommendedMoves } from "./decision-room-moves";
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
    dealName: "Test Deal",
    companyName: "Test Co",
    seats: [],
    expectedArchetypes: ["champion", "economic_buyer", "operations"],
    scores: {
      decisionVelocity: { days: 30, confidence: "medium", trace: [] },
      coverage: { value: 0.5, filled: 2, expected: 4, missingArchetypes: [], trace: [] },
      consensusRisk: { level: "low", trace: [] },
      latentVeto: { level: "low", topGhostArchetype: null, trace: [] },
    },
    snapshotAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildRecommendedMoves", () => {
  it("puts an addressing-the-blocker move first when one is in the room", () => {
    const b = board({
      seats: [seat({ name: "Dana Blocker", stance: "blocker" })],
    });
    const moves = buildRecommendedMoves(b);
    expect(moves[0]?.id).toBe("address-blocker");
    expect(moves[0]?.leverage).toBe("high");
  });

  it("surfaces an economic-buyer ghost as a top move", () => {
    const b = board({
      seats: [
        seat({ id: "c1", name: "Chris Champion", archetype: "champion", stance: "champion" }),
        seat({
          id: "ghost:economic_buyer",
          status: "ghost",
          name: null,
          archetype: "economic_buyer",
          archetypeLabel: "Economic Buyer",
          vetoWeight: 1.0,
          powerWeight: 1.0,
        }),
      ],
      scores: {
        decisionVelocity: { days: 30, confidence: "medium", trace: [] },
        coverage: { value: 0.5, filled: 2, expected: 4, missingArchetypes: ["economic_buyer"], trace: [] },
        consensusRisk: { level: "medium", trace: [] },
        latentVeto: { level: "high", topGhostArchetype: "economic_buyer", trace: [] },
      },
    });
    const moves = buildRecommendedMoves(b);
    expect(moves.some((m) => m.id === "surface-economic-buyer")).toBe(true);
    const eb = moves.find((m) => m.id === "surface-economic-buyer");
    expect(eb?.leverage).toBe("high");
    expect(eb?.title).toContain("Chris Champion");
  });

  it("falls back to confirming next step with the champion when nothing else is burning", () => {
    const b = board({
      seats: [seat({ id: "c1", name: "Sam Safe", archetype: "champion", stance: "champion" })],
      scores: {
        decisionVelocity: { days: 20, confidence: "high", trace: [] },
        coverage: { value: 1, filled: 3, expected: 3, missingArchetypes: [], trace: [] },
        consensusRisk: { level: "low", trace: [] },
        latentVeto: { level: "low", topGhostArchetype: null, trace: [] },
      },
    });
    const moves = buildRecommendedMoves(b);
    const ids = moves.map((m) => m.id);
    expect(ids).toContain("confirm-next-step");
  });

  it("never returns more than three moves", () => {
    const b = board({
      seats: [
        seat({ id: "c1", name: "Dana", stance: "blocker" }),
        seat({ id: "c2", name: "Ed", archetype: "champion", stance: "champion", vetoWeight: 0.6 }),
        seat({
          id: "ghost:economic_buyer",
          status: "ghost",
          name: null,
          archetype: "economic_buyer",
          archetypeLabel: "Economic Buyer",
          vetoWeight: 1.0,
        }),
        seat({
          id: "ghost:operations",
          status: "ghost",
          name: null,
          archetype: "operations",
          archetypeLabel: "Operations",
          vetoWeight: 0.7,
        }),
      ],
      scores: {
        decisionVelocity: { days: 45, confidence: "medium", trace: ["+5d — 1 seated blocker"] },
        coverage: { value: 0.25, filled: 1, expected: 4, missingArchetypes: [], trace: [] },
        consensusRisk: { level: "high", trace: [] },
        latentVeto: { level: "high", topGhostArchetype: "economic_buyer", trace: [] },
      },
    });
    expect(buildRecommendedMoves(b).length).toBeLessThanOrEqual(3);
  });

  it("deduplicates the same seat across multiple rules", () => {
    const b = board({
      seats: [
        seat({
          id: "ghost:economic_buyer",
          status: "ghost",
          name: null,
          archetype: "economic_buyer",
          archetypeLabel: "Economic Buyer",
          vetoWeight: 1.0,
          powerWeight: 1.0,
        }),
      ],
      scores: {
        decisionVelocity: { days: 30, confidence: "medium", trace: [] },
        coverage: { value: 0, filled: 0, expected: 3, missingArchetypes: [], trace: [] },
        consensusRisk: { level: "high", trace: [] },
        latentVeto: { level: "high", topGhostArchetype: "economic_buyer", trace: [] },
      },
    });
    const moves = buildRecommendedMoves(b);
    const ids = moves.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
